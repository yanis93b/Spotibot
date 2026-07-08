/**
 * worker/handlers/lyrics.ts
 *
 * Standalone LLM lyricist for the worker process.
 *
 * Adapted from `src/lib/ai/lyrics-generator.ts` so the worker is fully
 * self-contained — it does not import anything from the Next.js app and can
 * run as its own process with its own dependency tree. The exported signature
 * matches the in-app lyricist so swapping the synchronous path for the queue
 * path requires no changes at call sites that build the prompt.
 *
 * The ZAI SDK client is constructed once and cached on `globalThis` (mirroring
 * the Next.js app's singleton pattern) so HMR / worker restarts don't leak
 * duplicate connections.
 *
 * Server-only — runs exclusively inside the worker process.
 */

import ZAI from "z-ai-web-dev-sdk";

/** Parameters describing the song the user wants written. */
export interface LyricsParams {
  /** Free-text concept / theme / story prompt from the user. */
  prompt: string;
  /** Musical genre, e.g. "Pop", "Lo-Fi". */
  genre: string;
  /** Emotional mood, e.g. "Melancholic", "Epic". */
  mood: string;
  /** Vocal style label, e.g. "Female Vocal". */
  style: string;
}

/** Parsed lyricist output. */
export interface LyricsResult {
  /** Short, evocative song title (max ~6 words). */
  title: string;
  /** Plain-text lyrics with `\n` line breaks and `[Verse 1]`/`[Chorus]` tags. */
  lyrics: string;
}

/** Hard ceiling on lyrics length to stay within the TTS / model input budget. */
const LYRICS_MAX_CHARS = 900;
/** Soft ceiling used for the post-validation truncation safety net. */
const LYRICS_TRUNCATE_AT = 950;

/** Re-exported budget constant so callers can reference the same ceiling. */
export const LYRICS_BUDGET_CHARS = LYRICS_MAX_CHARS;

// ─── ZAI SDK singleton (cached on globalThis) ──────────────────────────────

type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>;

const globalForZai = globalThis as unknown as { __workerZai?: ZaiClient };

async function getZAI(): Promise<ZaiClient> {
  if (!globalForZai.__workerZai) {
    globalForZai.__workerZai = await ZAI.create();
  }
  return globalForZai.__workerZai;
}

// ─── Prompt construction ───────────────────────────────────────────────────

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

// ─── JSON extraction utilities ─────────────────────────────────────────────

function stripFences(raw: string): string {
  let text = raw.trim();
  const openFence = /^```(?:json|JSON)?\s*\n?/;
  text = text.replace(openFence, "");
  text = text.replace(/\n?```\s*$/, "");
  return text.trim();
}

function extractJsonFallback(
  text: string,
): { title: string; lyrics: string } | null {
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

function enforceLength(lyrics: string): string {
  if (lyrics.length <= LYRICS_TRUNCATE_AT) return lyrics.trimEnd();
  const slice = lyrics.slice(0, LYRICS_TRUNCATE_AT);
  const lastNewline = slice.lastIndexOf("\n");
  const cutAt = lastNewline > 0 ? lastNewline : LYRICS_TRUNCATE_AT;
  return `${slice.slice(0, cutAt).trimEnd()}\n...`;
}

// ─── Public entrypoint ─────────────────────────────────────────────────────

/**
 * Generate lyrics for a song described by `params`.
 *
 * Throws `Error('Lyrics generation failed: <cause>')` on any failure so the
 * worker can map it to a job error and let BullMQ retry/backoff kick in.
 */
export async function generateLyrics(
  params: LyricsParams,
): Promise<LyricsResult> {
  try {
    const zai = await getZAI();

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(params) },
      ],
      thinking: { type: "disabled" },
    });

    const raw: string = completion?.choices?.[0]?.message?.content ?? "";
    if (!raw) {
      throw new Error("Model returned an empty response");
    }

    const cleaned = stripFences(raw);
    let parsed: { title?: unknown; lyrics?: unknown } | null = null;
    try {
      parsed = JSON.parse(cleaned) as { title?: unknown; lyrics?: unknown };
    } catch {
      const fallback =
        extractJsonFallback(cleaned) ?? extractJsonFallback(raw);
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
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`Lyrics generation failed: ${cause}`);
  }
}
