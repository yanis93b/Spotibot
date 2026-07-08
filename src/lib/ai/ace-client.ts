/**
 * Ace Music cloud API client (ACE-Step v1.5 turbo).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS
 * ─────────────────────────────────────────────────────────────────────────────
 * The real music-generation backend. The Ace Music cloud API exposes an
 * OpenAI-compatible `/v1/chat/completions` endpoint that performs full
 * text-to-music synthesis: given a caption (musical style description) and
 * lyrics, it returns a complete sung track with instrumentation as a base64
 * MP3 data URL — synchronously, in a single HTTP request.
 *
 * Contract (verified live):
 *   POST {ACE_API_BASE}/v1/chat/completions
 *     Authorization: Bearer {ACE_API_KEY}
 *     Content-Type:  application/json
 *     body: {
 *       model: "acemusic/acestep-v1.5-turbo",
 *       messages: [{ role: "user",
 *         content: "<prompt>{caption}</prompt><lyrics>{lyrics}</lyrics>" }],
 *       stream: false,
 *       thinking: boolean,        // 5Hz LM planning (higher quality, slower)
 *       use_format: boolean,      // LM caption/lyrics enhancement
 *       sample_mode: false,
 *       audio_config: {
 *         format: "mp3",
 *         vocal_language: "en" | "zh" | "ja" | ...,
 *         duration?: number,      // seconds (10–600)
 *         bpm?: number,           // 30–300
 *         key_scale?: string,     // e.g. "C Major", "Am"
 *         time_signature?: string // "2"|"3"|"4"|"6"
 *       }
 *     }
 *   → 200 OpenAI chat-completion shape:
 *     {
 *       id, model, object, created, usage,
 *       choices: [{
 *         finish_reason: "stop" | "error" | ...,
 *         message: {
 *           role: "assistant",
 *           content: "Music generated successfully." | "<error msg>",
 *           audio: [{ type: "audio", audio_url: { url: "data:audio/mpeg;base64,..." } }]
 *         }
 *       }]
 *     }
 *
 * Latency: ~17s for a 20s track with thinking=false; longer with thinking=true.
 * The endpoint is synchronous — no polling required.
 *
 * Auth: the key is read from ACE_API_KEY (server env). It is NEVER exposed to
 * the client. This module is imported only by API route handlers.
 *
 * Docs: https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/API.md
 *        https://github.com/ace-step/ace-step-skills/blob/main/skills/acestep/SKILL.md
 *
 * SERVER-ONLY.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { setTimeout as delay } from "node:timers/promises";

/** Configuration sourced from environment variables. */
const ACE_API_BASE =
  process.env.ACE_API_BASE?.replace(/\/+$/, "") || "https://api.acemusic.ai";
const ACE_API_KEY = process.env.ACE_API_KEY || "";
const ACE_MODEL = process.env.ACE_MODEL || "acemusic/acestep-v1.5-turbo";
const ACE_REQUEST_TIMEOUT_MS = Number(process.env.ACE_REQUEST_TIMEOUT_MS) || 300000;

/**
 * Error thrown when the Ace Music API returns HTTP 429 (rate limit exceeded).
 * Carries a parsed `retryAfterSeconds` so the UI can show a countdown instead
 * of a raw error blob.
 */
export class RateLimitError extends Error {
  /** Seconds until the rate limit resets (best-effort parse; 0 if unknown). */
  retryAfterSeconds: number;
  /** The hourly request quota, when the server mentions it. */
  quota: number | null;

  constructor(message: string, retryAfterSeconds = 0, quota: number | null = null) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.quota = quota;
  }
}

/**
 * Parse the Chinese rate-limit message returned by the Ace Music API, e.g.:
 *   "请求过于频繁，每小时限制 120 次，请在 287 秒后重试"
 * Extracts the retry-in-seconds value and the hourly quota. Returns null when
 * the message doesn't match the expected shape.
 */
