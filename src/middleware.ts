/**
 * Middleware: protect all pages except /signin and the auth API routes.
 *
 * Unauthenticated users are redirected to /signin. Authenticated users are
 * allowed through.
 */

import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/signin",
  },
});

export const config = {
  // Protect everything EXCEPT: sign-in, auth API, static assets, PWA SW/manifest,
  // and PUBLIC routes (public profiles /u/*, public tracks /track/*, public track API).
  matcher: [
    "/((?!signin|api/auth|api/track|api/discover|api/trending|api/manifest|_next/static|_next/image|favicon|spotibot-brand|favicon-32|apple-touch-icon|og-image|robots|sw\\.js|manifest\\.json|u|track).*)",
  ],
};
