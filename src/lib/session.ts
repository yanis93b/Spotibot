/**
 * Server-side auth helpers for API routes.
 *
 * `getCurrentUser()` returns the authenticated user's id (or null) by reading
 * the NextAuth session server-side. Every protected API route calls this to
 * scope its queries by `ownerId`.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

/**
 * Returns the current authenticated user, or null if not signed in.
 * Safe to call in any server component or API route.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const id = (session.user as { id?: string }).id;
  if (!id) return null;
  return {
    id,
    email: session.user.email ?? "",
    name: session.user.name,
    image: session.user.image,
  };
}

/**
 * Returns the current user's id, or null if not signed in.
 * Convenience wrapper for API routes that only need the id.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}

/**
 * Throws a 401-friendly error object when the user is not authenticated.
 * Use in API routes: `const userId = requireAuth();` (after await).
 */
export async function requireUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) {
    throw new Error("UNAUTHORIZED");
  }
  return id;
}
