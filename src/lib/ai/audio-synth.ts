/**
 * Audio synthesis adapter — now backed by the REAL Ace Music model.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SWAPPABLE ADAPTER DESIGN
 * ─────────────────────────────────────────────────────────────────────────────
 * This module is the single integration point between the platform and the
 * underlying audio model. It used to wrap the z-ai-web-dev-sdk TTS endpoint
 * (a spoken-word stand-in). It now wraps the real Ace Music cloud API
 * (ACE-Step v1.5 turbo), which performs full text-to-music synthesis:
 * music + vocals + instrumentation from a caption + lyrics.
 *
 * The exported `synthesizeAudio` signature is the contract the rest of the
 * platform builds against:
 *
 *     synthesizeAudio(params: SynthParams): Promise<SynthResult>
 *
 * To swap in a different model later (e.g. a self-hosted ACE-Step server, or
 * another vendor), only this file (+ ace-client.ts) need to change.
 *
 * WHAT CHANGED vs THE TTS VERSION
 * -------------------------------
 * - The adapter no longer chunks text or merges WAV buffers: Ace Music takes
 *   the full caption + lyrics in one synchronous request and returns a single
 *   MP3. Chunking/merging utilities are retained (exported) for backwards
 *   compatibility with any caller that still imports them, but are no longer
 *   used on the hot path.
 * - `format` is now always `'mp3'` (the Ace server returns MP3).
 * - The `voice`/`speed` params are accepted for API compatibility but are
 *   ignored — Ace Music derives the vocal timbre from the caption + lyrics,
 *   not from a voice id. The UI's style selector now maps to caption language
 *   hints instead.
 *
 * SERVER-ONLY. Imported by API route handlers; never bundled for the client.
 */

import { generateMusic, RateLimitError } from "./ace-client";

/** Successful synthesis result: an audio buffer + format tag. */
export interface SynthResult {
  buffer: Buffer;
  /** Audio format produced by the model (default "mp3"). */
  format: string;
  /** Seed used for generation (when provided), for reproducibility display. */
  seedUsed?: number;
}

/**
 * Synthesis request. The fields mirror `AceGenerationParams` but are tolerant
 * (voice/speed are ignored) so the call site signature stays stable.
 */
export interface SynthParams {
  /** Musical caption / style description (genre + mood + vibe). Required. */
  prompt: string;
  /** Lyrics with [Verse]/[Chorus] tags. May be empty for instrumental. */
  text: string;
  /** Vocal language code ("en", "zh", ...). Default "en". */
  voice?: string;
  /** Track duration in seconds. Clamped to [10, 600]. Default 30. */
  speed?: number;
  /** Optional tempo. */
  bpm?: number;
  /** Optional musical key, e.g. "C Major". */
  keyScale?: string;
  /** Optional time signature "2"|"3"|"4"|"6". */
  timeSignature?: string;
  /** Enable 5Hz LM planning (higher quality, slower). Default false. */
  thinking?: boolean;
  /** Optional duration override (preferred over `speed` when both present). */
  duration?: number;
  /** Output audio format: "mp3" | "wav" | "flac" | "opus" | "aac" | "wav32". */
  audioFormat?: string;
  /** Optional seed for reproducibility. */
  seed?: number;
}

/** Default track duration (seconds) when none is provided. */
const DEFAULT_DURATION = 30;

/**
 * Render a caption + lyrics into a full sung track via the Ace Music model.
 *
 * Delegates to `generateMusic` (ace-client.ts). Throws
 * `Error('Audio synthesis failed: <cause>')` on any failure so the API route
 * can map it to a 500 cleanly.
 */
export async function synthesizeAudio(params: SynthParams): Promise<SynthResult> {
  try {
    const {
      prompt,
      text,
      voice,
      duration,
      speed,
      bpm,
      keyScale,
      timeSignature,
      thinking,
      audioFormat,
      seed,
    } = params;

    if (!prompt || !prompt.trim()) {
      throw new Error("Cannot synthesize audio: prompt (caption) is required");
    }

    // `duration` is the canonical field; fall back to the legacy `speed`
    // (which the old TTS adapter repurposed as duration in some callers) so
    // nothing breaks during the migration.
    const resolvedDuration =
      typeof duration === "number"
        ? duration
        : typeof speed === "number"
          ? speed
          : DEFAULT_DURATION;

    const result = await generateMusic({
      prompt,
      lyrics: text,
      duration: resolvedDuration,
      // `voice` historically held a TTS voice id. We now reinterpret it as a
      // vocal-language code when it looks like one ("en"/"zh"/"ja"/...).
      language: isLanguageCode(voice) ? voice : "en",
      bpm,
      keyScale,
      timeSignature,
      audioFormat,
      thinking,
      seed,
    });

    return {
      buffer: result.buffer,
      format: result.format,
      seedUsed: result.seedUsed,
    };
  } catch (err) {
    // Preserve RateLimitError so the API route can read retryAfterSeconds.
    if (err instanceof RateLimitError) {
      throw err;
    }
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Audio synthesis failed: ${cause}`);
  }
}

/** True when `s` looks like a 2-letter lowercase language code. */
function isLanguageCode(s?: string): boolean {
  return Boolean(s && /^[a-z]{2}$/i.test(s));
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy text-chunking utilities (retained for API compatibility).
// The Ace Music adapter does not use these — it sends the full lyrics in one
// request — but they are kept exported so existing imports don't break.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split a long text into chunks no longer than `maxLength` characters, breaking
 * at sentence boundaries. Kept for backwards compatibility; not used on the
 * current hot path.
 */
export function splitTextIntoChunks(
  text: string,
  maxLength: number = 900,
): string[] {
  if (!text) return [];
  const fragments = text.match(/[^.!?\n]+[.!?]*\n*|[\n]+/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const fragment of fragments) {
    if (fragment.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < fragment.length; i += maxLength) {
        chunks.push(fragment.slice(i, i + maxLength));
      }
      continue;
    }
    if (current.length + fragment.length > maxLength) {
      if (current) chunks.push(current);
      current = fragment;
    } else {
      current += fragment;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Legacy TTS limit constant (kept for import compatibility). */
export const TTS_LIMIT = 1024;
/** Legacy chunk-size constant (kept for import compatibility). */
export const CHUNK_MAX = 900;
