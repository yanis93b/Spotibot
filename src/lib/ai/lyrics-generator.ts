/**
 * LLM-powered lyricist.
 *
 * This is the AI integration core for *words*: given a concept, genre, mood,
 * and vocal style, it asks the ZAI chat-completions endpoint to produce an
 * original, singable lyric sheet with verse–chorus structure, then returns a
 * validated `{ title, lyrics }` payload that the API layer persists and the
 * audio-synth adapter later renders into speech.
 *
 * Design notes:
 * - `thinking` is disabled (we want a fast, deterministic creative response,
 *   not chain-of-thought).
 * - The model is asked to return STRICT JSON only. We defensively strip code
 *   fences and attempt a regex fallback before giving up — LLMs occasionally
 *   wrap output in ```json blocks despite instructions.
 * - Lyrics are hard-capped under ~900 characters so the downstream TTS budget
 *   (1024 chars per call) is never exceeded and there is headroom for chunking.
 *
 * SERVER-ONLY. Imported by API route handlers; never bundled for the client.
 */

import { getZAI } from "./zai-instance";

/** Parameters describing the song the user wants written. */
export interface LyricsParams {
  /** Free-text concept / theme / story prompt from the user. */
  prompt: string;
  /** Musical genre, e.g. "Pop", "Lo-Fi" (see shared GENRES const). */
  genre: string;
  /** Emotional mood, e.g. "Melancholic", "Epic" (see shared MOODS const). */
  mood: string;
  /** Vocal style label, e.g. "Female Vocal" (see shared STYLES const). */
  style: string;
}

/** Parsed lyricist output. */
export interface LyricsResult {
  /** Short, evocative song title (max ~6 words). */
  title: string;
  /** Plain-text lyrics with `\n` line breaks and `[Verse 1]`/`[Chorus]` tags. */
  lyrics: string;
}

/** Hard ceiling on lyrics length to stay within the TTS input budget. */
const LYRICS_MAX_CHARS = 900;
/** Soft ceiling used for the post-validation truncation safety net. */
const LYRICS_TRUNCATE_AT = 950;

/**
 * Build the system prompt that constrains the model into the songwriter role
 * and the strict JSON output contract.
 */
function buildSystemPrompt(): string {
  return [
    "You are an award-winning songwriter.",
    "Given a concept, genre, mood, and vocal style, write ORIGINAL singable lyrics with a clear verse-chorus structure.",
    "Structure: 1 short intro line (optional), 2 verses, 1 chorus, 1 bridge, outro.",
    "Keep the lyrics concise and rhythmic so they can be sung.",
    'Return STRICT JSON only, with this exact shape: {"title": "...", "lyrics": "..."}.',
    "The title must be a short evocative song title (max 6 words).",
    "The lyrics must be plain text with line breaks (\\n), and include section tags like [Verse 1], [Chorus] on their own lines.",
    "Total lyrics MUST be under 900 characters to fit an audio synthesis budget.",
    "Do NOT include markdown code fences.",
    "Do NOT include any text outside the JSON object.",
  ].join(" ");
}

/**
 * Build the user prompt that conveys the concrete song parameters.
 */
function buildUserPrompt(params: LyricsParams): string {
  const { prompt, genre, mood, style } = params;
  return [
    `Concept: ${prompt}`,
    `Genre: ${genre}`,
    `Mood: ${mood}`,
    `Vocal style: ${style}`,
    "Write the song now, returning only the JSON object.",
  ].join("\n");
}

/**
 * Strip leading/trailing whitespace and surrounding ``` / ```json code fences
 * that the model occasionally adds despite instructions.
 */
function stripFences(raw: string): string {
  let text = raw.trim();
  // Match an opening fence with optional language tag (```json, ```JSON, ```).
  const openFence = /^```(?:json|JSON)?\s*\n?/;
  text = text.replace(openFence, "");
  // Strip a trailing closing fence.
  text = text.replace(/\n?```\s*$/, "");
  return text.trim();
}

/**
 * Attempt to extract a `{"title":...,"lyrics":...}` JSON object from a string
 * that may contain surrounding prose. Used as a fallback when `JSON.parse`
 * on the full payload fails.
 */
function extractJsonFallback(text: string): { title: string; lyrics: string } | null {
  // Greedy match for the outermost {...} that contains both "title" and "lyrics".
  const match = text.match(/\{[\s\S]*?"title"[\s\S]*?"lyrics"[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { title?: unknown; lyrics?: unknown };
    if (typeof parsed.title === "string" && typeof parsed.lyrics === "string") {
      return { title: parsed.title, lyrics: parsed.lyrics };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Enforce the lyrics length budget. If the model overran, truncate at the last
 * newline that keeps us under the ceiling and append an ellipsis marker so the
 * downstream consumer knows the lyric was cut.
 */
function enforceLength(lyrics: string): string {
  if (lyrics.length <= LYRICS_TRUNCATE_AT) return lyrics.trimEnd();
  // Find the last newline that lands us under the ceiling.
  const slice = lyrics.slice(0, LYRICS_TRUNCATE_AT);
  const lastNewline = slice.lastIndexOf("\n");
  const cutAt = lastNewline > 0 ? lastNewline : LYRICS_TRUNCATE_AT;
  return `${slice.slice(0, cutAt).trimEnd()}\n...`;
}

/**
 * Generate lyrics for a song described by `params`.
 *
 * Throws an `Error('Lyrics generation failed: <cause>')` on any failure so the
 * API route can map it to a 500 cleanly.
 */
export async function generateLyrics(params: LyricsParams): Promise<LyricsResult> {
  try {
    const zai = await getZAI();

    const completion = await zai.chat.completions.create({
      messages: [
        // Per SDK skill convention, the songwriter instruction lives in the
        // 'assistant' role and the concrete ask lives in the 'user' role.
        { role: "assistant", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(params) },
      ],
      thinking: { type: "disabled" },
    });

    const raw: string = completion?.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      throw new Error("Model returned an empty response");
    }

    // Primary parse path: strip fences then JSON.parse.
    const cleaned = stripFences(raw);
    let parsed: { title?: unknown; lyrics?: unknown } | null = null;
    try {
      parsed = JSON.parse(cleaned) as { title?: unknown; lyrics?: unknown };
    } catch {
      // Fallback: regex-extract an embedded JSON object.
      const fallback = extractJsonFallback(cleaned) ?? extractJsonFallback(raw);
      if (fallback) {
        parsed = fallback;
      } else {
        throw new Error("Failed to parse lyrics from model output");
      }
    }

    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const lyrics =
      typeof parsed.lyrics === "string" ? parsed.lyrics.trim() : "";

    if (!title) {
      throw new Error("Model output is missing a title");
    }
    if (!lyrics) {
      throw new Error("Model output is missing lyrics");
    }

    return {
      title,
      lyrics: enforceLength(lyrics),
    };
  } catch (err) {
    // Preserve a clear, single cause message for the API layer.
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Lyrics generation failed: ${cause}`);
  }
}

// Re-export the budget constant so callers (e.g. tests, future API routes)
// can reference the same ceiling the lyricist enforces.
export const LYRICS_BUDGET_CHARS = LYRICS_MAX_CHARS;
