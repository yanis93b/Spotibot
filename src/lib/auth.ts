/**
 * NextAuth.js configuration.
 *
 * Uses the Credentials provider (email + password with bcrypt hashing) as the
 * primary auth method so the app works immediately without any external OAuth
 * setup. GitHub OAuth is also wired up — just fill GITHUB_CLIENT_ID /
 * GITHUB_CLIENT_SECRET in .env and it becomes available on the sign-in page.
 *
 * Sessions use JWT (stateless) — no session DB table needed. The user id +
 * email are embedded in the token and exposed to the client via session.
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/signin",
  },
  providers: [
    // Email + password. Works out of the box (users sign up via /api/auth/signup).
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.password) return null;

        // Use compareSync — bcryptjs v3's async compare can behave
        // inconsistently in edge/serverless runtimes.
        const valid = bcrypt.compareSync(password, user.password);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name ?? undefined, image: user.image ?? undefined };
      },
    }),
    // GitHub OAuth — enabled automatically when the env vars are set.
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? [
          GitHubProvider({
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    // On first OAuth sign-in, create the user in the DB if they don't exist.
    async signIn({ user, account }) {
      if (account?.provider !== "credentials" && user.email) {
        const email = user.email.toLowerCase();
        const existing = await db.user.findUnique({ where: { email } });
        if (!existing) {
          await db.user.create({
            data: {
              email,
              name: user.name ?? null,
              image: user.image ?? null,
            },
          });
        }
      }
      return true;
    },
    // Embed the user id in the JWT so we can scope queries by owner.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    // Expose the user id to the client session.
    async session({ session, token }) {
      if (session.user && token.id) {
        (session.user as { id?: string }).id = token.id as string;
      }
      return session;
    },
  },
};

export default authOptions;
