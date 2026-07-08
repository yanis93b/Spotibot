/**
 * src/app/api/health/ace/route.ts
 *
 * GET /api/health/ace
 *
 * Reports whether the Ace Music cloud API is reachable and the configured API
 * key is valid. The UI polls this on load to surface connection status in the
 * header, so the user knows whether generation will work before they type.
 *
 * Responses:
 *   200 — { ok: boolean, model?: string, configured: boolean, error?: string }
 */

import { NextResponse } from "next/server";
import { checkAceHealth, ACE_CONFIG } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!ACE_CONFIG.configured) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error: "ACE_API_KEY is not set on the server.",
      },
      { status: 200 },
    );
  }
  const result = await checkAceHealth();
  return NextResponse.json(
    {
      ok: result.ok,
      configured: true,
      model: result.model ?? ACE_CONFIG.model,
      error: result.error,
    },
    { status: 200 },
  );
}
