/**
 * src/app/api/generate/route.ts
 *
 * POST /api/generate
 *
 * Generates a new AI song:
 *   1. Validates the JSON body (prompt length, genre/mood/style enums).
 *   2. Derives the TTS voice from the style (or accepts an explicit override).
 *   3. Calls the LLM lyrics adapter (`generateLyrics`).
 *   4. Calls the TTS "Ace Music" audio adapter (`synthesizeAudio`) — this step
 *      depends on the lyrics text so it runs strictly AFTER step 3.
 *   5. Persists the song (audio bytes inline) to SQLite via Prisma.
 *   6. Returns the public `Song` object (audioUrl included, no audio bytes).
 *
 * Responses:
 *   200 — Song (public shape)
 *   400 — { error: string }  (validation / malformed body)
 *   429 — { error: "Too many requests. Please slow down." }
 *   500 — { error: "Failed to generate song. Please try again." }
 *
 * Concurrency note: Next.js App Router route handlers run concurrently per
 * request, so multiple generations are handled in parallel by the Node runtime
 * — no global queue or mutex is required here. Within a single request the
 * lyrics step must complete before audio synthesis (the synth consumes the
 * lyrics), so those two steps are necessarily sequential.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  GENRES,
  MOODS,
  STYLES,
  STYLE_TO_VOICE,
} from "@/lib/types";
import { generateLyrics, synthesizeAudio } from "@/lib/ai";
import { toPublicSong } from "@/lib/song-mapper";

// ---------------------------------------------------------------------------
// In-memory rate limiter (per-IP, sliding window).
// NOTE: This is intentionally lightweight and in-process — fine for a
// single-instance demo. In production this belongs in middleware backed by
// Redis/Upstash so the limit is shared across instances and survives restarts.
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 generations / minute / IP
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
});

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

  const { prompt, genre, mood, style } = parsed.data;
  // Derive voice: explicit non-empty override wins, else map from style,
  // else fall back to the platform default voice.
  const voice =
    parsed.data.voice && parsed.data.voice.length > 0
      ? parsed.data.voice
      : (STYLE_TO_VOICE[style] ?? "tongtong");

  try {
    // 4. Generate lyrics via the LLM adapter.
    const { title, lyrics } = await generateLyrics({
      prompt,
      genre,
      mood,
      style,
    });

    // 5. Synthesize audio via the TTS "Ace Music" adapter.
    //    This depends on `lyrics`, so it must run after step 4.
    //    `format` is driven by the adapter (currently 'wav' because the live
    //    TTS server rejects 'mp3' — see src/lib/ai/audio-synth.ts header).
    const { buffer, format } = await synthesizeAudio({ text: lyrics, voice });

    // Prisma's `Bytes` scalar is typed as `Uint8Array<ArrayBuffer>`, while the
    // synth adapter returns a Node `Buffer` (which extends `Uint8Array` and is
    // always backed by a real `ArrayBuffer` at runtime). Prisma's runtime
    // happily accepts a Buffer, so this assertion is a purely type-level
    // adjustment (no data is copied or converted).
    const audioBytes = buffer as Uint8Array<ArrayBuffer>;

    // 6. Persist the song (audio bytes stored inline in SQLite).
    const row = await db.song.create({
      data: {
        title,
        prompt,
        lyrics,
        genre,
        mood,
        style,
        voice,
        audioData: audioBytes,
        // Persist the format actually produced by the synth adapter so the
        // streaming route can set the correct Content-Type / file extension.
        audioFormat: format,
        durationMs: 0,
      },
    });

    // 7. Return the public Song object.
    return NextResponse.json(toPublicSong(row), { status: 200 });
  } catch (err) {
    // Log server-side for debugging; never leak internals to the client.
    console.error("generate: failed to generate song", err);
    return NextResponse.json(
      { error: "Failed to generate song. Please try again." },
      { status: 500 },
    );
  }
}
