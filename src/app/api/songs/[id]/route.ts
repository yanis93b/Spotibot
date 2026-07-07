/**
 * src/app/api/songs/[id]/route.ts
 *
 * DELETE /api/songs/[id]
 *
 * Deletes a single song row by id (including its stored audio bytes).
 *
 * Responses:
 *   200 — { success: true }
 *   404 — { error: "Song not found" }
 *   500 — { error: string }
 *
 * The 404 is produced by catching Prisma's `P2025` "record not found" error
 * thrown by `db.song.delete` when the id does not match any row.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await db.song.delete({ where: { id } });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    // P2025 → the row to delete did not exist.
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
