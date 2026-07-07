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
  AUDIO_FORMATS,
  MUSICAL_KEYS,
  TIME_SIGNATURES,
  STYLE_TO_CAPTION,
} from "@/lib/types";
import { generateLyrics, synthesizeAudio, generateCover } from "@/lib/ai";
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
  // Custom mode: user-supplied lyrics (and optional title). When provided,
  // the LLM lyricist is skipped and the Ace Music model renders these lyrics.
  customLyrics: z
    .string()
    .trim()
    .min(20, "Custom lyrics must be at least 20 characters")
    .max(2000, "Custom lyrics must be at most 2000 characters")
    .optional(),
  customTitle: z
    .string()
    .trim()
    .min(1, "Title cannot be empty")
    .max(80, "Title must be at most 80 characters")
    .optional(),
  // Advanced model params (all optional).
  audioFormat: z.enum(AUDIO_FORMATS.map((f) => f.code) as [string, ...string[]]).optional(),
  bpm: z.number().int().min(30).max(300).optional(),
  keyScale: z.enum(MUSICAL_KEYS as [string, ...string[]]).optional(),
  timeSignature: z.enum(TIME_SIGNATURES.map((t) => t.code) as [string, ...string[]]).optional(),
  seed: z.number().int().min(0).max(4294967295).optional(),
});

/**
 * Derive a short title from custom lyrics when the user didn't provide one.
 * Picks the first non-empty, non-tag line (skipping [Verse]/[Chorus] markers)
 * and truncates it to a reasonable title length.
 */
function deriveTitleFromLyrics(lyrics: string): string {
  const lines = lyrics
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("["));
  const first = lines[0] ?? "";
  // Take at most ~6 words.
  const words = first.split(/\s+/).slice(0, 6).join(" ");
  return words.length > 0 ? words.slice(0, 60) : "";
}

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
    customLyrics,
    customTitle,
    audioFormat = "mp3",
    bpm,
    keyScale,
    timeSignature,
    seed,
  } = parsed.data;

  // Compose the musical caption for the Ace Music model.
  const caption = buildCaption({ prompt, genre, mood, style });

  try {
    // 4. Obtain lyrics + title.
    //    In Custom mode the user wrote their own lyrics, so we skip the LLM
    //    lyricist entirely. Otherwise, ask the LLM to write structured lyrics
    //    from the prompt + genre + mood + style.
    let title: string;
    let lyrics: string;
    if (customLyrics && customLyrics.trim()) {
      title = (customTitle && customTitle.trim()) || deriveTitleFromLyrics(customLyrics) || "Untitled";
      lyrics = customLyrics.trim();
    } else {
      const out = await generateLyrics({ prompt, genre, mood, style });
      title = out.title;
      lyrics = out.lyrics;
    }

    // 5. Synthesize audio + generate cover art IN PARALLEL.
    //    These two AI calls are independent (audio needs lyrics; cover needs
    //    title+genre+mood), so we fire them concurrently to minimize wall-clock
    //    latency. Cover generation is best-effort — a failure yields null and
    //    the UI falls back to a gradient cover.
    const [audioResult, coverResult] = await Promise.all([
      synthesizeAudio({
        prompt: caption,
        text: lyrics,
        duration,
        language,
        thinking: highQuality,
        audioFormat,
        bpm,
        keyScale: keyScale || undefined,
        timeSignature: timeSignature || undefined,
        seed,
      }),
      generateCover({ title, genre, mood, prompt }),
    ]);

    const audioBytes = audioResult.buffer as Uint8Array<ArrayBuffer>;
    const durationMs = Math.round(duration * 1000);

    // 6. Persist the song (audio + cover bytes stored inline in SQLite).
    const row = await db.song.create({
      data: {
        title,
        prompt,
        lyrics,
        genre,
        mood,
        style,
        voice: language,
        audioData: audioBytes,
        audioFormat: audioResult.format,
        durationMs,
        coverData: coverResult?.buffer ?? undefined,
        coverFormat: coverResult?.format ?? "png",
        bpm: bpm ?? null,
        keyScale: keyScale || null,
        timeSig: timeSignature || null,
        seed: audioResult.seedUsed != null ? BigInt(audioResult.seedUsed) : null,
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
