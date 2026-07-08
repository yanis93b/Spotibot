/**
 * src/app/api/browse/route.ts
 *
 * GET /api/browse
 *
 * Browse/Discover endpoint that returns the current user's songs either
 * (a) aggregated by genre (no query params), or
 * (b) filtered by an optional `genre` and/or `mood` query param.
 *
 * Query modes:
 *   - (no params)                 → { genres: [{ genre, count, songs: Song[] }, ...] }
 *                                   Top 4 songs per genre (newest first), one entry per
 *                                   known genre in GENRES (only genres with ≥1 song).
 *   - ?genre=Pop                  → { songs: Song[] }
 *                                   Up to 100 songs in that genre, newest first.
 *   - ?genre=Pop&mood=Happy       → { songs: Song[] }
 *                                   Up to 100 songs matching both, newest first.
 *
 * Auth: required. All queries are scoped by the current user's `ownerId`,
 * mirroring the rest of the API surface (see src/lib/session.ts).
 *
 * Responses:
 *   200 — aggregated genres OR filtered songs (above)
 *   400 — { error: string }  (invalid genre/mood value)
 *   401 — { error: "Unauthorized" }
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";
import { getCurrentUserId } from "@/lib/session";
import { GENRES, MOODS, type Song } from "@/lib/types";

/** Curated option sets are readonly tuples — cast to a Set for O(1) lookups. */
const VALID_GENRES: ReadonlySet<string> = new Set(GENRES as readonly string[]);
const VALID_MOODS: ReadonlySet<string> = new Set(MOODS as readonly string[]);

/** Shape of a single genre bucket in the aggregated response. */
interface GenreBucket {
  genre: string;
  count: number;
  songs: Song[];
}

export async function GET(req: NextRequest) {
  // Auth gate — every protected route does this first.
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Read query params via the request URL (Next 16 App Router).
  const url = new URL(req.url);
  const genreParam = url.searchParams.get("genre");
  const moodParam = url.searchParams.get("mood");

  // Validate the genre/mood params against the canonical lists so callers can't
  // request arbitrary free-text values (e.g. `?genre=DROP TABLE`).
  if (genreParam !== null && !VALID_GENRES.has(genreParam)) {
    return NextResponse.json(
      { error: `Unknown genre: ${genreParam}` },
      { status: 400 },
    );
  }
  if (moodParam !== null && !VALID_MOODS.has(moodParam)) {
    return NextResponse.json(
      { error: `Unknown mood: ${moodParam}` },
      { status: 400 },
    );
  }

  try {
    // ── Filtered mode: a genre (and optionally a mood) was specified.
    if (genreParam) {
      const where: { ownerId: string; genre: string; mood?: string } = {
        ownerId: userId,
        genre: genreParam,
      };
      if (moodParam) where.mood = moodParam;

      const rows = await db.song.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return NextResponse.json(
        { songs: rows.map(toPublicSong) },
        { status: 200 },
      );
    }

    // ── Aggregated mode: no genre specified → bucket every owned song by genre.
    // We fetch only what we need to assemble the buckets: top 4 per genre for
    // the preview, plus the total count per genre. SQLite doesn't have a
    // native "top-N per group" window function we can lean on cleanly via
    // Prisma, so we do one query per known genre instead — at most 10 small
    // queries, parallelized via Promise.all.
    const buckets = await Promise.all(
      (GENRES as readonly string[]).map(async (genre) => {
        // Count is cheap; top-4 fetch is small. Run both in parallel.
        const [count, top] = await Promise.all([
          db.song.count({ where: { ownerId: userId, genre } }),
          db.song.findMany({
            where: { ownerId: userId, genre },
            orderBy: { createdAt: "desc" },
            take: 4,
          }),
        ]);
        return { genre, count, top } as const;
      }),
    );

    // Drop genres with no songs so the UI doesn't render empty tiles.
    const genres: GenreBucket[] = buckets
      .filter((b) => b.count > 0)
      .map((b) => ({
        genre: b.genre,
        count: b.count,
        songs: b.top.map(toPublicSong),
      }));

    return NextResponse.json({ genres }, { status: 200 });
  } catch (err) {
    console.error("browse: failed to query songs", err);
    return NextResponse.json(
      { error: "Failed to load browse data." },
      { status: 500 },
    );
  }
}
