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
  // Protect everything EXCEPT: the sign-in page, the auth API, static assets,
  // the PWA service worker and web manifest (must be reachable pre-auth so the
  // SW can register and the app can be installed).
  matcher: [
    "/((?!signin|api/auth|_next/static|_next/image|favicon|spotibot-brand|favicon-32|apple-touch-icon|og-image|robots|sw\\.js|manifest\\.json|api/manifest).*)",
  ],
};
