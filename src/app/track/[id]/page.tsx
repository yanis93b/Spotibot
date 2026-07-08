/**
 * src/app/track/[id]/page.tsx
 *
 * Public track share page. A Server Component that:
 *   1. Reads `id` from the path (Next.js 16 — `params` is a Promise).
 *   2. Fetches the PUBLIC track payload from `GET /api/track/[id]` server-side.
 *      The endpoint is auth-free (the cuid track id IS the share secret), so
 *      logged-out visitors can render this page.
 *   3. Renders Next.js's 404 via `notFound()` when the track doesn't exist
 *      (404 from the API) or the fetch itself fails.
 *   4. Renders `<TrackEmbed track={track} />` — a self-contained full-screen
 *      player that drives a shared `<audio>` element via the player store.
 *
 * The server-side fetch uses `NEXTAUTH_URL` (always `http://localhost:3000` in
 * dev, configurable for prod) as the origin. This avoids a fragile
 * `headers()`-derived origin that can break behind the Caddy gateway, and
 * keeps the page decoupled from the API route's Prisma queries — if the API
 * response shape ever changes, only the API route + this fetch need updating.
 *
 * `force-dynamic` so a track that gets deleted doesn't serve a stale cached
 * share page, and so the title metadata reflects the *current* track title.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrackEmbed } from "@/components/music/track-embed";
import type { PublicTrack } from "@/app/api/track/[id]/route";

/** Never cache — track may be deleted, title may change. */
export const dynamic = "force-dynamic";

/**
 * Resolves the origin to use for the intra-server fetch.
 *
 * Prefers `NEXTAUTH_URL` (always set in `.env`), then falls back to
 * `http://localhost:3000` (the dev server's only allowed port). Both yield a
 * URL the Next.js dev server will route back to its own `/api/track/[id]`
 * handler.
 */
function apiOrigin(): string {
  const fromEnv = process.env.NEXTAUTH_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return "http://localhost:3000";
}

/**
 * Dynamic `<title>` + OpenGraph metadata so the share link unfurls with the
 * track title. Falls back to a generic label if the fetch fails (the page
 * itself will 404 in that case, so the metadata is moot).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  let title = "Track — SpotiBot";
  try {
    const res = await fetch(
      `${apiOrigin()}/api/track/${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    if (res.ok) {
      const data = (await res.json()) as PublicTrack;
      title = `${data.title} — SpotiBot`;
    }
  } catch {
    // Swallow — metadata is best-effort; the page body will 404.
  }
  return {
    title,
    openGraph: { title },
    twitter: { card: "summary" },
  };
}

interface TrackPageProps {
  params: Promise<{ id: string }>;
}

export default async function TrackPage({ params }: TrackPageProps) {
  const { id } = await params;

  let track: PublicTrack | null = null;
  try {
    const res = await fetch(
      `${apiOrigin()}/api/track/${encodeURIComponent(id)}`,
      { cache: "no-store" },
    );
    // 404 → notFound(). 5xx → also notFound() (a broken upstream shouldn't
    // render a half-loaded share page; the visitor will see the 404 page).
    if (res.ok) {
      track = (await res.json()) as PublicTrack;
    }
  } catch (err) {
    // Network error / JSON parse error / etc. — log + 404. The share link is
    // dead either way; the 404 page is the right UX.
    console.error("track/[id]/page: failed to fetch public track", err);
  }

  if (!track) {
    notFound();
  }

  return <TrackEmbed track={track} />;
}
