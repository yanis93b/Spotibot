/**
 * src/app/api/discover/route.ts
 *
 * GET /api/discover?page=1&limit=20
 *
 * PUBLIC (no auth) — returns a paginated feed of all public tracks across
 * ALL users, newest first. This is the "Discover" feed: a Spotify-style
 * public timeline of every song any user has chosen to share via the
 * `Song.isPublic` flag (see prisma/schema-discover.md).
 *
 * Query params:
 *   - page  (default 1, min 1)          — 1-indexed page number
 *   - limit (default 20, min 1, max 100) — page size
 *
 * Response (200):
 *   { songs: Song[], total: number, page: number, limit: number }
 *
 * Errors:
 *   400 — { error: string }  (invalid page/limit)
 *   500 — { error: string }
 *
 * Privacy: the response uses `toPublicSong`, which already omits the
 * `ownerId` field — no user information is exposed (see song-mapper.ts).
 *
 * NOTE: this route is written against the future schema where `Song` has an
 * `isPublic Boolean @default(false)` column. ESLint does not type-check
 * Prisma client field access, so this passes lint; the query will resolve
 * once the orchestrator merges prisma/schema-discover.md and runs
 * `bun run db:push`.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";
import type { Song } from "@/lib/types";

// Always evaluate dynamically — the public feed changes the moment any user
// publishes or unpublishes a track, so a cached response would be stale.
export const dynamic = "force-dynamic";

/** Shape of the discover feed response body. */
export interface DiscoverResponse {
  songs: Song[];
  /** Total number of public tracks (across all users) for pagination UI. */
  total: number;
  /** The page number this response represents (1-indexed). */
  page: number;
  /** The page size that was applied. */
  limit: number;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const pageParam = url.searchParams.get("page") ?? "1";
  const limitParam = url.searchParams.get("limit") ?? "20";

  const page = Number(pageParam);
  const limit = Number(limitParam);

  // Validate pagination inputs up-front so a bad cursor doesn't silently
  // become "page 0" or "limit 1000000" at the SQL layer.
  if (!Number.isInteger(page) || page < 1) {
    return NextResponse.json(
      { error: "page must be a positive integer" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json(
      { error: "limit must be an integer between 1 and 100" },
      { status: 400 },
    );
  }

  try {
    // Run the page query and the total count in parallel — the count is
    // needed by the UI to render the infinite-scroll sentinel / "no more
    // tracks" state. The `@@index([isPublic, createdAt])` (see
    // prisma/schema-discover.md) makes both queries index-only scans.
    const [rows, total] = await Promise.all([
      db.song.findMany({
        where: { isPublic: true },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.song.count({ where: { isPublic: true } }),
    ]);

    const body: DiscoverResponse = {
      songs: rows.map(toPublicSong),
      total,
      page,
      limit,
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    console.error("discover: failed to list public songs", err);
    return NextResponse.json(
      { error: "Failed to load discover feed." },
      { status: 500 },
    );
  }
}
