/**
 * worker/handlers/ace-step.ts
 *
 * Client for the self-hosted ACE-Step API.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS
 * ─────────────────────────────────────────────────────────────────────────────
 * A thin HTTP client around a self-hosted ACE-Step server (the open-source
 * audio2audio / flow-edit inference server). The cloud Ace Music API
 * (`src/lib/ai/ace-client.ts`) only exposes text-to-music; the self-hosted
 * server adds three remix-grade endpoints the cloud one doesn't:
 *
 *   POST {ACE_STEP_API}/generate
 *     multipart/form-data: prompt, lyrics, duration, audio_format, ...
 *     → 200 audio/* with the rendered track (or JSON { error } on failure)
 *
 *   POST {ACE_STEP_API}/audio2audio        (Remix)
 *     multipart/form-data: audio (file), prompt, duration
 *     → 200 audio/* with the remixed track
 *
 *   POST {ACE_STEP_API}/edit                (flow-edit / Edit Lyrics)
 *     multipart/form-data: audio (file), original_lyrics, new_lyrics, prompt
 *     → 200 audio/* with the re-rendered track (vocals swapped, music preserved)
 *
 * All three endpoints stream the result audio back as the response body. We
 * download it into a Buffer with a 5-minute ceiling per request so a single
 * slow generation can't pin a worker slot indefinitely.
 *
 * The base URL is configured via the `ACE_STEP_API` env var. When unset, every
 * method throws a clear configuration error so the worker log surfaces the
 * missing setup immediately rather than failing on the first network call.
 */

import { readFile } from "node:fs/promises";

/** Self-hosted ACE-Step server base URL, e.g. `http://localhost:7860`. */
const ACE_STEP_API = (process.env.ACE_STEP_API || "").replace(/\/+$/, "");

/** Per-request timeout. The spec mandates a 5-minute ceiling. */
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/** Default User-Agent so the inference server can identify us in its logs. */
const USER_AGENT = "spotibot-worker/1.0";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Parameters for the text-to-music `/generate` endpoint. */
export interface GenerateParams {
  /** Musical caption / style description. */
  prompt: string;
  /** Lyrics with [Verse]/[Chorus] tags. May be empty for instrumental. */
  lyrics: string;
  /** Track duration in seconds. Default 30. */
  duration?: number;
  /** Output format: "mp3" | "wav" | "flac" | "opus" | "aac". Default "mp3". */
  audioFormat?: string;
  /** Vocal language code. Default "en". */
  language?: string;
  /** Optional tempo. */
  bpm?: number;
  /** Optional musical key. */
  keyScale?: string;
  /** Optional time signature "2"|"3"|"4"|"6". */
  timeSignature?: string;
  /** Optional seed. */
  seed?: number;
}

/** Parameters for the audio2audio `/audio2audio` endpoint (Remix). */
export interface RemixParams {
  /**
   * Source audio as a Buffer (preferred — used when the API route stored the
   * upload locally and we read it back via the worker's S3/file resolver).
   */
  audioBuffer?: Buffer;
  /**
   * Source audio as a fetch-able URL (used when the API route uploaded to S3
   * and the worker hasn't downloaded it yet). Mutually exclusive with
   * `audioBuffer`; if both are set, `audioBuffer` wins (saves a fetch).
   */
  audioUrl?: string;
  /** Free-text remix prompt describing the desired transformation. */
  prompt: string;
  /** Output duration in seconds. Optional. */
  duration?: number;
  /** Output format. Default "mp3". */
  audioFormat?: string;
}

/** Parameters for the flow-edit `/edit` endpoint (Edit Lyrics). */
export interface EditParams {
  /** Source audio as a Buffer (preferred). */
  audioBuffer?: Buffer;
  /** Source audio as a fetch-able URL. */
  audioUrl?: string;
  /** The lyrics that were originally rendered into the source audio. */
  originalLyrics: string;
  /** The new lyrics to re-render. */
  newLyrics: string;
  /** Optional style prompt to bias the re-render. */
  prompt?: string;
  /** Output format. Default "mp3". */
  audioFormat?: string;
}

/** Successful generation result. */
export interface AceStepResult {
  /** Decoded audio bytes. */
  buffer: Buffer;
  /** Audio MIME type sniffed from the response (e.g. "audio/mpeg"). */
  contentType: string;
  /** Audio format identifier derived from the content type ("mp3", "wav", ...). */
  format: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireBase(): string {
  if (!ACE_STEP_API) {
    throw new Error(
      "ACE_STEP_API is not configured. Set it to the base URL of the " +
        "self-hosted ACE-Step inference server (e.g. http://localhost:7860).",
    );
  }
  return ACE_STEP_API;
}

/** Clamp a number into [min, max]. */
function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Map an audio Content-Type to a short format tag. */
function formatFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("flac")) return "flac";
  if (ct.includes("ogg")) return "ogg";
  if (ct.includes("opus")) return "opus";
  if (ct.includes("aac")) return "aac";
  if (ct.includes("mp4") || ct.includes("m4a")) return "m4a";
  if (ct.includes("webm")) return "webm";
  return "bin";
}

/**
 * Run a single request against the ACE-Step server with a hard timeout.
 * Throws `Error('ACE-Step <op> failed: <cause>')` on any failure.
 */
