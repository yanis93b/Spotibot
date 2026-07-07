/**
 * src/app/api/generate/route.ts
 *
 * POST /api/generate
 *
 * Generates a new AI song using the REAL Ace Music model (ACE-Step v1.5 turbo):
 *   1. Validates the JSON body (prompt length, genre/mood/style enums, duration,
 *      language, highQuality flag).
 *   2. Builds a musical caption from the prompt + genre + mood + style.
 *   3. Calls the LLM lyricist (`generateLyrics`) to write structured lyrics.
 *   4. Calls the Ace Music adapter (`synthesizeAudio`) which performs full
 *      text-to-music synthesis (music + vocals + instrumentation) and returns
 *      an MP3 buffer. This step depends on the lyrics, so it runs AFTER step 3.
 *   5. Persists the song (audio bytes inline) to SQLite via Prisma.
 *   6. Returns the public `Song` object (audioUrl included, no audio bytes).
 *
 * Responses:
 *   200 — Song (public shape)
 *   400 — { error: string }  (validation / malformed body)
 *   429 — { error: "Too many requests. Please slow down." }
 *   500 — { error: "Failed to generate song. Please try again." }
 *
 * Concurrency: Next.js App Router route handlers run concurrently per request,
 * so multiple generations are handled in parallel by the Node runtime — no
 * global queue required. Within a single request, lyrics → audio is sequential
 * (the Ace Music model consumes the lyrics).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  GENRES,
  MOODS,
  STYLES,
  LANGUAGES,
  STYLE_TO_CAPTION,
} from "@/lib/types";
import { generateLyrics, synthesizeAudio } from "@/lib/ai";
import { toPublicSong } from "@/lib/song-mapper";

// ---------------------------------------------------------------------------
// In-memory rate limiter (per-IP, sliding window).
// NOTE: intentionally lightweight and in-process — fine for a single-instance
// deployment. In production this belongs in middleware backed by Redis/Upstash
// so the limit is shared across instances and survives restarts.
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 8; // 8 generations / minute / IP (Ace Music calls are heavier now)
const rateBuckets = new Map<string, number[]>();

/** Returns true when the caller has exceeded the rate limit. */
function rateLimitExceeded(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (rateBuckets.get(ip) ?? []).filter((t) => t > cutoff);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(ip, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  return false;
}

/** Extracts the client IP from the x-forwarded-for header (first hop). */
function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0];
    if (first) return first.trim();
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------
const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

const generateSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, "Prompt must be at least 3 characters")
    .max(500, "Prompt must be at most 500 characters"),
  genre: z.enum(GENRES),
  mood: z.enum(MOODS),
  style: z.enum(STYLES),
  voice: z.string().trim().optional(),
  duration: z
    .number()
    .int("Duration must be a whole number")
    .min(10, "Duration must be at least 10 seconds")
    .max(300, "Duration must be at most 300 seconds")
    .optional(),
  language: z.enum(LANGUAGE_CODES as [string, ...string[]]).optional(),
  highQuality: z.boolean().optional(),
});

/**
 * Compose the musical caption that the Ace Music model consumes. The caption
 * conveys genre + mood + style + the user's concept in a single descriptive
 * sentence — this is what drives the instrumental and vocal arrangement.
 */
function buildCaption(params: {
  prompt: string;
  genre: string;
  mood: string;
  style: string;
}): string {
  const styleHint = STYLE_TO_CAPTION[params.style] ?? "";
  const parts = [
    params.prompt,
    params.genre,
    params.mood.toLowerCase(),
    styleHint,
  ].filter(Boolean);
  // Join into a readable caption. The model treats this as free-text style
  // guidance, so a comma-separated phrase works well.
  return parts.join(", ");
}

export async function POST(req: NextRequest) {
  // 1. Rate limit (cheapest gate, do it before any expensive work).
  const ip = getClientIp(req);
  if (rateLimitExceeded(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 },
    );
  }

  // 2. Parse JSON body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  // 3. Validate against the zod schema.
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ?? "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const {
    prompt,
    genre,
    mood,
    style,
    duration = 30,
    language = "en",
    highQuality = false,
  } = parsed.data;

  // Compose the musical caption for the Ace Music model.
  const caption = buildCaption({ prompt, genre, mood, style });

  try {
    // 4. Generate lyrics via the LLM lyricist.
    const { title, lyrics } = await generateLyrics({
      prompt,
      genre,
      mood,
      style,
    });

    // 5. Synthesize the full track via the Ace Music model.
    //    The model performs text→music (vocals + instrumentation) from the
    //    caption + lyrics in a single synchronous request and returns an MP3.
    const { buffer, format } = await synthesizeAudio({
      prompt: caption,
      text: lyrics,
      duration,
      language,
      thinking: highQuality,
    });

    // Prisma's `Bytes` scalar is typed as `Uint8Array<ArrayBuffer>`, while the
    // synth adapter returns a Node `Buffer` (which extends `Uint8Array` and is
    // always backed by a real `ArrayBuffer` at runtime). Prisma's runtime
    // happily accepts a Buffer, so this assertion is a purely type-level
    // adjustment (no data is copied or converted).
    const audioBytes = buffer as Uint8Array<ArrayBuffer>;

    // Duration in milliseconds for the UI (server-side best-effort estimate
    // from the requested duration; the model aims for the requested length).
    const durationMs = Math.round(duration * 1000);

    // 6. Persist the song (audio bytes stored inline in SQLite).
    const row = await db.song.create({
      data: {
        title,
        prompt,
        lyrics,
        genre,
        mood,
        style,
        // Store the requested language as the "voice" field (back-compat with
        // the Song schema). The Ace Music adapter no longer uses TTS voice ids.
        voice: language,
        audioData: audioBytes,
        // Persist the format actually produced by the synth adapter so the
        // streaming route can set the correct Content-Type / file extension.
        audioFormat: format,
        durationMs,
      },
    });

    // 7. Return the public Song object.
    return NextResponse.json(toPublicSong(row), { status: 200 });
  } catch (err) {
    // Log server-side for debugging; never leak internals to the client.
    console.error("generate: failed to generate song", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: msg.includes("Ace Music")
          ? msg
          : "Failed to generate song. Please try again.",
      },
      { status: 500 },
    );
  }
}
