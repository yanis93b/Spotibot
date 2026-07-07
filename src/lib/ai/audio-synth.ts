/**
 * Ace Music — swappable audio synthesis adapter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SWAPPABLE ADAPTER DESIGN — READ THIS BEFORE EDITING
 * ─────────────────────────────────────────────────────────────────────────────
 * This module is the SINGLE integration point between the platform and the
 * underlying text-to-audio model. Today it is backed by the
 * `z-ai-web-dev-sdk` TTS endpoint (a stand-in for the real "Ace Music" model).
 *
 * To switch the platform to a real Suno-style music model endpoint later — e.g.
 * a hosted diffusion/vocoder service that renders a full sung track from lyrics
 * + style — ONLY THIS FILE needs to change, as long as the exported signature
 * is preserved:
 *
 *     synthesizeAudio({ text, voice?, speed? }): Promise<{ buffer: Buffer; format: 'wav' | 'mp3' }>
 *
 * Callers (the `/api/generate` route, the DB persistence layer) must not need
 * to change. The future "real" implementation may ignore `voice`/`speed` and
 * instead drive a music model from `text` + metadata; that concern is fully
 * encapsulated here.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * IMPORTANT FORMAT FINDING (verified live on 0.0.18)
 * --------------------------------------------------
 * The SDK skill documentation claims `response_format: 'mp3'` is supported in
 * non-streaming mode. The actual TTS server REJECTS `'mp3'` with HTTP 400
 * `{"error":{"code":"1214","message":"不支持当前response_format值"}}`
 * ("unsupported response_format value"). Empirically the server accepts:
 *   - `response_format: 'wav'` → `audio/wav` (RIFF/WAVE, plays in all browsers)
 *   - `response_format: 'pcm'` → `audio/pcm` (raw samples, no header)
 *   - omitted                  → `audio/pcm` (defaults to PCM)
 *
 * Therefore this adapter requests `'wav'` and reports `format: 'wav'`. WAV is
 * universally playable in browsers and trivially mergeable across chunks. When
 * the real Ace Music model is wired in, this can switch back to `'mp3'` with no
 * caller-side changes (the `format` field is a union to allow either).
 *
 * The downstream API route should set `Content-Type: audio/wav` based on the
 * `format` field of the result (NOT hardcoded to `audio/mpeg`). See worklog
 * finding for the orchestrator.
 *
 * CHUNKING
 * --------
 * The TTS endpoint accepts at most 1024 characters of `input` per call. To
 * support full lyric sheets (which can run up to ~900 chars from the lyricist,
 * but may exceed the limit when fed from other sources), we implement
 * `splitTextIntoChunks` which splits on sentence boundaries (`.`, `!`, `?`,
 * newlines) and greedily packs fragments into chunks <= `maxLength`. This keeps
 * prosody natural — we never cut mid-sentence.
 *
 * PARALLELISM
 * -----------
 * All chunks for a single request are synthesized concurrently via `Promise.all`.
 * This is the platform's "parallel processing" requirement: multiple TTS calls
 * run at the same time, materially reducing wall-clock latency for multi-chunk
 * inputs. The resulting WAV `Buffer`s are merged with `mergeWavBuffers`.
 *
 * WAV MERGING
 * -----------
 * Unlike raw MP3 frame concatenation, merging WAV files correctly requires
 * parsing the RIFF/WAVE structure of each chunk, extracting the PCM data
 * payload, summing the data sizes, and rebuilding a single canonical 44-byte
 * header. `mergeWavBuffers` does exactly this so multi-chunk playback is
 * seamless and duration metadata is correct. (Naive `Buffer.concat` would
 * leave mid-stream RIFF headers that some browsers refuse to play.)
 *
 * SERVER-ONLY. Imported by API route handlers; never bundled for the client.
 */

import { getZAI } from "./zai-instance";

/** Successful synthesis result: an audio buffer + format tag. */
export interface SynthResult {
  buffer: Buffer;
  /**
   * Audio format of `buffer`. Today always `'wav'` (the live TTS server
   * rejects `'mp3'` — see module header). Typed as a union so a future swap
   * to the real Ace Music model can return `'mp3'` without breaking callers
   * that consume `format` dynamically.
   */
  format: "wav" | "mp3";
}

/** Synthesis request. `voice` and `speed` are optional with sane defaults. */
export interface SynthParams {
  /** The text to render (lyrics, possibly with `[Verse 1]`-style tags). */
  text: string;
  /** TTS voice id. Defaults to "tongtong". Must be one of the SDK voices. */
  voice?: string;
  /** Speech rate, clamped to [0.5, 2.0]. Defaults to 1.0. */
  speed?: number;
}

