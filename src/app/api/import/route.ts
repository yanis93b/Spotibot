/**
 * src/app/api/import/route.ts
 *
 * POST /api/import
 *
 * Import an existing audio file (MP3, WAV, FLAC, OGG, M4A, AAC) into the user's
 * library. The file is sent as multipart/form-data with metadata fields.
 * The audio bytes are stored inline in the Song table (same as generated tracks)
 * and streamed back via the existing /api/audio/[id] endpoint.
 *
 * Body (multipart/form-data):
 *   - file:        the audio file (required, max 50MB)
 *   - title:       track title (required, max 80 chars)
 *   - genre:       one of GENRES (required)
 *   - mood:        one of MOODS (required)
 *   - style:       one of STYLES (required)
 *   - lyrics:      optional lyrics text (max 5000 chars)
 *
 * Responses:
 *   200 — Song (public shape, ready to play)
 *   400 — { error: string }  (validation / unsupported format / too large)
 *   401 — { error: "Unauthorized" }
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { toPublicSong } from "@/lib/song-mapper";
import { GENRES, MOODS, STYLES } from "@/lib/types";

/** Max upload size: 50 MB. */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/** Accepted audio MIME types → format tag stored in DB. */
const ACCEPTED: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "audio/ogg": "opus",
  "audio/aac": "aac",
  "audio/mp4": "aac",
  "audio/x-m4a": "aac",
  "audio/m4a": "aac",
};

/** Accepted file extensions (fallback when MIME is generic). */
const ACCEPTED_EXT: Record<string, string> = {
  mp3: "mp3",
  wav: "wav",
  flac: "flac",
  ogg: "opus",
  oga: "opus",
  opus: "opus",
  aac: "aac",
  m4a: "aac",
  mp4: "aac",
};

function detectFormat(filename: string, mimeType: string): string | null {
  // Try MIME first.
  const byMime = ACCEPTED[mimeType.toLowerCase()];
  if (byMime) return byMime;
  // Fallback: extract extension from filename.
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ACCEPTED_EXT[ext] ?? null;
}

function validateEnum(value: string | null, allowed: readonly string[], field: string): string {
  if (!value) throw new Error(`${field} is required`);
  if (!allowed.includes(value)) throw new Error(`Invalid ${field}: ${value}`);
  return value;
}

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("file");
  const title = formData.get("title") as string | null;
  const genre = formData.get("genre") as string | null;
  const mood = formData.get("mood") as string | null;
  const style = formData.get("style") as string | null;
  const lyrics = (formData.get("lyrics") as string | null) ?? "";

  // Validate file presence.
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "Audio file is required." }, { status: 400 });
  }

  // Validate file size.
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB.` },
      { status: 400 },
    );
  }

  // Detect audio format.
  const format = detectFormat(file.name, file.type);
  if (!format) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || file.name}. Accepted: MP3, WAV, FLAC, OGG, M4A, AAC.` },
      { status: 400 },
    );
  }

  // Validate metadata fields.
  let validGenre: string, validMood: string, validStyle: string;
  try {
    validGenre = validateEnum(genre, GENRES, "Genre");
    validMood = validateEnum(mood, MOODS, "Mood");
    validStyle = validateEnum(style, STYLES, "Style");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid metadata" },
      { status: 400 },
    );
  }

  if (!title || title.trim().length === 0) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }

  try {
    // Read file into buffer.
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = Buffer.from(new Uint8Array(arrayBuffer));

    // Persist as a Song — reuses the existing audio streaming + player infra.
    const song = await db.song.create({
      data: {
        title: title.trim().slice(0, 80),
        prompt: "Imported audio",
        lyrics: lyrics.slice(0, 5000),
        genre: validGenre,
        mood: validMood,
        style: validStyle,
        voice: "en",
        audioData: audioBuffer,
        audioFormat: format,
        durationMs: 0, // unknown until the browser reads metadata
        ownerId: userId,
        status: "ready",
      },
    });

    return NextResponse.json(toPublicSong(song), { status: 200 });
  } catch (err) {
    console.error("import: failed to import audio", err);
    return NextResponse.json(
      { error: "Failed to import audio file." },
      { status: 500 },
    );
  }
}
