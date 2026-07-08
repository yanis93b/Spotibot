/**
 * src/app/api/trending/route.ts
 *
 * GET /api/trending?limit=20
 *
 * PUBLIC (no auth) — returns the most-liked public tracks created in the last
 * 7 days. Because the schema doesn't have a per-user Likes table (the `liked`
 * flag is a boolean on `Song`), we approximate "trending" as:
 *
 *   isPublic: true AND liked: true AND createdAt > now - 7 days
 *
 * ordered by `createdAt` desc, capped at `limit` (default 20, max 100).
 *
 * Response (200):
 *   { songs: Song[] }
 *
 * Errors:
 *   400 — { error: string }  (invalid limit)
 *   500 — { error: string }
 *
 * Privacy: same as /api/discover — `toPublicSong` omits `ownerId`, so no
 * user information is exposed.
 *
 * NOTE: written against the future schema where `Song` has an `isPublic`
 * column (see prisma/schema-discover.md). ESLint does not type-check Prisma
 * client field access; the query resolves once `db:push` runs.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";
import type { Song } from "@/lib/types";

// Always evaluate dynamically — trending changes whenever a track is liked,
// unliked, published, or ages past the 7-day window.
export const dynamic = "force-dynamic";

/** Shape of the trending response body. */
export interface TrendingResponse {
  songs: Song[];
}

/** Number of days a track stays "fresh" for the trending window. */
const TRENDING_WINDOW_DAYS = 7;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit") ?? "20";
  const limit = Number(limitParam);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json(
      { error: "limit must be an integer between 1 and 100" },
      { status: 400 },
    );
  }

  // Compute the 7-day-ago cutoff at the server's wall clock. We use a single
  // `Date.now()` read so the cutoff is stable across the count + findMany
  // (we only run findMany here, but keeping the convention makes future
  // changes safe).
  const cutoff = new Date(Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  try {
    // The `liked` boolean is the owner's like flag (the schema doesn't have
    // a per-user Likes table yet), so this approximation surfaces tracks
    // the *creator* liked — which for the current data model is the only
    // "popular" signal we have. A future Likes table would replace this
    // with a `groupBy` + `count` over likes.
    const rows = await db.song.findMany({
      where: {
        isPublic: true,
        liked: true,
        createdAt: { gt: cutoff },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const body: TrendingResponse = { songs: rows.map(toPublicSong) };
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    console.error("trending: failed to list trending songs", err);
    return NextResponse.json(
      { error: "Failed to load trending tracks." },
      { status: 500 },
    );
  }
}
