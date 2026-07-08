/**
 * src/app/api/track/[id]/route.ts
 *
 * GET /api/track/[id] — PUBLIC (no auth).
 *
 * Returns the shareable metadata for a single track. This is the public
 * "share page" payload: it deliberately omits all owner-identifying fields
 * (ownerId, prompt, voice, liked, seed, bpm, keyScale, timeSignature) so that
 * a visitor who only has the share link cannot learn anything about the user
 * who generated the track. The cuid track id itself is the unguessable share
 * secret (26 chars, ~4.5e31 possibilities).
 *
 * `audioUrl` and `coverUrl` point at the sibling public stream endpoints
 * (`./audio` and `./cover`) which are also auth-free, so the share page works
 * for logged-out visitors.
 *
 * Responses:
 *   200 — PublicTrack JSON
 *   404 — { error: "Track not found" }
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The public, shareable representation of a track. This is a strict subset of
 * the private `Song` type — it strips every field that could identify or
 * leak information about the owner (prompt, voice, liked, seed, bpm,
 * keyScale, timeSignature, audioFormat) and exposes only what the share page
 * player needs.
 *
 * `audioUrl` / `coverUrl` are the PUBLIC stream endpoints under /api/track
 * (not the auth-protected /api/audio and /api/cover routes).
 */
export interface PublicTrack {
  id: string;
  title: string;
  lyrics: string;
  genre: string;
  mood: string;
  style: string;
  /** Public audio stream URL: "/api/track/{id}/audio". */
  audioUrl: string;
  /** Public cover image URL: "/api/track/{id}/cover" (null when no cover). */
  coverUrl: string | null;
  /** Approximate playback duration in milliseconds (0 if unknown). */
  durationMs: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // PUBLIC endpoint — no ownerId scoping. The cuid is the share secret.
    // We select only the fields needed for PublicTrack so even a future schema
    // addition can't accidentally leak through this route.
    const song = await db.song.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        lyrics: true,
        genre: true,
        mood: true,
        style: true,
        durationMs: true,
        coverData: true,
        createdAt: true,
      },
    });
    if (!song) {
      return NextResponse.json(
        { error: "Track not found" },
        { status: 404 },
      );
    }

    const payload: PublicTrack = {
      id: song.id,
      title: song.title,
      lyrics: song.lyrics,
      genre: song.genre,
      mood: song.mood,
      style: song.style,
      audioUrl: `/api/track/${song.id}/audio`,
      coverUrl: song.coverData ? `/api/track/${song.id}/cover` : null,
      durationMs: song.durationMs,
      createdAt: song.createdAt.toISOString(),
    };

    return NextResponse.json(payload, {
      status: 200,
      headers: {
        // Track metadata is immutable; cache aggressively on the edge.
        "Cache-Control": "public, max-age=300, s-maxage=600",
      },
    });
  } catch (err) {
    console.error("track/[id]: failed to load public track", err);
    return NextResponse.json(
      { error: "Failed to load track." },
      { status: 500 },
    );
  }
}