/** Per-call TTS input ceiling enforced by the SDK. */
const TTS_INPUT_LIMIT = 1024;
/**
 * Safety margin below the hard limit. We pack chunks to <= 900 chars so there
 * is headroom for the SDK's own tokenization/encoding and so a single lyric
 * sheet from the lyricist (budget 900) typically fits in one chunk.
 */
const DEFAULT_CHUNK_MAX = 900;

/** Default voice when none is provided. */
const DEFAULT_VOICE = "tongtong";
/** Default speech speed. */
const DEFAULT_SPEED = 1.0;
/** Minimum allowed speed (SDK clamp). */
const SPEED_MIN = 0.5;
/** Maximum allowed speed (SDK clamp). */
const SPEED_MAX = 2.0;

/**
 * Split a long text into chunks no longer than `maxLength` characters, breaking
 * at sentence boundaries (`.`, `!`, `?`) and newlines whenever possible.
 *
 * Algorithm:
 *  1. Tokenize the input into "fragments" by splitting on sentence/line
 *     terminators while PRESERVING the trailing terminator with each fragment.
 *  2. Greedily accumulate fragments into the current chunk. If adding the next
 *     fragment would exceed `maxLength`, flush the current chunk and start a
 *     new one.
 *  3. If a single fragment is itself longer than `maxLength` (rare for lyrics,
 *     but possible), hard-split it at `maxLength` boundaries.
 *
 * Exported so callers and tests can reuse the exact chunking strategy.
 *
 * @param text      The input text to split. Must be non-empty.
 * @param maxLength Maximum number of characters per chunk. Defaults to 900.
 * @returns An array of non-empty chunk strings.
 */
export function splitTextIntoChunks(text: string, maxLength: number = DEFAULT_CHUNK_MAX): string[] {
  if (!text) return [];
  if (maxLength <= 0) {
    throw new Error("maxLength must be a positive number");
  }

  // Split into fragments, keeping the trailing delimiter attached to each.
  // The regex matches runs that end with ., !, ? (optionally repeated) OR a
  // newline OR end-of-string.
  const fragments = text.match(/[^.!?\n]+[.!?]*\n*|[\n]+/g) ?? [text];

  const chunks: string[] = [];
  let current = "";

  for (const fragment of fragments) {
    // Hard-split overly long fragments (e.g. a single 2000-char line).
    if (fragment.length > maxLength) {
      // First flush whatever we have accumulated.
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < fragment.length; i += maxLength) {
        chunks.push(fragment.slice(i, i + maxLength));
      }
      continue;
    }

    // If appending this fragment would overflow, flush and start fresh.
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

/**
 * Clamp a numeric speed to the SDK-supported range [0.5, 2.0].
 */
function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return DEFAULT_SPEED;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
}

/** Parsed essential fields from a RIFF/WAVE buffer. */
interface WavInfo {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** Raw PCM sample bytes (the `data` chunk body). */
  data: Buffer;
}

/**
 * Parse a RIFF/WAVE buffer and extract the audio format fields + the PCM data
 * payload. Walks the chunk list rather than assuming a fixed 44-byte header,
 * so it tolerates metadata chunks (LIST/INFO/etc.) inserted before `data`.
 *
 * Throws on malformed input.
 */
function parseWav(buf: Buffer): WavInfo {
  if (buf.length < 12) {
    throw new Error("WAV buffer too short");
  }
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE buffer");
  }

  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let data: Buffer | null = null;

  // Chunks start at offset 12 (after "RIFF"<size>"WAVE"). Each chunk is
  // 4-byte id + 4-byte little-endian size + body, and bodies are padded to
  // an even number of bytes.
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > buf.length) break; // truncated; stop walking

    if (id === "fmt ") {
      // PCM fmt chunk body layout:
      //   +0  audio format  (u16)
      //   +2  num channels  (u16)
      //   +4  sample rate   (u32)
      //   +8  byte rate     (u32)
      //  +12  block align    (u16)
      //  +14  bits per sample(u16)
      numChannels = buf.readUInt16LE(bodyStart + 2);
      sampleRate = buf.readUInt32LE(bodyStart + 4);
      bitsPerSample = buf.readUInt16LE(bodyStart + 14);
    } else if (id === "data") {
      data = buf.subarray(bodyStart, bodyEnd);
    }

    // Advance past this chunk, honoring word-alignment padding.
    offset = bodyEnd + (size % 2);
  }

  if (!numChannels || !sampleRate || !bitsPerSample) {
    throw new Error("WAV missing or incomplete fmt chunk");
  }
  if (!data || data.length === 0) {
    throw new Error("WAV missing data chunk");
  }
  return { numChannels, sampleRate, bitsPerSample, data };
}

