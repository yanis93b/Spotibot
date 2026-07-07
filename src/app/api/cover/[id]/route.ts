/**
 * src/app/api/cover/[id]/route.ts
 *
 * GET /api/cover/[id]
 *
 * Streams the AI-generated square cover-art PNG for a song. Cover art is
 * generated alongside the audio (best-effort) and stored inline in SQLite.
 * When a song has no cover (generation failed), this route returns 404 and
 * the UI renders a deterministic gradient fallback instead.
 *
 * Responses:
 *   200 — image/png (Buffer body)
 *   404 — { error: "Cover not found" }
 *   500 — { error: string }
 *
 * Headers on 200:
 *   Content-Type:        image/png
 *   Content-Length:       <byte length as string>
 *   Cache-Control:        public, max-age=86400, immutable
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const song = await db.song.findUnique({ where: { id } });
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
    console.error("cover/[id]: failed to stream cover", err);
    return NextResponse.json(
      { error: "Failed to load cover." },
      { status: 500 },
    );
  }
}
