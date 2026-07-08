/**
 * src/app/api/songs/[id]/lyrics/route.ts
 *
 * PATCH /api/songs/[id]/lyrics — update the lyrics of an existing song.
 *
 * Auth: required (uses `getCurrentUserId`). The query is scoped by `ownerId`
 * so a user can only edit the lyrics of songs they own. If the song does not
 * exist OR exists but is owned by someone else, the Prisma `update` call
 * throws `P2025` ("record not found") and we return 404. This deliberately
 * collapses both cases into a single 404 so we never leak ownership state.
 *
 * Body: `{ lyrics: string }` — zod-validated, 0..5000 chars after trim.
 *
 * Responses:
 *   200 — { success: true }
 *   400 — { error: string }  (invalid JSON / validation failure)
 *   401 — { error: "Unauthorized" }
 *   404 — { error: "Song not found" }  (not found OR not owned by caller)
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserId } from "@/lib/session";

/** Max characters allowed for edited lyrics. Mirrors the client counter. */
export const LYRICS_MAX_CHARS = 5000;

const bodySchema = z.object({
  lyrics: z
    .string()
    .trim()
    .min(0)
    .max(LYRICS_MAX_CHARS, {
      message: `Lyrics must be at most ${LYRICS_MAX_CHARS} characters.`,
    }),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Auth.
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Resolve route params (Next 16: params is a Promise).
  const { id } = await params;

  // 3. Parse + validate the JSON body.
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
    const message = parsed.error.issues[0]?.message ?? "Invalid request body.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // 4. Scoped update — the `ownerId` constraint guarantees a user can only
  //    edit their own songs. Missing id OR foreign-owned id both surface as
  //    Prisma P2025, which we translate to a uniform 404.
  try {
    await db.song.update({
      where: { id, ownerId: userId },
      data: { lyrics: parsed.data.lyrics },
    });
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
    console.error("songs/[id]/lyrics: failed to update lyrics", err);
    return NextResponse.json(
      { error: "Failed to update lyrics." },
      { status: 500 },
    );
  }
}
