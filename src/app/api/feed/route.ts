/**
 * src/app/api/feed/route.ts
 *
 * GET /api/feed?page=1&limit=20
 *
 * Returns the "following feed" — tracks created by users the current user
 * follows, newest first, paginated.
 *
 * Per spec:
 *   where: { ownerId: { in: followedIds }, isPublic: true }
 *
 * Note on `isPublic`: the current `Song` model has no `isPublic` column, so
 * for this round the route filters by `ownerId IN followedIds` only. Every
 * owned song is treated as public — matches the existing `/api/browse` and
 * `/api/songs` behavior. When an `isPublic Boolean @default(true)` field is
 * added to the Song schema, the `where` clause below should be updated to
 * also filter by `isPublic: true`. (Tracked in `prisma/schema-follow.md`.)
 *
 * Auth: required. The list of followed user ids is derived from the
 * `Follow` table scoped to the current user as the follower — never trusted
 * from the request.
 *
 * Query params:
 *   page  — 1-based page number (clamped to ≥1). Default 1.
 *   limit — page size (clamped 1..50). Default 20.
 *
 * Response shape:
 *   {
 *     songs: Array<Song & { ownerId: string; ownerName: string|null; ownerImage: string|null }>,
 *     total: number,
 *     page: number,
 *     limit: number,
 *     hasMore: boolean
 *   }
 *
 * The base `Song` shape from `src/lib/types.ts` is preserved verbatim; the
 * owner metadata is attached as extra fields so the shared type contract
 * stays untouched.
 *
 * Responses:
 *   200 — feed envelope (above)
 *   401 — { error: "Unauthorized" }
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";
import { getCurrentUserId } from "@/lib/session";
import type { Song } from "@/lib/types";

/** Always evaluate dynamically — the feed changes on every new follow / song. */
export const dynamic = "force-dynamic";

/** Max page size — keeps the feed response small even with many follows. */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/** A song in the feed response — base `Song` plus the owner's display info. */
export type FeedSong = Song & {
  ownerId: string;
  ownerName: string | null;
  ownerImage: string | null;
};

/** Feed response envelope. */
export interface FeedResponse {
  songs: FeedSong[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Parse + clamp the pagination params. We coerce to integers and clamp to
 * sane bounds so a malicious `?page=99999999&limit=10000` doesn't blow up.
 */
function parsePagination(req: NextRequest): { page: number; limit: number } {
  const url = new URL(req.url);
  const rawPage = url.searchParams.get("page");
  const rawLimit = url.searchParams.get("limit");

  const page = Math.max(1, Math.trunc(Number(rawPage ?? "1")) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Math.trunc(Number(rawLimit ?? String(DEFAULT_LIMIT))) || DEFAULT_LIMIT),
  );

  return { page, limit };
}

export async function GET(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { page, limit } = parsePagination(req);

  try {
    // ── Resolve the list of users I follow ──────────────────────────────
    // Only select `followingId` — we don't need anything else from the join
    // table for the feed query. An empty list short-circuits to an empty
    // feed (no need to fire the song query at all).
    const followingRows = await db.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const followedIds = followingRows.map((r) => r.followingId);

    if (followedIds.length === 0) {
      const empty: FeedResponse = {
        songs: [],
        total: 0,
        page,
        limit,
        hasMore: false,
      };
      return NextResponse.json(empty, { status: 200 });
    }

    // ── Load the feed page in parallel with the total count ────────────
    // Two queries, parallel — no N+1. We `include: { owner: ... }` so each
    // song row carries the owner's display fields for the UI.
    const where = { ownerId: { in: followedIds } };

    const [total, rows] = await Promise.all([
      db.song.count({ where }),
      db.song.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      }),
    ]);

    const songs: FeedSong[] = rows.map((r) => {
      // Strip the nested `owner` object from the row before handing it to
      // `toPublicSong` (which expects a plain Song row, no relations). The
      // owner's display fields are then attached as the feed-extension props.
      const { owner, ...songRow } = r;
      return {
        ...toPublicSong(songRow),
        ownerId: owner.id,
        ownerName: owner.name,
        ownerImage: owner.image,
      };
    });

    const hasMore = page * limit < total;

    const body: FeedResponse = { songs, total, page, limit, hasMore };
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    console.error("feed: failed to load", err);
    return NextResponse.json(
      { error: "Failed to load feed." },
      { status: 500 },
    );
  }
}
