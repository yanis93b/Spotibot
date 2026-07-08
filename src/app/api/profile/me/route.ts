/**
 * src/app/api/profile/me/route.ts
 *
 * GET   /api/profile/me  — returns the CURRENT user's full profile
 *                          (same shape as /api/profile/[username]).
 *                          Auth required — 401 when not signed in.
 *
 * PATCH /api/profile/me  — update the current user's name / bio / username.
 *                          Auth required — 401 when not signed in.
 *                          Body is zod-validated; username uniqueness is
 *                          enforced (P2002 → 400 "Username is already taken").
 *
 * Responses:
 *   GET    200 — PublicProfileResponse  (user + songs + playlists)
 *          401 — { error: "Unauthorized" }
 *          500 — { error: string }
 *
 *   PATCH  200 — { user: PublicProfileUser }   (the updated identity block)
 *          400 — { error: string }  (validation / no fields / username taken)
 *          401 — { error: "Unauthorized" }
 *          500 — { error: string }
 *
 * The username validator enforces: 3–20 chars, lowercase letters + digits +
 * single hyphens, must start/end alphanumeric. Same rules documented in
 * `prisma/schema-profile.md`.
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { toPublicSong } from "@/lib/song-mapper";
import { getCurrentUserId } from "@/lib/session";
import type { Song } from "@/lib/types";

/**
 * Local copies of the public-profile response types — kept in sync with
 * `src/app/api/profile/[username]/route.ts`. We intentionally do NOT cross-
 * import from the sibling route file (route-to-route imports can confuse
 * Next.js's route-file bundler); the type-only duplication is small and the
 * shapes are frozen by the spec.
 */
interface PublicProfileUser {
  id: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  image: string | null;
  createdAt: string; // ISO 8601
}

interface PublicPlaylistSummary {
  id: string;
  name: string;
  trackCount: number;
  createdAt: string; // ISO 8601
}

interface PublicProfileResponse {
  user: PublicProfileUser;
  songs: Song[];
  playlists: PublicPlaylistSummary[];
}

/** Upper bounds mirror the public endpoint. */
const MAX_SONGS = 50;
const MAX_PLAYLISTS = 50;

/**
 * Username validator.
 *
 * The regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` matches one or more alphanumeric
 * segments separated by single hyphens — this implicitly enforces:
 *   - starts with alphanumeric (first segment is `[a-z0-9]+`)
 *   - ends with alphanumeric (last segment is `[a-z0-9]+`)
 *   - no consecutive hyphens (each `-` separates two non-empty segments)
 * Combined with `.min(3).max(20)` we get the full 3–20 char, lowercase,
 * alphanumeric + hyphens spec.
 */
const usernameField = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be at most 20 characters")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Username must be 3–20 lowercase letters, numbers, and hyphens; cannot start or end with a hyphen or contain consecutive hyphens",
  );

const patchSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name cannot be empty")
      .max(80, "Name must be at most 80 characters")
      .optional(),
    bio: z
      .string()
      .max(200, "Bio must be at most 200 characters")
      // Allow null to explicitly clear the bio.
      .nullable()
      .optional(),
    username: usernameField.optional(),
  })
  .refine((data) => {
    const keys = Object.keys(data);
    return keys.some((k) => data[k as keyof typeof data] !== undefined);
  }, "No updatable fields provided");

/** Build the public identity block from a Prisma user row. */
function toPublicUser(row: {
  id: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  image: string | null;
  createdAt: Date;
}): PublicProfileUser {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    bio: row.bio,
    image: row.image,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Load the current user's full profile (user + songs + playlists). */
async function loadMyProfile(userId: string): Promise<PublicProfileResponse | null> {
  const [user, songRows, playlistRows] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        bio: true,
        image: true,
        createdAt: true,
      },
    }),
    db.song.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "desc" },
      take: MAX_SONGS,
    }),
    db.playlist.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: "desc" },
      take: MAX_PLAYLISTS,
      include: { items: { select: { id: true } } },
    }),
  ]);

  if (!user) return null;

  const playlists: PublicPlaylistSummary[] = playlistRows.map((p) => ({
    id: p.id,
    name: p.name,
    trackCount: p.items.length,
    createdAt: p.createdAt.toISOString(),
  }));

  const songs: Song[] = songRows.map(toPublicSong);

  return { user: toPublicUser(user), songs, playlists };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — current user's full profile
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const profile = await loadMyProfile(userId);
    if (!profile) {
      // Should never happen (the session has a user id but the row is gone),
      // but handle it gracefully — treat as unauthorized.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(profile, { status: 200 });
  } catch (err) {
    console.error("profile/me: failed to load", err);
    return NextResponse.json(
      { error: "Failed to load profile." },
      { status: 500 },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — update name / bio / username
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // Build the Prisma update payload — only fields that were explicitly
  // provided in the body. `null` for bio is intentional (clears the field).
  // Username must never be set to null/empty here (the validator would have
  // rejected it).
  const data: {
    name?: string;
    bio?: string | null;
    username?: string;
  } = {};

  if (parsed.data.name !== undefined) {
    data.name = parsed.data.name;
  }
  if (parsed.data.bio !== undefined) {
    data.bio = parsed.data.bio;
  }
  if (parsed.data.username !== undefined) {
    // Lowercase defensively — the validator already enforces lowercase, but
    // this guards against any future regex relaxation.
    data.username = parsed.data.username.toLowerCase();
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "No updatable fields provided." },
      { status: 400 },
    );
  }

  try {
    // Pre-flight username uniqueness check (cheaper than relying solely on
    // P2002 — gives a clean, specific error message and avoids a write
    // attempt that we know will fail).
    if (data.username) {
      const existing = await db.user.findUnique({
        where: { username: data.username },
        select: { id: true },
      });
      if (existing && existing.id !== userId) {
        return NextResponse.json(
          { error: "Username is already taken." },
          { status: 400 },
        );
      }
    }

    const updated = await db.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        name: true,
        username: true,
        bio: true,
        image: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      { user: toPublicUser(updated) },
      { status: 200 },
    );
  } catch (err) {
    // P2002 = unique constraint violation. Even though we pre-flighted, a
    // race between the pre-flight check and the update could still produce
    // this — handle it cleanly.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Username is already taken." },
        { status: 400 },
      );
    }
    console.error("profile/me: failed to update", err);
    return NextResponse.json(
      { error: "Failed to update profile." },
      { status: 500 },
    );
  }
}
