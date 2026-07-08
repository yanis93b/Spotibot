/**
 * src/app/api/history/[id]/route.ts
 *
 * DELETE /api/history/[id]  — remove a single listening-history entry.
 *
 * Scoped by `ownerId` via `getCurrentUserId()`: the compound `where:
 * { id, userId }` ensures a user can only delete their own history rows
 * (a non-owned id yields a 404, no existence leakage).
 *
 * Responses:
 *   200 — { success: true }
 *   401 — { error: "Unauthorized" }
 *   404 — { error: "History entry not found." }  (Prisma P2025 on delete)
 *   500 — { error: string }
 *
 * Server-only: route handlers under `app/api/` always run on the server in
 * Next.js 16, and we never import client-only code here.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

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
    // Scoped delete — Prisma throws P2025 "record not found" when the row
    // doesn't exist OR doesn't belong to the caller.
    await db.listeningHistory.delete({ where: { id, userId } });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2025"
    ) {
      return NextResponse.json(
        { error: "History entry not found." },
        { status: 404 },
      );
    }
    console.error("history/[id]: failed to delete", err);
    return NextResponse.json(
      { error: "Failed to delete history entry." },
      { status: 500 },
    );
  }
}
