/**
 * AI service layer barrel.
 *
 * Re-exports the lyricist and the audio-synth adapter so API route handlers
 * can import everything they need from a single entry point:
 *
 *     import { generateLyrics, synthesizeAudio } from "@/lib/ai";
 *
 * SERVER-ONLY. Every module behind this barrel touches the `z-ai-web-dev-sdk`
 * and must never be pulled into a client bundle.
 */

export { generateLyrics, LYRICS_BUDGET_CHARS } from "./lyrics-generator";
export type { LyricsResult, LyricsParams } from "./lyrics-generator";

export { synthesizeAudio, splitTextIntoChunks, TTS_LIMIT, CHUNK_MAX } from "./audio-synth";
export type { SynthResult, SynthParams } from "./audio-synth";

// Expose the singleton accessor so other server modules (e.g. future admin or
// diagnostic routes) can reuse the cached ZAI client without duplicating it.
export { getZAI } from "./zai-instance";
