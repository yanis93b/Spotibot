/**
 * src/app/api/follow/route.ts
 *
 * POST /api/follow          — follow a user { followingId }
 * GET  /api/follow          — list the users I follow
 *
 * Auth: required for both handlers (`getCurrentUserId`).
 *
 * POST rules:
 *   - can't follow yourself → 400
 *   - target user must exist → 404 (verified before insert; no existence leak
 *     through Prisma errors because we explicitly look the user up first)
 *   - already following → 400 (P2002 from the compound unique — mapped to a
 *     friendly message so the client can show a toast)
 *
 * GET returns the newest follows first, with the public user fields the spec
 * calls for (`id`, `name`, `username`, `image`). `username` is `null` in this
 * round — the User model has no such column yet (documented in
 * `prisma/schema-follow.md`).
 *
 * Responses:
 *   200 — { following: PublicUser[] }                       (GET)
 *   201 — { id, followerId, followingId, createdAt }        (POST, new follow)
 *   200 — { id, followerId, followingId, createdAt }        (POST, already following — idempotent)
 *   400 — { error: string }  (self-follow / already-following / bad body)
 *   401 — { error: "Unauthorized" }
 *   404 — { error: "User not found." }                      (POST, unknown followingId)
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

/** Always evaluate dynamically — follow state changes constantly. */
export const dynamic = "force-dynamic";

/** Public shape of a user in follow listings (per spec). */
export interface PublicUser {
  id: string;
  name: string | null;
  /** Reserved for a future `username` column on User. `null` for now. */
  username: string | null;
  image: string | null;
}

/** Zod schema for the POST body. */
const followSchema = z.object({
  followingId: z.string().trim().min(1, "followingId is required"),
});

/**
 * GET /api/follow — list the users I follow, newest first.
 *
 * Returns the public projection defined by `PublicUser` for each row.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await db.follow.findMany({
      where: { followerId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        following: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    const following: PublicUser[] = rows.map((r) => ({
      id: r.following.id,
      name: r.following.name,
      // The User model has no `username` field yet — see schema-follow.md.
      username: null,
      image: r.following.image,
    }));

    return NextResponse.json({ following }, { status: 200 });
  } catch (err) {
    console.error("follow: failed to list", err);
    return NextResponse.json(
      { error: "Failed to load following list." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/follow — follow a user.
 *
 * Validation order: auth → body shape → self-follow check → existence →
 * insert (with P2002 → already-following friendly 400).
 *
 * Idempotency: if the caller already follows the target, we return 200 (not
 * 201) with the existing Follow row so the client doesn't have to special-case
 * the "already following" error.
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse + validate body ──────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = followSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const followingId = parsed.data.followingId;

  // ── Self-follow guard ──────────────────────────────────────────────────
  if (followingId === userId) {
    return NextResponse.json(
      { error: "You can't follow yourself." },
      { status: 400 },
    );
  }

  try {
    // ── Verify the target user exists (404, no existence leak via errors) ──
    const target = await db.user.findUnique({
      where: { id: followingId },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: "User not found." },
        { status: 404 },
      );
    }

    // ── Create the follow row ───────────────────────────────────────────
    const row = await db.follow.create({
      data: { followerId: userId, followingId },
      select: {
        id: true,
        followerId: true,
        followingId: true,
        createdAt: true,
      },
    });

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    // P2002 = unique constraint violation on [followerId, followingId].
    // The caller already follows the target — return the existing row with
    // 200 so the client treats it as success.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      try {
        const existing = await db.follow.findUnique({
          where: {
            followerId_followingId: {
              followerId: userId,
              followingId,
            },
          },
          select: {
            id: true,
            followerId: true,
            followingId: true,
            createdAt: true,
          },
        });
        if (existing) {
          return NextResponse.json(existing, { status: 200 });
        }
      } catch {
        // Fall through to the generic 500 below if the lookup itself fails.
      }
      return NextResponse.json(
        { error: "You already follow this user." },
        { status: 400 },
      );
    }

    // P2003 = foreign key constraint failure. This shouldn't happen — we
    // pre-flight the target's existence above — but a race (user deleted
    // between the findUnique and the create) would surface here. Treat it
    // as a 404 to avoid leaking the FK error to the client.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "User not found." },
        { status: 404 },
      );
    }

    console.error("follow: failed to create", err);
    return NextResponse.json(
      { error: "Failed to follow user." },
      { status: 500 },
    );
  }
}
