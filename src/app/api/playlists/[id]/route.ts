/**
 * src/app/api/playlists/[id]/route.ts
 *
 * GET    /api/playlists/[id]  — fetch a single playlist with its tracks (in order).
 * PATCH  /api/playlists/[id]  — rename a playlist { name }.
 * DELETE /api/playlists/[id]  — delete a playlist (cascade removes join rows).
 *
 * Responses:
 *   200 — Playlist (GET, with `songs: Song[]`) | Playlist (PATCH) | { success: true } (DELETE)
 *   404 — { error: "Playlist not found" }
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { toPublicPlaylist } from "@/lib/playlist-mapper";
import { toPublicSong } from "@/lib/song-mapper";
import { getCurrentUserId } from "@/lib/session";

/** Resolve a playlist row (scoped to `ownerId`) with its ordered items + nested songs. */
async function getPlaylistWithSongs(id: string, ownerId: string) {
  return db.playlist.findUnique({
    where: { id, ownerId },
    include: {
      items: {
        orderBy: { position: "asc" },
        include: { song: true },
      },
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const row = await getPlaylistWithSongs(id, userId);
    if (!row) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    const songs = row.items
      .map((item) => item.song)
      .filter(Boolean)
      .map(toPublicSong);
    const playlist = toPublicPlaylist({
      ...row,
      items: row.items.map((i) => ({ song: { durationMs: i.song?.durationMs ?? 0 } })),
    });
    return NextResponse.json({ ...playlist, songs }, { status: 200 });
  } catch (err) {
    console.error("playlists/[id]: failed to get", err);
    return NextResponse.json({ error: "Failed to load playlist." }, { status: 500 });
  }
}

const patchSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name too long"),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  try {
    const row = await db.playlist.update({
      where: { id, ownerId: userId },
      data: { name: parsed.data.name },
      include: { items: { include: { song: { select: { durationMs: true } } } } },
    });
    return NextResponse.json(toPublicPlaylist(row), { status: 200 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    console.error("playlists/[id]: failed to rename", err);
    return NextResponse.json({ error: "Failed to update playlist." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await db.playlist.delete({ where: { id, ownerId: userId } });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    console.error("playlists/[id]: failed to delete", err);
    return NextResponse.json({ error: "Failed to delete playlist." }, { status: 500 });
  }
}