async function sendRequest(
  op: string,
  url: string,
  body: FormData,
): Promise<AceStepResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      body,
      signal: controller.signal,
      headers: {
        // Let fetch set the multipart Content-Type with the correct boundary.
        // Node 18+/Bun's fetch handle FormData natively.
        "User-Agent": USER_AGENT,
      },
    });

    if (!res.ok) {
      // Try to surface the server's error message.
      let detail = "";
      try {
        const text = await res.text();
        detail = text.slice(0, 500);
      } catch {
        /* ignore */
      }
      throw new Error(
        `ACE-Step ${op} returned HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    const contentType = res.headers.get("content-type") || "audio/mpeg";

    // The server streams the result audio back as the response body.
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.length === 0) {
      throw new Error(`ACE-Step ${op} returned an empty audio body`);
    }

    return {
      buffer,
      contentType,
      format: formatFromContentType(contentType),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `ACE-Step ${op} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
      );
    }
    const cause = err instanceof Error ? err.message : String(err);
    if (cause.startsWith("ACE-Step ")) {
      throw err;
    }
    throw new Error(`ACE-Step ${op} failed: ${cause}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the source audio for a remix/edit request into a Buffer.
 * - If `audioBuffer` is provided, use it directly.
 * - Otherwise fetch `audioUrl` (HTTP/HTTPS or `file://`) into a Buffer.
 */
export async function resolveAudio(
  audioBuffer?: Buffer,
  audioUrl?: string,
): Promise<Buffer> {
  if (audioBuffer && audioBuffer.length > 0) return audioBuffer;
  if (!audioUrl) {
    throw new Error(
      "resolveAudio: either audioBuffer or audioUrl must be provided",
    );
  }
  // Local file:// URLs are read from disk (no HTTP fetch).
  if (audioUrl.startsWith("file://")) {
    const path = audioUrl.slice("file://".length);
    return readFile(path);
  }
  // s3:// URLs are not supported here — the caller (worker/index.ts) is
  // responsible for resolving S3 URLs to a Buffer via the AWS SDK before
  // calling into the ACE-Step handlers.
  if (audioUrl.startsWith("s3://")) {
    throw new Error(
      "resolveAudio: s3:// URLs must be resolved by the caller via the AWS SDK",
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(audioUrl, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`fetch ${audioUrl} → HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** Attach a Buffer as a file to a FormData instance under the given field name. */
function attachAudio(form: FormData, buffer: Buffer, filename: string): void {
  // `FormData.append` accepts a Blob in Node 18+/Bun. We wrap the Buffer in a
  // Blob with an explicit type so the server can sniff it correctly.
  //
  // The `Uint8Array` wrap is a TypeScript-only fix: Node's `Buffer` extends
  // `Uint8Array<ArrayBufferLike>` (which can nominally back a
  // SharedArrayBuffer), but the Blob constructor types its `BlobPart` as
  // `Uint8Array<ArrayBuffer>` / `ArrayBuffer`. At runtime a Node Buffer is
  // always backed by a regular ArrayBuffer, so the wrap is zero-cost via a
  // type assertion — no copy is made.
  const bytes = buffer as unknown as Uint8Array<ArrayBuffer>;
  const blob = new Blob([bytes], { type: "audio/mpeg" });
  form.append("audio", blob, filename);
}

// ─── Public entrypoints ────────────────────────────────────────────────────

/**
 * Text-to-music: render a brand-new track from a caption + lyrics.
 * Maps to `POST {ACE_STEP_API}/generate`.
 */
export async function generateMusic(
  params: GenerateParams,
): Promise<AceStepResult> {
  const base = requireBase();
  const form = new FormData();
  form.append("prompt", params.prompt);
  form.append("lyrics", params.lyrics);
  form.append("duration", String(clamp(params.duration ?? 30, 10, 600)));
  form.append("audio_format", params.audioFormat || "mp3");
  form.append("language", params.language || "en");
  if (typeof params.bpm === "number") {
    form.append("bpm", String(clamp(params.bpm, 30, 300)));
  }
  if (params.keyScale) form.append("key_scale", params.keyScale);
  if (params.timeSignature) form.append("time_signature", params.timeSignature);
  if (typeof params.seed === "number") {
    form.append("seed", String(Math.round(params.seed)));
  }

  return sendRequest("generate", `${base}/generate`, form);
}

/**
 * Audio2Audio remix: transform a source audio file using a free-text prompt.
 * Maps to `POST {ACE_STEP_API}/audio2audio`.
 */
export async function remixAudio(
  audioUrl: string,
  prompt: string,
  duration?: number,
  opts: { audioBuffer?: Buffer; audioFormat?: string } = {},
): Promise<AceStepResult> {
  const base = requireBase();
  const buffer = await resolveAudio(opts.audioBuffer, audioUrl);

  const form = new FormData();
  attachAudio(form, buffer, "source.mp3");
  form.append("prompt", prompt);
  if (typeof duration === "number") {
    form.append("duration", String(clamp(duration, 10, 600)));
  }
  form.append("audio_format", opts.audioFormat || "mp3");

  return sendRequest("remix", `${base}/audio2audio`, form);
}

/**
 * Flow-edit: re-render an existing track with new lyrics while preserving the
 * instrumentation as closely as possible.
 * Maps to `POST {ACE_STEP_API}/edit`.
 */
export async function editLyrics(
  audioUrl: string,
  originalLyrics: string,
  newLyrics: string,
  prompt?: string,
  opts: { audioBuffer?: Buffer; audioFormat?: string } = {},
): Promise<AceStepResult> {
  const base = requireBase();
  const buffer = await resolveAudio(opts.audioBuffer, audioUrl);

  const form = new FormData();
  attachAudio(form, buffer, "source.mp3");
  form.append("original_lyrics", originalLyrics);
  form.append("new_lyrics", newLyrics);
  if (prompt) form.append("prompt", prompt);
  form.append("audio_format", opts.audioFormat || "mp3");

  return sendRequest("edit", `${base}/edit`, form);
}

/** Re-exported for diagnostics / display. */
export const ACE_STEP_CONFIG = {
  base: ACE_STEP_API,
  timeoutMs: REQUEST_TIMEOUT_MS,
  configured: Boolean(ACE_STEP_API),
} as const;