function parseRateLimitMessage(
  detail: string,
): { retryAfterSeconds: number; quota: number | null } | null {
  // Try the Retry-After style "请在 N 秒后重试" / "请在 N 分钟后重试".
  const secMatch = detail.match(/(\d+)\s*秒后/);
  const minMatch = detail.match(/(\d+)\s*分钟后/);
  let retryAfterSeconds = 0;
  if (secMatch) {
    retryAfterSeconds = parseInt(secMatch[1]!, 10);
  } else if (minMatch) {
    retryAfterSeconds = parseInt(minMatch[1]!, 10) * 60;
  }
  // Try the quota "每小时限制 N 次".
  const quotaMatch = detail.match(/每小时限制\s*(\d+)\s*次/);
  const quota = quotaMatch ? parseInt(quotaMatch[1]!, 10) : null;
  if (retryAfterSeconds > 0 || quota !== null) {
    return { retryAfterSeconds, quota };
  }
  return null;
}

/** Input parameters for a music generation request. */
export interface AceGenerationParams {
  /** Musical caption / style description (genre + mood + vibe). */
  prompt: string;
  /** Lyrics with [Verse]/[Chorus] section tags. May be empty for instrumental. */
  lyrics: string;
  /** Track duration in seconds. Clamped to [10, 600]. Default 30. */
  duration?: number;
  /** Vocal language code: "en", "zh", "ja", ... Default "en". */
  language?: string;
  /** Tempo. Clamped to [30, 300]. Optional. */
  bpm?: number;
  /** Musical key, e.g. "C Major", "Am". Optional. */
  keyScale?: string;
  /** Time signature: "2"|"3"|"4"|"6". Optional. */
  timeSignature?: string;
  /** Output audio format: "mp3" | "wav" | "flac" | "opus" | "aac" | "wav32". Default "mp3". */
  audioFormat?: string;
  /**
   * Enable 5Hz LM planning for higher musical quality (slower). When false the
   * DiT runs in pure text2music mode. Default false (faster, great for a web
   * UI where the user is waiting). Callers may opt in for a "high quality" mode.
   */
  thinking?: boolean;
  /** Specific seed for reproducibility. When provided, use_random_seed=false. */
  seed?: number;
}

/** Successful generation result. */
export interface AceGenerationResult {
  /** Decoded audio bytes. */
  buffer: Buffer;
  /** Audio format (matches the requested audioFormat, default "mp3"). */
  format: string;
  /** Raw content string returned by the model (usually "Music generated successfully."). */
  message: string;
  /** The seed actually used (echoed from the model when available). */
  seedUsed?: number;
}

/** Shape of a chat-completion response from the Ace Music API. */
interface AceCompletionResponse {
  id?: string;
  model?: string;
  object?: string;
  created?: number;
  usage?: unknown;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      role?: string;
      content?: string;
      audio?: Array<{
        type?: string;
        audio_url?: { url?: string };
      }>;
    };
  }>;
  /** OpenRouter-style error passthrough. */
  error?: { message?: string; code?: string | number };
  detail?: string;
}

/** Clamp a number into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * Build the OpenAI-compatible request payload for /v1/chat/completions.
 * The message content uses the `<prompt>` / `<lyrics>` tag convention the
 * Ace Music server expects (matches the official acestep.sh skill).
 */
