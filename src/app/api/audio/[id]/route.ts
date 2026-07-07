/**
 * src/app/api/audio/[id]/route.ts
 *
 * GET /api/audio/[id]
 *
 * Streams the stored MP3 audio bytes for a single song. Audio bytes are kept
 * out of the JSON list/create responses and only ever served here, so the
 * browser can cache the binary payload aggressively.
 *
 * Responses:
 *   200 — audio/mpeg binary (Buffer body)
 *   404 — { error: "Song not found" }
 *   500 — { error: string }
 *
 * Headers set on 200:
 *   Content-Type:        audio/mpeg
 *   Content-Length:       <byte length as string>
 *   Content-Disposition: inline; filename="<slugified-title>.mp3"
 *   Cache-Control:        public, max-age=3600, immutable
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Converts a song title into a safe ASCII filename stem (lowercase,
 * hyphen-separated, no special chars). Falls back to "audio" when the title
 * contains no usable characters (e.g. entirely non-ASCII).
 */
function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "audio";
}

/**
 * Maps a stored audioFormat tag ("mp3" | "wav" | "pcm" | ...) to the MIME type
 * used for the Content-Type header. Unknown formats fall back to a generic
 * binary type so the browser still downloads the file correctly.
 */
function mimeForFormat(format: string): string {
  switch (format?.toLowerCase()) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
    case "wav32":
      return "audio/wav";
    case "pcm":
      return "audio/pcm";
    case "flac":
      return "audio/flac";
    case "opus":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const song = await db.song.findUnique({ where: { id } });
    if (!song) {
      return NextResponse.json(
        { error: "Song not found" },
        { status: 404 },
      );
    }

    // Prisma's `Bytes` scalar is typed as `Uint8Array<ArrayBuffer>`; at runtime
    // SQLite hands back a Node Buffer (which extends Uint8Array). Inferred type
    // is `Uint8Array<ArrayBuffer>`, which is a valid BodyInit (BufferSource).
    const buffer = song.audioData;
    // Derive the file extension + MIME type from the format actually produced
    // by the synth adapter (persisted on the row). Defaults to wav/mp3 safely.
    const ext = (song.audioFormat || "wav").toLowerCase();
    const filename = `${slugifyTitle(song.title)}.${ext}`;

    const headers = new Headers({
      "Content-Type": mimeForFormat(song.audioFormat),
      "Content-Length": String(buffer.length),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600, immutable",
    });

    return new NextResponse(buffer, { status: 200, headers });
  } catch (err) {
    console.error("audio/[id]: failed to stream audio", err);
    return NextResponse.json(
      { error: "Failed to load audio." },
      { status: 500 },
    );
  }
}
