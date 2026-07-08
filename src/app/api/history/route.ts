/**
 * src/app/api/history/route.ts
 *
 * GET  /api/history        — list the current user's listening history
 *                            (newest first, max 50, includes the played song).
 * POST /api/history        — record a single play event { songId }.
 *
 * Both handlers are scoped by `ownerId` via `getCurrentUserId()`. The POST
 * additionally verifies the song belongs to the caller (`ownerId: userId`)
 * before recording the play — defense in depth, never log plays of songs
 * the user doesn't own.
 *
 * Responses:
 *   200 — { history: HistoryEntry[] }   (GET)
 *   201 — HistoryEntry                  (POST)
 *   400 — { error: string }             (POST body validation)
 *   401 — { error: "Unauthorized" }
 *   404 — { error: "Song not found." }  (POST, when songId unknown / unowned)
 *   500 — { error: string }
 *
 * Server-only: route handlers under `app/api/` always run on the server in
 * Next.js 16, and we never import client-only code here.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";
import { getCurrentUserId } from "@/lib/session";

// Always evaluate dynamically — history changes on every play, so caching
// the GET response would show stale data.
export const dynamic = "force-dynamic";

/** Public shape of a history entry returned over the API. */
export interface HistoryEntry {
  id: string;
  playedAt: string; // ISO 8601
  song: ReturnType<typeof toPublicSong>;
}

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await db.listeningHistory.findMany({
      where: { userId },
      orderBy: { playedAt: "desc" },
      // Cap at 50 — the UI only renders the most recent plays. Pagination
      // can be added later if a full history view is needed.
      take: 50,
      include: { song: true },
    });

    const history: HistoryEntry[] = rows.map((r) => ({
      id: r.id,
      playedAt: r.playedAt.toISOString(),
      song: toPublicSong(r.song),
    }));

    return NextResponse.json({ history }, { status: 200 });
  } catch (err) {
    console.error("history: failed to list", err);
    return NextResponse.json(
      { error: "Failed to load listening history." },
      { status: 500 },
    );
  }
}

const addSchema = z.object({
  songId: z.string().trim().min(1, "songId is required"),
});

export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  try {
    // Verify ownership before recording — `findUnique({ id, ownerId })` is
    // the same compound-where pattern the rest of the API uses (returns
    // null for non-owned ids, no existence leakage).
    const song = await db.song.findUnique({
      where: { id: parsed.data.songId, ownerId: userId },
      select: { id: true },
    });
    if (!song) {
      return NextResponse.json(
        { error: "Song not found." },
        { status: 404 },
      );
    }

    const row = await db.listeningHistory.create({
      data: { userId, songId: parsed.data.songId },
      include: { song: true },
    });

    const entry: HistoryEntry = {
      id: row.id,
      playedAt: row.playedAt.toISOString(),
      song: toPublicSong(row.song),
    };

    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    console.error("history: failed to add", err);
    return NextResponse.json(
      { error: "Failed to record play." },
      { status: 500 },
    );
  }
}
