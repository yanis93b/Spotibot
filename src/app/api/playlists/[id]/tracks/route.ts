/**
 * src/app/api/playlists/[id]/tracks/route.ts
 *
 * POST   /api/playlists/[id]/tracks  — add a song to a playlist { songId }.
 * DELETE /api/playlists/[id]/tracks  — remove a song from a playlist { songId }.
 *
 * The join uses a unique [playlistId, songId] constraint so a song can appear
 * at most once per playlist. `position` is set to max(existing)+1 on add.
 *
 * Responses:
 *   200 — { success: true, song?: Song }
 *   400 — { error: string }  (missing songId / duplicate)
 *   404 — { error: "Playlist or song not found" }
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";
import { getCurrentUserId } from "@/lib/session";

const bodySchema = z.object({ songId: z.string().trim().min(1) });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: playlistId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "songId is required." },
      { status: 400 },
    );
  }
  const { songId } = parsed.data;

  try {
    // Verify both the playlist and the song exist AND belong to the caller.
    const [playlist, song] = await Promise.all([
      db.playlist.findUnique({ where: { id: playlistId, ownerId: userId }, select: { id: true } }),
      db.song.findUnique({ where: { id: songId, ownerId: userId } }),
    ]);
    if (!playlist || !song) {
      return NextResponse.json(
        { error: "Playlist or song not found" },
        { status: 404 },
      );
    }

    // Compute the next position (max + 1, or 0 for the first track).
    const lastItem = await db.playlistSong.findFirst({
      where: { playlistId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const nextPosition = (lastItem?.position ?? -1) + 1;

    const item = await db.playlistSong.create({
      data: { playlistId, songId, position: nextPosition },
    });
    return NextResponse.json(
      { success: true, song: toPublicSong(song) },
      { status: 200 },
    );
  } catch (err) {
    // P2002 → unique constraint violation (song already in playlist).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "Song is already in this playlist" },
        { status: 400 },
      );
    }
    console.error("playlists/[id]/tracks: failed to add", err);
    return NextResponse.json({ error: "Failed to add track." }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: playlistId } = await params;
  // songId may come from the query string for DELETE.
  const url = new URL(req.url);
  const songId = url.searchParams.get("songId");
  if (!songId) {
    return NextResponse.json({ error: "songId query param is required." }, { status: 400 });
  }

  try {
    // Verify the playlist belongs to the caller before mutating its tracks.
    const playlist = await db.playlist.findUnique({
      where: { id: playlistId, ownerId: userId },
      select: { id: true },
    });
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    await db.playlistSong.delete({
      where: { playlistId_songId: { playlistId, songId } },
    });
    // Re-pack positions so they stay contiguous after a removal.
    const items = await db.playlistSong.findMany({
      where: { playlistId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    await db.$transaction(
      items.map((item, idx) =>
        db.playlistSong.update({ where: { id: item.id }, data: { position: idx } }),
      ),
    );
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Track not in playlist" }, { status: 404 });
    }
    console.error("playlists/[id]/tracks: failed to remove", err);
    return NextResponse.json({ error: "Failed to remove track." }, { status: 500 });
  }
}
