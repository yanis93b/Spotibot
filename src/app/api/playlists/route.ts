/**
 * src/app/api/playlists/route.ts
 *
 * GET  /api/playlists          — list all playlists (with trackCount + duration).
 * POST /api/playlists          — create a new playlist { name }.
 *
 * Responses:
 *   200 — { playlists: Playlist[] } | Playlist
 *   400 — { error: string }
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { toPublicPlaylist } from "@/lib/playlist-mapper";

export async function GET() {
  try {
    const rows = await db.playlist.findMany({
      include: { items: { include: { song: { select: { durationMs: true } } } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(
      { playlists: rows.map(toPublicPlaylist) },
      { status: 200 },
    );
  } catch (err) {
    console.error("playlists: failed to list", err);
    return NextResponse.json({ error: "Failed to load playlists." }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Playlist name is required").max(60, "Name too long"),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }
  try {
    const row = await db.playlist.create({
      data: { name: parsed.data.name },
      include: { items: { include: { song: { select: { durationMs: true } } } } },
    });
    return NextResponse.json(toPublicPlaylist(row), { status: 200 });
  } catch (err) {
    console.error("playlists: failed to create", err);
    return NextResponse.json({ error: "Failed to create playlist." }, { status: 500 });
  }
}