function buildPayload(params: AceGenerationParams): Record<string, unknown> {
  const {
    prompt,
    lyrics,
    duration,
    language = "en",
    bpm,
    keyScale,
    timeSignature,
    audioFormat = "mp3",
    thinking = false,
    seed,
  } = params;

  // Assemble the caption+lyrics message body. Empty lyrics → caption only.
  let content = `<prompt>${prompt}</prompt>`;
  if (lyrics && lyrics.trim()) {
    content += `<lyrics>${lyrics}</lyrics>`;
  }

  const audioConfig: Record<string, unknown> = {
    format: audioFormat,
    vocal_language: language,
  };
  if (typeof duration === "number") {
    audioConfig.duration = clamp(Math.round(duration), 10, 600);
  }
  if (typeof bpm === "number") {
    audioConfig.bpm = clamp(Math.round(bpm), 30, 300);
  }
  if (keyScale) {
    audioConfig.key_scale = keyScale;
  }
  if (timeSignature) {
    audioConfig.time_signature = timeSignature;
  }

  const payload: Record<string, unknown> = {
    model: ACE_MODEL,
    messages: [{ role: "user", content }],
    stream: false,
    // 5Hz LM planning. false = faster (pure DiT text2music).
    thinking,
    // Let the model enhance/format caption+lyrics via CoT. false = use inputs
    // verbatim (we already wrote good lyrics upstream, so keep them as-is).
    use_format: false,
    sample_mode: false,
    use_cot_caption: false,
    use_cot_language: false,
    audio_config: audioConfig,
  };

  // Seed: when a specific seed is provided, disable random seeding so the
  // generation is reproducible. Otherwise let the server pick a random seed.
  if (typeof seed === "number" && Number.isFinite(seed)) {
    payload.seed = Math.round(seed);
    payload.use_random_seed = false;
  } else {
    payload.use_random_seed = true;
  }

  return payload;
}

/**
 * Decode a `data:audio/mpeg;base64,...` data URL to a Buffer. Throws if the
 * payload is missing or not a base64 data URL.
 */
function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    throw new Error("Audio data URL is malformed (no comma)");
  }
  const b64 = dataUrl.slice(comma + 1);
  if (!b64) {
    throw new Error("Audio data URL has empty base64 payload");
  }
  try {
    return Buffer.from(b64, "base64");
  } catch {
    throw new Error("Failed to base64-decode audio payload");
  }
}

/**
 * Perform a single music generation request against the Ace Music cloud API.
 *
 * Retries once on transient network errors / 5xx / 429 (with a short backoff)
 * to absorb occasional hiccups on the public endpoint.
 *
 * Throws `Error('Ace Music generation failed: <cause>')` on any unrecoverable
 * failure, including when the model reports `finish_reason: "error"`.
 */
