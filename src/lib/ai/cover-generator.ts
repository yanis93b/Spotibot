/**
 * AI cover-art generator.
 *
 * Generates a square album-cover image for a song using the
 * `z-ai-web-dev-sdk` image-generation endpoint. The prompt is composed from
 * the song's genre, mood, and title so each track gets a unique, on-theme
 * cover. The returned PNG bytes are stored alongside the audio in SQLite and
 * served by GET /api/cover/[id].
 *
 * Design notes:
 * - Cover generation is BEST-EFFORT: if it fails, the caller still gets a
 *   working song (the UI renders a deterministic gradient fallback when no
 *   cover is present). We never let a cover failure break a generation.
 * - 1024x1024 square (album-art aspect ratio) is the only size used.
 * - The prompt is deliberately "album cover art" flavored (no text, abstract,
 *   vibrant) because the image model struggles with legible text and album
 *   covers are primarily visual.
 *
 * SERVER-ONLY.
 */

import { getZAI } from "./zai-instance";

/** Input used to compose the cover prompt. */
export interface CoverParams {
  title: string;
  genre: string;
  mood: string;
  prompt: string;
}

/** Cover generation result. */
export interface CoverResult {
  /** PNG image bytes. */
  buffer: Buffer;
  /** Always "png". */
  format: "png";
}

/**
 * Compose the image prompt for the cover. We guide the model toward an
 * abstract, mood-driven visual rather than asking it to render the song title
 * (text rendering is unreliable). The genre + mood drive the palette and feel.
 */
function buildCoverPrompt(params: CoverParams): string {
  const { title, genre, mood, prompt } = params;
  const moodLower = mood.toLowerCase();
  // Map a few genres to visual cues for richer covers.
  const genreCue: Record<string, string> = {
    "Lo-Fi": "lo-fi anime aesthetic, nostalgic",
    "Hip-Hop": "urban street art, bold",
    Electronic: "neon synthwave, futuristic",
    Jazz: "smoky noir, vintage",
    Rock: "grungy textured, raw",
    Pop: "glossy vibrant, polished",
    Classical: "elegant ornate, refined",
    Ambient: "ethereal misty, minimal",
    Folk: "warm organic, earthy",
    "R&B": "moody sensual, smooth",
  };
  const cue = genreCue[genre] ?? "";
  return [
    `Album cover art for a song titled "${title}"`,
    `genre: ${genre}`,
    `mood: ${moodLower}`,
    cue,
    `inspired by the concept: ${prompt.slice(0, 120)}`,
    "abstract, square, no text, no letters, no words, vivid colors, high quality, professional album artwork",
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Generate a square PNG cover for a song. Returns null on failure so callers
 * can persist the song without a cover and let the UI show a fallback.
 */
export async function generateCover(params: CoverParams): Promise<CoverResult | null> {
  try {
    const zai = await getZAI();
    const response = await zai.images.generations.create({
      prompt: buildCoverPrompt(params),
      size: "1024x1024",
    });

    const base64 = response?.data?.[0]?.base64;
    if (!base64) {
      return null;
    }
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length === 0) {
      return null;
    }
    return { buffer, format: "png" };
  } catch (err) {
    // Best-effort: log and move on. The song is still valid without a cover.
    console.error("cover-generator: failed to generate cover", err);
    return null;
  }
}