/**
 * Build a fresh canonical 44-byte PCM WAV header around `info.data` and return
 * the full WAV buffer.
 */
function buildWav(info: WavInfo): Buffer {
  const { numChannels, sampleRate, bitsPerSample, data } = info;
  const byteRate = Math.floor((sampleRate * numChannels * bitsPerSample) / 8);
  const blockAlign = Math.floor((numChannels * bitsPerSample) / 8);

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = 1 (PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

/**
 * Merge multiple WAV buffers (from parallel chunk synthesis) into a single
 * valid WAV buffer. All inputs MUST share the same sample rate, channel count,
 * and bit depth — which they will, because we pass identical `voice` + `speed`
 * for every chunk in a single `synthesizeAudio` call.
 *
 * Implementation: parse each input, concatenate the PCM payloads, rebuild one
 * canonical header with the summed data size. This produces a WAV that any
 * browser will play end-to-end with correct duration.
 */
function mergeWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    throw new Error("mergeWavBuffers: no buffers provided");
  }
  const infos = buffers.map(parseWav);
  const first = infos[0]!;
  for (const info of infos) {
    if (
      info.numChannels !== first.numChannels ||
      info.sampleRate !== first.sampleRate ||
      info.bitsPerSample !== first.bitsPerSample
    ) {
      throw new Error("Cannot merge WAV buffers with mismatched audio formats");
    }
  }
  const mergedData = Buffer.concat(infos.map((i) => i.data));
  return buildWav({ ...first, data: mergedData });
}

/**
 * Synthesize a single chunk of text to a WAV `Buffer`.
 *
 * Encapsulates the per-call SDK contract so the parallel `Promise.all` in
 * `synthesizeAudio` reads cleanly.
 */
async function synthChunk(
  zai: Awaited<ReturnType<typeof import("z-ai-web-dev-sdk").default.create>>,
  input: string,
  voice: string,
  speed: number,
): Promise<Buffer> {
  const response = await zai.audio.tts.create({
    input,
    voice,
    speed,
    // NOTE: the live TTS server rejects 'mp3' (HTTP 400 code 1214). 'wav' is
    // the most universally playable format it does support. See module header.
    response_format: "wav",
    stream: false,
  });
  // The SDK returns a standard Response object — use arrayBuffer(), not
  // response.audio.
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(new Uint8Array(arrayBuffer));
}

/**
 * Render `text` to a single audio `Buffer`.
 *
 * Behavior:
 * - Throws `Error('Cannot synthesize audio from empty text')` if `text` is
 *   empty/whitespace-only.
 * - Defaults `voice` to "tongtong" and `speed` to 1.0; clamps speed to
 *   [0.5, 2.0].
 * - Splits the text into chunks <= 900 chars on sentence boundaries.
 * - Synthesizes all chunks in parallel (`Promise.all`) and merges the
 *   resulting WAV Buffers into one valid WAV.
 * - For the single-chunk case, returns the buffer directly without merge
 *   overhead.
 * - On any failure, throws `Error('Audio synthesis failed: <cause>')`.
 */
export async function synthesizeAudio(params: SynthParams): Promise<SynthResult> {
  try {
    const text = (params.text ?? "").trim();
    if (!text) {
      throw new Error("Cannot synthesize audio from empty text");
    }

    const voice = params.voice && params.voice.trim() ? params.voice.trim() : DEFAULT_VOICE;
    const speed = clampSpeed(params.speed ?? DEFAULT_SPEED);

    const chunks = splitTextIntoChunks(text, DEFAULT_CHUNK_MAX);
    // Defensive: splitting should always yield at least one chunk for non-empty
    // input, but guard anyway.
    if (chunks.length === 0) {
      throw new Error("Text chunking produced no chunks");
    }

    const zai = await getZAI();

    // PARALLEL PROCESSING: fire all chunk synthesis calls at once.
    // Each call is an independent HTTP request to the TTS endpoint; running
    // them concurrently is safe because they share no mutable state.
    const buffers = await Promise.all(
      chunks.map((chunk) => synthChunk(zai, chunk, voice, speed)),
    );

    // Single-chunk fast path: skip merge overhead.
    if (buffers.length === 1) {
      return { buffer: buffers[0]!, format: "wav" };
    }

    // Multi-chunk: properly merge the WAV files so playback is seamless and
    // the duration header is correct.
    const combined = mergeWavBuffers(buffers);
    return { buffer: combined, format: "wav" };
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Audio synthesis failed: ${cause}`);
  }
}

// Re-export budget constants for consumers/tests.
export const TTS_LIMIT = TTS_INPUT_LIMIT;
export const CHUNK_MAX = DEFAULT_CHUNK_MAX;