export async function generateMusic(
  params: AceGenerationParams,
): Promise<AceGenerationResult> {
  if (!ACE_API_KEY) {
    throw new Error("Ace Music generation failed: ACE_API_KEY is not configured");
  }
  if (!params.prompt || !params.prompt.trim()) {
    throw new Error("Ace Music generation failed: prompt (caption) is required");
  }

  const payload = buildPayload(params);
  const url = `${ACE_API_BASE}/v1/chat/completions`;

  // Retry up to 4 times on transient errors (5xx, 502/503/504, network) with
  // exponential backoff. The Ace Music public endpoint occasionally returns
  // 502 Bad Gateway when its backend restarts or is overloaded — a short
  // retry loop absorbs these without surfacing an error to the user.
  const maxAttempts = 4;
  const backoffMs = [2000, 4000, 8000]; // delays before attempts 2, 3, 4
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      ACE_REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${ACE_API_KEY}`,
          "User-Agent": "AceMusic-Studio/1.0",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        // Try to extract a human-readable error from the body.
        let detail = "";
        try {
          const errBody = (await res.json()) as AceCompletionResponse;
          detail =
            errBody?.error?.message || errBody?.detail || JSON.stringify(errBody);
        } catch {
          try {
            detail = await res.text();
          } catch {
            /* ignore */
          }
        }
        const status = res.status;

        // 429 = rate limit exceeded. Do NOT retry — retrying would just burn
        // more of the quota. Parse the server's retry hint and throw a typed
        // RateLimitError so the UI can show a friendly countdown.
        if (status === 429) {
          const parsed = parseRateLimitMessage(detail);
          const retryAfterHeader = Number(res.headers.get("retry-after"));
          const retryAfter =
            parsed?.retryAfterSeconds ||
            (Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
              ? retryAfterHeader
              : 0);
          throw new RateLimitError(
            `Rate limit exceeded${parsed?.quota ? ` (${parsed.quota}/hour)` : ""}` +
              (retryAfter > 0
                ? ` — retry in ${Math.ceil(retryAfter / 60)} min`
                : ""),
            retryAfter,
            parsed?.quota ?? null,
          );
        }

        // 5xx (including 502/503/504) = server error. Retry with backoff
        // up to maxAttempts. These are transient on the Ace Music endpoint.
        if (status >= 500 && attempt < maxAttempts) {
          lastError = new Error(`HTTP ${status}: ${detail.slice(0, 200)}`);
          await delay(backoffMs[attempt - 1] ?? 8000);
          continue;
        }
        // Final 5xx attempt failed, or non-retryable 4xx.
        if (status >= 500) {
          throw new Error(
            `Ace Music server error (HTTP ${status}). The service may be temporarily unavailable — please try again in a moment.`,
          );
        }
        throw new Error(`HTTP ${status}: ${detail.slice(0, 300)}`);
      }

      const body = (await res.json()) as AceCompletionResponse;

      // Top-level error passthrough.
      if (body.error?.message) {
        throw new Error(body.error.message);
      }

      const choice = body.choices?.[0];
      if (!choice) {
        throw new Error("Response contained no choices");
      }

      // The model signals failure via finish_reason === "error".
      if (choice.finish_reason === "error") {
        const errMsg = choice.message?.content || "Model reported an error";
        throw new Error(errMsg);
      }

      const audioEntry = choice.message?.audio?.[0];
      const dataUrl = audioEntry?.audio_url?.url;
      if (!dataUrl) {
        throw new Error(
          "Response did not contain audio data (message.audio was empty)",
        );
      }

      const buffer = decodeDataUrl(dataUrl);
      if (buffer.length === 0) {
        throw new Error("Decoded audio buffer is empty");
      }

      return {
        buffer,
        format: params.audioFormat || "mp3",
        message: choice.message?.content || "Music generated successfully.",
        seedUsed: typeof params.seed === "number" ? Math.round(params.seed) : undefined,
      };
    } catch (err) {
      lastError = err;
      // Preserve RateLimitError as-is so callers can read retryAfterSeconds.
      if (err instanceof RateLimitError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      // Retry on network/abort errors (timeout, connection reset, fetch failed).
      // These are transient — the Ace Music endpoint occasionally drops connections.
      const transient =
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("fetch failed") ||
        msg.includes("aborted") ||
        msg.includes("network") ||
        msg.includes("socket hang up") ||
        msg.includes("UND_ERR");
      if (transient && attempt < maxAttempts) {
        await delay(backoffMs[attempt - 1] ?? 8000);
        continue;
      }
      // Non-transient, or last attempt: surface a clean error.
      if (transient) {
        throw new Error(
          "Ace Music is not responding (network timeout after multiple retries). Please try again in a moment.",
        );
      }
      throw new Error(`Ace Music generation failed: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // All attempts exhausted (5xx retries). Surface a friendly message.
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Ace Music generation failed after ${maxAttempts} attempts: ${msg}`,
  );
}

/**
 * Lightweight health check — lists available models. Useful for diagnostics
 * and for surfacing "API reachable / key valid" status in the UI.
 */
export async function checkAceHealth(): Promise<{ ok: boolean; model?: string; error?: string }> {
  try {
    const res = await fetch(`${ACE_API_BASE}/v1/models`, {
      headers: ACE_API_KEY
        ? { Authorization: `Bearer ${ACE_API_KEY}` }
        : {},
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    const model = body.data?.[0]?.id;
    return { ok: true, model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/** Re-exported for diagnostics / display. */
export const ACE_CONFIG = {
  base: ACE_API_BASE,
  model: ACE_MODEL,
  timeoutMs: ACE_REQUEST_TIMEOUT_MS,
  configured: Boolean(ACE_API_KEY),
} as const;
