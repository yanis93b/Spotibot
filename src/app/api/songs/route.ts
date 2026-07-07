/**
 * src/app/api/songs/route.ts
 *
 * GET /api/songs
 *
 * Returns the most recent 100 generated songs, newest first, as public `Song`
 * objects. Audio bytes are NOT included in the response — clients fetch them
 * via each song's `audioUrl` (`/api/audio/{id}`).
 *
 * Responses:
 *   200 — { songs: Song[] }
 *   500 — { error: string }
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";

export async function GET() {
  try {
    const rows = await db.song.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const songs = rows.map(toPublicSong);
    return NextResponse.json({ songs }, { status: 200 });
  } catch (err) {
    console.error("songs: failed to list songs", err);
    return NextResponse.json(
      { error: "Failed to load songs." },
      { status: 500 },
    );
  }
}
