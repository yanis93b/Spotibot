/**
 * src/app/api/follow/[userId]/route.ts
 *
 * DELETE /api/follow/[userId]  — unfollow a user
 * GET    /api/follow/[userId]  — check if I follow this user
 *
 * Auth: required for both handlers (`getCurrentUserId`).
 *
 * The `[userId]` path param is the *target* user (the one being unfollowed /
 * checked), NOT the current user. The current user is always the follower —
 * derived from the session.
 *
 * DELETE behavior:
 *   - 200 { success: true } when a row was deleted (was following → now not).
 *   - 200 { success: true } when no row existed (idempotent — already not
 *     following). This matches the spec's "DELETE = unfollow" semantics and
 *     keeps the client side simple: an "Unfollow" click always resolves to a
 *     success state.
 *   - 401 if not signed in.
 *
 * GET returns `{ following: boolean }` — true iff a Follow row with
 * `(followerId = me, followingId = userId)` exists.
 *
 * Note: neither handler reveals whether the target user *exists*. A GET on a
 * non-existent user id simply returns `{ following: false }`. This is the
 * same privacy posture as the rest of the API (no existence leak).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

/** Always evaluate dynamically — follow state changes constantly. */
export const dynamic = "force-dynamic";

/**
 * GET /api/follow/[userId] — check whether I follow the given user.
 *
 * Returns `{ following: boolean }`.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const meId = await getCurrentUserId();
  if (!meId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  try {
    // Single indexed point-read on the compound-unique key. We don't need
    // any columns back — just whether the row exists.
    const row = await db.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: meId,
          followingId: userId,
        },
      },
      select: { id: true },
    });

    return NextResponse.json({ following: row !== null }, { status: 200 });
  } catch (err) {
    console.error("follow/[userId]: failed to check", err);
    return NextResponse.json(
      { error: "Failed to check follow status." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/follow/[userId] — unfollow the given user.
 *
 * Idempotent: returns `{ success: true }` whether or not a row existed. We
 * use `deleteMany` (instead of `delete` with the compound key) so that a
 * not-followed target doesn't throw P2025 — keeps the client logic trivial.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const meId = await getCurrentUserId();
  if (!meId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  try {
    // deleteMany returns { count }, but we don't need it — the caller only
    // cares that the operation succeeded. Idempotent by construction.
    await db.follow.deleteMany({
      where: {
        followerId: meId,
        followingId: userId,
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("follow/[userId]: failed to unfollow", err);
    return NextResponse.json(
      { error: "Failed to unfollow user." },
      { status: 500 },
    );
  }
}
