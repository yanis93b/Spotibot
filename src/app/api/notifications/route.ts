/**
 * src/app/api/notifications/route.ts
 *
 * GET  /api/notifications  — list the current user's notifications
 *                            (newest first, max 30, scoped by userId).
 * POST /api/notifications  — mark all as read when body is `{ readAll: true }`.
 *
 * Auth: required for both handlers (`getCurrentUserId`). Every query is
 * scoped by the caller's `userId` — there is no way to read or modify
 * another user's notifications.
 *
 * The `Notification` table is documented in `prisma/schema-notifications.md`
 * and is added to `prisma/schema.prisma` by the orchestrator (followed by
 * `bun run db:push`). Until that merge runs, `db.notification.*` does not
 * type-check — this is the same pattern used by Tasks 2-A, 2-D, 3-A, 3-D.
 *
 * Responses:
 *   200 — { notifications: NotificationItem[] }   (GET)
 *   200 — { success: true, updated: number }      (POST, mark all read)
 *   400 — { error: string }                       (POST, bad body)
 *   401 — { error: "Unauthorized" }
 *   500 — { error: string }
 *
 * Server-only: route handlers under `app/api/` always run on the server in
 * Next.js 16, and we never import client-only code here.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

/** Always evaluate dynamically — notification state changes constantly. */
export const dynamic = "force-dynamic";

/** Coarse category of a notification. Drives the bell UI's icon + accent. */
export type NotificationType =
  | "follow"
  | "like"
  | "generation"
  | "system";

/** Public shape of a notification returned over the API. */
export interface NotificationItem {
  id: string;
  /** Free-form string; usually one of NotificationType, but unknown values
   *  are tolerated so adding a new type later is non-breaking. */
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * GET /api/notifications — list the current user's notifications.
 *
 * Newest first, capped at 30 rows. The composite index
 * `@@index([userId, read, createdAt])` makes this a single indexed range
 * scan — no table scan even for users with thousands of notifications.
 */
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      // Cap at 30 — the bell dropdown only renders the recent slice. A
      // future "view all" page can add pagination.
      take: 30,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        read: true,
        createdAt: true,
      },
    });

    const notifications: NotificationItem[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      body: r.body,
      read: r.read,
      createdAt: r.createdAt.toISOString(),
    }));

    return NextResponse.json({ notifications }, { status: 200 });
  } catch (err) {
    console.error("notifications: failed to list", err);
    return NextResponse.json(
      { error: "Failed to load notifications." },
      { status: 500 },
    );
  }
}

/** Zod schema for the POST body. Only `{ readAll: true }` is supported. */
const postSchema = z.object({
  readAll: z.literal(true),
});

/**
 * POST /api/notifications — mark every unread notification for the current
 * user as read.
 *
 * Body: `{ readAll: true }` (any other shape is a 400 — keeps the endpoint
 * narrowly scoped to the one operation the bell component needs).
 *
 * Uses `updateMany` so the operation is idempotent: a POST when there are
 * zero unread rows returns `{ success: true, updated: 0 }` instead of
 * throwing P2025 (which a per-row `update` would do).
 */
export async function POST(req: NextRequest) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          parsed.error.issues[0]?.message ??
          "Body must be { readAll: true }.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await db.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    return NextResponse.json(
      { success: true, updated: result.count },
      { status: 200 },
    );
  } catch (err) {
    console.error("notifications: failed to mark all read", err);
    return NextResponse.json(
      { error: "Failed to mark notifications as read." },
      { status: 500 },
    );
  }
}
