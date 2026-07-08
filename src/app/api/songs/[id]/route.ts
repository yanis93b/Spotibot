/**
 * src/app/api/songs/[id]/route.ts
 *
 * DELETE /api/songs/[id]  — delete a song (and its stored audio bytes).
 * PATCH  /api/songs/[id]  — partial update; currently supports toggling `liked`.
 *
 * Responses:
 *   200 — { success: true, song?: Song }   (PATCH returns the updated public Song)
 *   404 — { error: "Song not found" }
 *   400 — { error: string }  (PATCH body validation)
 *   500 — { error: string }
 *
 * The 404 is produced by catching Prisma's `P2025` "record not found" error
 * thrown by `db.song.delete` / `db.song.update` when the id does not match.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";
import { getCurrentUserId } from "@/lib/session";

/** Body schema for PATCH. Only `liked` is mutable for now. */
const patchSchema = z.object({
  liked: z.boolean().optional(),
});

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
    await db.song.delete({ where: { id, ownerId: userId } });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Song not found" },
        { status: 404 },
      );
    }
    console.error("songs/[id]: failed to delete song", err);
    return NextResponse.json(
      { error: "Failed to delete song." },
      { status: 500 },
    );
  }
}

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
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Build the update payload from the recognized fields.
  const data: { liked?: boolean } = {};
  if (typeof parsed.data.liked === "boolean") {
    data.liked = parsed.data.liked;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No updatable fields provided." },
      { status: 400 },
    );
  }

  try {
    const row = await db.song.update({ where: { id, ownerId: userId }, data });
    return NextResponse.json({ success: true, song: toPublicSong(row) }, { status: 200 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Song not found" },
        { status: 404 },
      );
    }
    console.error("songs/[id]: failed to update song", err);
    return NextResponse.json(
      { error: "Failed to update song." },
      { status: 500 },
    );
  }
}
