/**
 * src/app/api/track/[id]/audio/route.ts
 *
 * GET /api/track/[id]/audio — PUBLIC (no auth).
 *
 * Streams the stored audio bytes for a single track to any visitor. This is
 * the public counterpart of the auth-protected `/api/audio/[id]` route: it
 * uses the same byte-streaming + Content-Disposition + Cache-Control pattern,
 * but drops the `ownerId` scoping so logged-out visitors on the share page
 * (or in an embedded iframe) can play the track.
 *
 * Privacy relies on the unguessability of the cuid track id (the share
 * secret) — there is no separate "public" flag on the Song row.
 *
 * Responses:
 *   200 — audio/{format} binary (Buffer body)
 *   404 — { error: "Track not found" }
 *   500 — { error: string }
 *
 * Headers on 200:
 *   Content-Type:        derived from song.audioFormat (audio/mpeg, audio/wav, …)
 *   Content-Length:       <byte length as string>
 *   Content-Disposition: inline; filename="<slugified-title>.<ext>"
 *   Cache-Control:        public, max-age=3600, immutable
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/** ASCII-safe filename stem from a title (lowercase, hyphen-separated). */
function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "audio";
}

/** Maps a stored audioFormat tag to the MIME type for Content-Type. */
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
    // PUBLIC endpoint — no auth, no ownerId scoping. The cuid is the share secret.
    const song = await db.song.findUnique({
      where: { id },
      select: { title: true, audioData: true, audioFormat: true },
    });
    if (!song) {
      return NextResponse.json(
        { error: "Track not found" },
        { status: 404 },
      );
    }

    // Prisma's `Bytes` scalar is typed as `Uint8Array<ArrayBuffer>`; at runtime
    // SQLite hands back a Node Buffer (which extends Uint8Array). The inferred
    // type satisfies BodyInit (BufferSource).
    const buffer = song.audioData;
    const ext = (song.audioFormat || "mp3").toLowerCase();
    const filename = `${slugifyTitle(song.title)}.${ext}`;

    const headers = new Headers({
      "Content-Type": mimeForFormat(song.audioFormat),
      "Content-Length": String(buffer.length),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "public, max-age=3600, immutable",
    });

    return new NextResponse(buffer, { status: 200, headers });
  } catch (err) {
    console.error("track/[id]/audio: failed to stream audio", err);
    return NextResponse.json(
      { error: "Failed to load audio." },
      { status: 500 },
    );
  }
}
