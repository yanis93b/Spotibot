/**
 * src/app/u/[username]/page.tsx
 *
 * Public user profile page. A Server Component that:
 *   1. Reads `username` from the path (Next.js 16 — `params` is a Promise).
 *   2. Looks the user up server-side via Prisma (lowercase, trimmed — the DB
 *      only ever stores lowercase usernames so this hits the @unique index).
 *   3. Renders Next.js's 404 via `notFound()` when the username doesn't exist.
 *   4. Determines `isOwnProfile` by comparing the profile owner's `id` against
 *      the authenticated viewer's session user id (`getServerSession` +
 *      `authOptions`). When the viewer isn't signed in, `isOwnProfile` is
 *      `false` — the page is still fully public.
 *   5. Renders `<ProfileView>` with the username + `isOwnProfile` flag.
 *
 * `<ProfileView>` is a client component that fetches its own data via
 * `GET /api/profile/[username]` (public), so this server component only needs
 * to (a) verify existence for the 404 path and (b) compute `isOwnProfile`.
 *
 * The route is `force-dynamic` so:
 *   - The existence check runs on every request (no stale 404s after a user
 *     sets/changes their username).
 *   - The `isOwnProfile` flag reflects the *current* viewer, not whoever first
 *     cached the page.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ProfileView } from "@/components/music/profile-view";

/** Never cache — existence + ownership are per-request. */
export const dynamic = "force-dynamic";

/**
 * Best-effort dynamic `<title>` so the browser tab + link previews show the
 * `@username` even before `<ProfileView>` hydrates. Falls back to a generic
 * label when the username doesn't resolve (the page itself will 404 anyway).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username: rawUsername } = await params;
  const username = rawUsername.trim().toLowerCase();
  return {
    title: username ? `@${username} — SpotiBot` : "Profile — SpotiBot",
    description: `Listen to tracks and playlists by @${username} on SpotiBot.`,
  };
}

interface ProfilePageProps {
  params: Promise<{ username: string }>;
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username: rawUsername } = await params;
  // Match the API route's normalization: trim + lowercase. The DB stores
  // lowercase usernames only (the PATCH validator enforces this), so the
  // lowercase lookup hits the @unique index on `username`.
  const username = rawUsername.trim().toLowerCase();

  // Existence check + grab the owner's `id` for the isOwnProfile comparison.
  // Only `id` is selected — `<ProfileView>` re-fetches the full public payload
  // client-side, so there's no need to pull more fields here.
  const profileUser = await db.user.findUnique({
    where: { username },
    select: { id: true },
  });
  if (!profileUser) {
    notFound();
  }

  // Determine ownership server-side. `getServerSession(authOptions)` is the
  // spec'd pattern (matches the API routes' auth helper). The session's `user`
  // object carries the `id` we embedded in the JWT callback (`auth.ts`).
  const session = await getServerSession(authOptions);
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  const isOwnProfile = !!sessionUserId && sessionUserId === profileUser.id;

  return <ProfileView username={username} isOwnProfile={isOwnProfile} />;
}
