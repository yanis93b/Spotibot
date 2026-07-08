/**
 * src/app/api/playlists/[id]/reorder/route.ts
 *
 * POST /api/playlists/[id]/reorder — rewrite the `position` of every
 * PlaylistSong row in this playlist so it matches the supplied ordering.
 *
 * Body: { orderedSongIds: string[] }
 *   The complete list of song ids belonging to this playlist, in the
 *   new desired order. The caller (frontend) is responsible for sending
 *   the full set; we do not diff — we just rewrite `position` from 0..N-1
 *   for each id in the order received.
 *
 * Auth: required (getCurrentUserId). The playlist must belong to the caller
 * (verified via `where: { id, ownerId: userId }`); otherwise 404 — no
 * existence leak to other users.
 *
 * Validation: zod schema enforces a non-empty array of non-empty strings.
 * We additionally cross-check that every id in the body is currently a
 * member of the playlist, and that no playlist song is missing from the
 * body. This prevents the caller from accidentally (or maliciously) dropping
 * rows or reordering a foreign song into the playlist.
 *
 * Atomicity: all `position` writes run inside a single `db.$transaction`
 * so the playlist is never left in a half-reordered state.
 *
 * Responses:
 *   200 — { success: true }
 *   400 — { error: string }  (malformed body / set mismatch)
 *   401 — { error: "Unauthorized" }
 *   404 — { error: "Playlist not found" }
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

/** Zod schema for the reorder body. */
const reorderSchema = z.object({
  orderedSongIds: z
    .array(z.string().trim().min(1, "songId must be non-empty"))
    .min(1, "orderedSongIds must contain at least one id"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth gate ──────────────────────────────────────────────────────────
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: playlistId } = await params;

  // ── Parse + validate body ──────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const orderedSongIds = parsed.data.orderedSongIds;

  // ── Dedup check ────────────────────────────────────────────────────────
  // A playlist cannot contain the same song twice (unique [playlistId, songId]),
  // so any duplicate id in the body is a client bug. Reject early so we don't
  // waste a transaction.
  const seen = new Set<string>();
  for (const id of orderedSongIds) {
    if (seen.has(id)) {
      return NextResponse.json(
        { error: `Duplicate song id in ordering: ${id}` },
        { status: 400 },
      );
    }
    seen.add(id);
  }

  try {
    // ── Verify ownership (404 — no existence leak) ───────────────────────
    const playlist = await db.playlist.findUnique({
      where: { id: playlistId, ownerId: userId },
      select: { id: true },
    });
    if (!playlist) {
      return NextResponse.json(
        { error: "Playlist not found" },
        { status: 404 },
      );
    }

    // ── Fetch the current PlaylistSong rows for this playlist ───────────
    // We only need the songId to cross-check the proposed ordering.
    const existingItems = await db.playlistSong.findMany({
      where: { playlistId },
      select: { songId: true },
    });
    const existingIds = new Set(existingItems.map((i) => i.songId));

    // ── Set-mismatch check ───────────────────────────────────────────────
    // The body MUST contain exactly the same set of song ids as the playlist
    // currently has — no missing, no extra. This keeps reorder a pure
    // position-rewrite (add/remove go through the /tracks endpoint).
    if (existingIds.size !== orderedSongIds.length) {
      return NextResponse.json(
        {
          error:
            "Ordered list length does not match playlist track count. Send the full list of song ids in the new order.",
        },
        { status: 400 },
      );
    }
    for (const id of orderedSongIds) {
      if (!existingIds.has(id)) {
        return NextResponse.json(
          { error: `Song ${id} is not in this playlist.` },
          { status: 400 },
        );
      }
    }

    // ── Rewrite positions atomically ────────────────────────────────────
    // Each PlaylistSong row is keyed by the compound unique [playlistId, songId],
    // so we can update by that key without first looking up the row's PK.
    // The transaction guarantees that either every position is updated or none.
    await db.$transaction(
      orderedSongIds.map((songId, index) =>
        db.playlistSong.update({
          where: { playlistId_songId: { playlistId, songId } },
          data: { position: index },
        }),
      ),
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    // P2025 → one of the [playlistId, songId] compounds didn't exist. This
    // should already be caught by the set-mismatch check above, but guard
    // against a race (track removed between fetch and update).
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2025"
    ) {
      return NextResponse.json(
        { error: "Playlist not found" },
        { status: 404 },
      );
    }
    console.error("playlists/[id]/reorder: failed to reorder", err);
    return NextResponse.json(
      { error: "Failed to reorder playlist." },
      { status: 500 },
    );
  }
}
