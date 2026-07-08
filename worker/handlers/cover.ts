/**
 * worker/handlers/cover.ts
 *
 * Standalone cover-art generator for the worker process.
 *
 * Adapted from `src/lib/ai/cover-generator.ts` so the worker is fully
 * self-contained. The exported signature (`generateCover(params)`) matches the
 * in-app generator so the worker pipeline can reuse the same prompt structure.
 *
 * Cover generation is BEST-EFFORT: if it fails, the caller still gets a
 * working song (the UI renders a deterministic gradient fallback when no
 * cover is present). We never let a cover failure break a generation.
 *
 * Server-only — runs exclusively inside the worker process.
 */

import ZAI from "z-ai-web-dev-sdk";

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

function buildCoverPrompt(params: CoverParams): string {
  const { title, genre, mood, prompt } = params;
  const moodLower = mood.toLowerCase();
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

// ─── Public entrypoint ─────────────────────────────────────────────────────

/**
 * Generate a square PNG cover for a song. Returns null on failure so callers
 * can persist the song without a cover and let the UI show a fallback.
 */
export async function generateCover(
  params: CoverParams,
): Promise<CoverResult | null> {
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
    console.error("[worker/cover] failed to generate cover", err);
    return null;
  }
}
