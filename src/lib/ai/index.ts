/**
 * AI service layer barrel.
 *
 * Re-exports the lyricist and the audio-synth adapter so API route handlers
 * can import everything they need from a single entry point:
 *
 *     import { generateLyrics, synthesizeAudio } from "@/lib/ai";
 *
 * The audio-synth adapter is now backed by the real Ace Music model
 * (see ./ace-client.ts). The ZAI SDK singleton is retained because the
 * lyricist still uses the ZAI chat-completions endpoint.
 *
 * SERVER-ONLY. Every module behind this barrel touches external AI services
 * and must never be pulled into a client bundle.
 */

export { generateLyrics, LYRICS_BUDGET_CHARS } from "./lyrics-generator";
export type { LyricsResult, LyricsParams } from "./lyrics-generator";

export {
  synthesizeAudio,
  splitTextIntoChunks,
  TTS_LIMIT,
  CHUNK_MAX,
} from "./audio-synth";
export type { SynthResult, SynthParams } from "./audio-synth";

export {
  generateMusic,
  checkAceHealth,
  ACE_CONFIG,
  RateLimitError,
} from "./ace-client";
export type { AceGenerationParams, AceGenerationResult } from "./ace-client";

export { generateCover } from "./cover-generator";
export type { CoverParams, CoverResult } from "./cover-generator";

// Expose the ZAI singleton accessor so the lyricist (and any future server
// module) can reuse the cached ZAI client without duplicating it.
export { getZAI } from "./zai-instance";
