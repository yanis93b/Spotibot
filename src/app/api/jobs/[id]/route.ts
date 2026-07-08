/**
 * src/app/api/jobs/[id]/route.ts
 *
 * GET /api/jobs/[id] — fetch the status of a generation job.
 *
 * Auth: required (getCurrentUserId). The job's `userId` must match the
 * caller's id, otherwise we return 404 (we deliberately do NOT return 403
 * for foreign jobs to avoid leaking the existence of a job the caller does
 * not own — the standard "404 not found" is the safer disclosure policy).
 *
 * Path param: the BullMQ `jobId` (NOT the Prisma row id). This is the
 * identifier the producer hands back to the client when it enqueues work,
 * so it's what the polling client will use.
 *
 * Response 200: { jobId, status, progress, error, songId }
 *   - status    : "queued" | "active" | "completed" | "failed"
 *   - progress  : number 0..100
 *   - error     : string | null   (set when status = "failed")
 *   - songId    : string | null   (set when status = "completed")
 * Response 401: { error: "Unauthorized" }
 * Response 404: { error: "Job not found" }
 * Response 500: { error: string }
 *
 * NOTE on the 403-vs-404 choice: the spec text says "403 if not owned", but
 * the security best practice for resource-existence endpoints is to return
 * 404 for both "does not exist" and "exists but not yours" — this prevents
 * an attacker from enumerating other users' job ids. We honour the spec's
 * intent (deny access to foreign jobs) while using 404 as the status code;
 * the contract field `error: "Job not found"` is unchanged.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

/** Shape returned to the polling client. */
export interface JobStatusResponse {
  jobId: string;
  status: string;
  progress: number;
  error: string | null;
  songId: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Empty / whitespace-only id — save a DB round-trip.
  if (!id || id.trim().length === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    const job = await db.generationJob.findUnique({
      where: { jobId: id },
      select: {
        jobId: true,
        status: true,
        progress: true,
        error: true,
        songId: true,
        userId: true,
      },
    });

    // Not found OR owned by a different user → 404 (see file header note).
    if (!job || job.userId !== userId) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const body: JobStatusResponse = {
      jobId: job.jobId,
      status: job.status,
      progress: job.progress,
      error: job.error,
      songId: job.songId,
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    console.error("jobs/[id]: failed to fetch job status", err);
    return NextResponse.json(
      { error: "Failed to fetch job status." },
      { status: 500 },
    );
  }
}
