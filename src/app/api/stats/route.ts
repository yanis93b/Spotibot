/**
 * src/app/api/stats/route.ts
 *
 * GET /api/stats
 *
 * Creator analytics endpoint — returns aggregated stats about the current
 * user's tracks, used by the Creator Analytics dashboard
 * (`src/components/music/analytics-view.tsx`).
 *
 * Auth: required. Every query is scoped by the current user's `ownerId` so
 * a user can only ever see their own numbers (mirrors the rest of the API
 * surface — see `src/lib/session.ts` and the `auth-api-scoping` round).
 *
 * Response 200 — StatsResponse:
 *   totalTracks           number        — count of the user's songs
 *   totalLikes            number        — count where `liked === true`
 *   totalPlays            number        — count of ListeningHistory rows for
 *                                         the user's songs (any listener)
 *   tracksByGenre         {genre,count}[] — sorted by count desc, then name
 *   tracksByMood          {mood,count}[]  — sorted by count desc, then name
 *   recentPlays           number        — plays where playedAt > now - 7d
 *   mostPlayedTrack       {id,title,plays} | null
 *   generationThisMonth   number        — songs with createdAt in the
 *                                         current calendar month
 *
 * Responses:
 *   200 — StatsResponse
 *   401 — { error: "Unauthorized" }
 *   500 — { error: string }
 *
 * Implementation notes:
 *   - Two parallel Prisma queries (songs + history) fetch only the columns
 *     we need; all aggregation is done in JS to keep the SQLite load light
 *     and avoid N+1 / window-function workarounds.
 *   - ListeningHistory cascades on song delete, so every history row here
 *     belongs to a still-existing song owned by the caller — no orphan rows.
 *   - `force-dynamic`: stats change on every play / generation, so caching
 *     the GET would surface stale data.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Public shape of the stats response. Exported so the client component
 *  (and any future caller) can stay in lock-step with the server payload. */
export interface StatsResponse {
  totalTracks: number;
  totalLikes: number;
  totalPlays: number;
  tracksByGenre: { genre: string; count: number }[];
  tracksByMood: { mood: string; count: number }[];
  recentPlays: number;
  mostPlayedTrack: { id: string; title: string; plays: number } | null;
  generationThisMonth: number;
}

/** 7-day window for `recentPlays`, computed once per request. */
function computeSevenDaysAgo(now: Date): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

/** First instant of the current calendar month in local time. */
function computeMonthStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ── Parallel data fetch ───────────────────────────────────────────
    // Songs: only the scalar fields we need to aggregate. History: just
    // songId + playedAt; both queries are owner-scoped via `song.ownerId`.
    const [songs, plays] = await Promise.all([
      db.song.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          title: true,
          genre: true,
          mood: true,
          liked: true,
          createdAt: true,
        },
      }),
      db.listeningHistory.findMany({
        where: { song: { ownerId: userId } },
        select: { songId: true, playedAt: true },
      }),
    ]);

    // ── Totals from songs ─────────────────────────────────────────────
    const totalTracks = songs.length;
    const totalLikes = songs.reduce((n, s) => n + (s.liked ? 1 : 0), 0);

    // ── Genre breakdown (sorted: count desc, then name asc) ───────────
    const genreCount = new Map<string, number>();
    for (const s of songs) {
      genreCount.set(s.genre, (genreCount.get(s.genre) ?? 0) + 1);
    }
    const tracksByGenre: { genre: string; count: number }[] = Array.from(
      genreCount.entries(),
    )
      .map(([genre, count]) => ({ genre, count }))
      .sort(
        (a, b) => b.count - a.count || a.genre.localeCompare(b.genre),
      );

    // ── Mood breakdown (same sort) ────────────────────────────────────
    const moodCount = new Map<string, number>();
    for (const s of songs) {
      moodCount.set(s.mood, (moodCount.get(s.mood) ?? 0) + 1);
    }
    const tracksByMood: { mood: string; count: number }[] = Array.from(
      moodCount.entries(),
    )
      .map(([mood, count]) => ({ mood, count }))
      .sort((a, b) => b.count - a.count || a.mood.localeCompare(b.mood));

    // ── Plays: total + last-7-days ────────────────────────────────────
    const totalPlays = plays.length;
    const sevenDaysAgo = computeSevenDaysAgo(new Date());
    const recentPlays = plays.filter((p) => p.playedAt > sevenDaysAgo).length;

    // ── Most played track ─────────────────────────────────────────────
    // Aggregate plays per songId in a single pass; ties resolve to the
    // first-encountered song (stable). `topSongId` is then joined back to
    // the songs list for the title — every history row's songId is
    // guaranteed to exist (cascade on delete), but we guard defensively.
    const playsBySong = new Map<string, number>();
    for (const p of plays) {
      playsBySong.set(p.songId, (playsBySong.get(p.songId) ?? 0) + 1);
    }
    let topSongId: string | null = null;
    let topPlays = 0;
    for (const [songId, count] of playsBySong) {
      if (count > topPlays) {
        topPlays = count;
        topSongId = songId;
      }
    }
    let mostPlayedTrack: StatsResponse["mostPlayedTrack"] = null;
    if (topSongId) {
      const song = songs.find((s) => s.id === topSongId);
      if (song) {
        mostPlayedTrack = { id: song.id, title: song.title, plays: topPlays };
      }
    }

    // ── Tracks created this calendar month ────────────────────────────
    const monthStart = computeMonthStart(new Date());
    const generationThisMonth = songs.filter(
      (s) => s.createdAt >= monthStart,
    ).length;

    const body: StatsResponse = {
      totalTracks,
      totalLikes,
      totalPlays,
      tracksByGenre,
      tracksByMood,
      recentPlays,
      mostPlayedTrack,
      generationThisMonth,
    };

    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    console.error("stats: failed to aggregate", err);
    return NextResponse.json(
      { error: "Failed to load analytics." },
      { status: 500 },
    );
  }
}
