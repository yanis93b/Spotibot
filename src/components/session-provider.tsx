"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

/**
 * Client-side SessionProvider wrapper. Required for useSession() to work in
 * client components (e.g. the sign-out button in the sidebar).
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}

export default SessionProvider;
