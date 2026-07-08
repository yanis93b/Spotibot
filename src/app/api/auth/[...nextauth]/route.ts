/**
 * NextAuth.js catch-all API route.
 * Handles /api/auth/signin, /api/auth/signout, /api/auth/session, etc.
 */
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
