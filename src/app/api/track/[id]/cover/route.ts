/**
 * src/app/api/track/[id]/cover/route.ts
 *
 * GET /api/track/[id]/cover — PUBLIC (no auth).
 *
 * Streams the AI-generated square cover-art PNG for a track to any visitor.
 * Public counterpart of the auth-protected `/api/cover/[id]` route. When a
 * track has no cover (generation failed), this route returns 404 and the
 * share page renders a deterministic gradient fallback instead.
 *
 * Privacy relies on the unguessability of the cuid track id (the share
 * secret) — same model as the sibling `./audio` endpoint.
 *
 * Responses:
 *   200 — image/png (Buffer body)
 *   404 — { error: "Cover not found" }
 *   500 — { error: string }
 *
 * Headers on 200:
 *   Content-Type:  image/png
 *   Content-Length: <byte length as string>
 *   Cache-Control:  public, max-age=86400, immutable
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // PUBLIC endpoint — no auth, no ownerId scoping. The cuid is the share secret.
    const song = await db.song.findUnique({
      where: { id },
      select: { coverData: true },
    });
    if (!song || !song.coverData) {
      return NextResponse.json(
        { error: "Cover not found" },
        { status: 404 },
      );
    }

    const buffer = song.coverData;
    const headers = new Headers({
      "Content-Type": "image/png",
      "Content-Length": String(buffer.length),
      "Cache-Control": "public, max-age=86400, immutable",
    });

    return new NextResponse(buffer, { status: 200, headers });
  } catch (err) {
    console.error("track/[id]/cover: failed to stream cover", err);
    return NextResponse.json(
      { error: "Failed to load cover." },
      { status: 500 },
    );
  }
}
