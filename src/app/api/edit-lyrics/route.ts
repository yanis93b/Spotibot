/**
 * src/app/api/edit-lyrics/route.ts
 *
 * POST /api/edit-lyrics — queue a flow-edit (lyrics replacement) job.
 *
 * Pipeline contract (Phase P3):
 *   The user rewrites the lyrics of a song they own. Rather than just
 *   patching the `lyrics` text column (which `/api/songs/[id]/lyrics` already
 *   does), this route kicks off a full flow-edit:
 *     1. Verify ownership of `songId` (Prisma query scoped by ownerId).
 *     2. Enqueue a job on the BullMQ `edit` queue with `{ songId, newLyrics }`.
 *     3. The worker calls the self-hosted ACE-Step `/edit` endpoint with the
 *        original audio + original lyrics + new lyrics, receives a new audio
 *        render where the vocals are replaced while the instrumentation is
 *        preserved as closely as possible, persists it back to the same Song
 *        row (audio bytes + lyrics), and publishes progress over Redis.
 *
 * Auth: REQUIRED, plus ownership verification. A user can only edit lyrics of
 * songs they own. Foreign songs surface as a uniform 404 (no ownership leak).
 *
 * Request:
 *   application/json
 *     { songId: string, newLyrics: string }
 *
 * Responses:
 *   202 — { jobId: string, status: "queued" }
 *   400 — { error: string }  (invalid body / lyrics length)
 *   401 — { error: "Unauthorized" }
 *   404 — { error: "Song not found" }  (missing OR not owned by caller)
 *   500 — { error: string }
 *   503 — { error: string }  (Redis not configured — worker pipeline offline)
 *
 * Server-only. Imported by Next.js App Router.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";
import { editQueue, isQueueAvailable } from "@/lib/queue";

/** Max characters for edited lyrics. Mirrors /api/songs/[id]/lyrics. */
const LYRICS_MAX_CHARS = 5000;
/** Min characters — empty edit makes no sense (no-op), reject below this. */
const LYRICS_MIN_CHARS = 1;

const bodySchema = z.object({
  songId: z
    .string()
    .trim()
    .min(1, "songId is required")
    .max(100, "songId is too long"),
  newLyrics: z
    .string()
    .trim()
    .min(
      LYRICS_MIN_CHARS,
      "New lyrics cannot be empty.",
    )
    .max(
      LYRICS_MAX_CHARS,
      `Lyrics must be at most ${LYRICS_MAX_CHARS} characters.`,
    ),
});

export async function POST(req: NextRequest) {
  // 1. Auth — every edit must be made by a signed-in user.
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Feature gate — same Redis requirement as /api/remix.
  if (!isQueueAvailable) {
    return NextResponse.json(
      {
        error:
          "Edit pipeline is offline — set REDIS_URL and start the worker to enable it.",
      },
      { status: 503 },
    );
  }

  // 3. Parse JSON body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid request body.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { songId, newLyrics } = parsed.data;

  // 4. Verify ownership. A findFirst scoped by both id AND ownerId collapses
  //    "not found" and "owned by someone else" into a single 404 so we never
  //    leak the existence of foreign songs. We also pull the original lyrics
  //    + audio format so the worker has what it needs to perform the flow-edit
  //    without a second round-trip.
  const song = await db.song.findFirst({
    where: { id: songId, ownerId: userId },
    select: {
      id: true,
      title: true,
      lyrics: true,
      prompt: true,
      genre: true,
      mood: true,
      style: true,
      voice: true,
      audioFormat: true,
      durationMs: true,
    },
  });

  if (!song) {
    return NextResponse.json(
      { error: "Song not found" },
      { status: 404 },
    );
  }

  // 5. Enqueue the edit job. The worker fetches the original audio (via the
  //    same auth-scoped /api/audio/[id] endpoint or directly from S3 if
  //    configured), runs the flow-edit, and overwrites the song row.
  try {
    const job = await editQueue.add(
      "edit",
      {
        userId,
        songId: song.id,
        originalTitle: song.title,
        originalLyrics: song.lyrics,
        newLyrics,
        // Pass-through metadata so the worker doesn't need to re-fetch the row
        // just to build the ACE-Step request envelope.
        prompt: song.prompt,
        genre: song.genre,
        mood: song.mood,
        style: song.style,
        language: song.voice,
        audioFormat: song.audioFormat,
        durationMs: song.durationMs,
        createdAt: new Date().toISOString(),
      },
    );

    return NextResponse.json(
      { jobId: job.id, status: "queued" },
      { status: 202 },
    );
  } catch (err) {
    console.error("edit-lyrics: failed to enqueue job", err);
    return NextResponse.json(
      { error: "Failed to queue edit job. Please try again." },
      { status: 500 },
    );
  }
}
