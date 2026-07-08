/**
 * src/app/api/profile/[username]/route.ts
 *
 * GET /api/profile/[username]  — PUBLIC (no auth required).
 *
 * Returns a user's public profile: their public identity (id, name, username,
 * bio, image, createdAt), their generated songs (mapped through `toPublicSong`
 * — audio bytes never leak), and a slim summary of their playlists (only
 * id/name/trackCount/createdAt — no song listings).
 *
 * Responses:
 *   200 — { user: PublicProfileUser, songs: Song[], playlists: PublicPlaylistSummary[] }
 *   404 — { error: "Profile not found" }
 *   500 — { error: string }
 *
 * Username lookups are case-insensitive (the input is lowercased before the
 * findUnique call) so `/u/JohnDoe` and `/u/johndoe` resolve to the same user.
 * The DB only ever stores lowercase usernames (validated at PATCH time), so
 * the lowercase lookup hits the unique index.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";
import type { Song } from "@/lib/types";

/** Public identity block returned in the `user` field. */
export interface PublicProfileUser {
  id: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  image: string | null;
  createdAt: string; // ISO 8601
}

/** Slim playlist summary — no song listings, no duration (per spec). */
export interface PublicPlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
  createdAt: string; // ISO 8601
}

/** Shape of the full public profile response. */
export interface PublicProfileResponse {
  user: PublicProfileUser;
  songs: Song[];
  playlists: PublicPlaylistSummary[];
}

/** Upper bounds so a prolific user doesn't blow up the response payload. */
const MAX_SONGS = 50;
const MAX_PLAYLISTS = 50;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  // Next.js 16 — params is a Promise.
  const { username: rawUsername } = await params;

  // Strip whitespace + lowercase. An empty/whitespace username is a 404
  // (no row in the DB has username = "" — the PATCH validator enforces
  // 3–20 chars, so "" is never stored).
  const username = rawUsername.trim().toLowerCase();
  if (!username) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 },
    );
  }

  try {
    // findUnique on the @unique `username` column — O(log n) via the implicit
    // unique index. Once the orchestrator merges schema-profile.md and runs
    // `bun run db:push`, the Prisma client recognises `username` as a valid
    // `UserWhereUniqueInput` key.
    const user = await db.user.findUnique({
      where: { username },
      select: {
        id: true,
        name: true,
        username: true,
        bio: true,
        image: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 },
      );
    }

    // Fetch this user's generated songs (newest first, capped). `toPublicSong`
    // strips audioData/coverData and derives the public audioUrl + coverUrl.
    //
    // NOTE on access semantics: this endpoint is PUBLIC, so anyone can read
    // the metadata for another user's songs (title, genre, mood, lyrics,
    // cover URL). The audio bytes themselves remain owner-scoped at
    // /api/audio/[id] (auth + ownership required), so an anonymous viewer
    // cannot stream another user's audio. The cover-art endpoint likewise
    // remains owner-scoped. This matches the spec: "Only returns songs
    // (the user's generated tracks) — not audio bytes".
    const [songRows, playlistRows] = await Promise.all([
      db.song.findMany({
        where: { ownerId: user.id },
        orderBy: { createdAt: "desc" },
        take: MAX_SONGS,
      }),
      db.playlist.findMany({
        where: { ownerId: user.id },
        orderBy: { createdAt: "desc" },
        take: MAX_PLAYLISTS,
        // Only need count — pull the join rows without the heavy song payload.
        include: { items: { select: { id: true } } },
      }),
    ]);

    const body: PublicProfileResponse = {
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        bio: user.bio,
        image: user.image,
        createdAt: user.createdAt.toISOString(),
      },
      songs: songRows.map(toPublicSong),
      playlists: playlistRows.map((p) => ({
        id: p.id,
        name: p.name,
        trackCount: p.items.length,
        createdAt: p.createdAt.toISOString(),
      })),
    };

    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    console.error("profile/[username]: failed to load", err);
    return NextResponse.json(
      { error: "Failed to load profile." },
      { status: 500 },
    );
  }
}
