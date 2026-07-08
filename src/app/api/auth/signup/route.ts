/**
 * POST /api/auth/signup
 *
 * Creates a new user account (email + password). The password is hashed with
 * bcrypt before storage. Returns the user id on success.
 *
 * Responses:
 *   200 — { success: true, userId }
 *   400 — { error: string }  (validation / duplicate email)
 *   500 — { error: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const signupSchema = z.object({
  email: z.string().email("Invalid email").toLowerCase(),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  name: z.string().trim().min(1).max(80).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { email, password, name } = parsed.data;

  try {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 400 },
      );
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await db.user.create({
      data: { email, password: hashed, name },
    });

    return NextResponse.json({ success: true, userId: user.id }, { status: 200 });
  } catch (err) {
    console.error("signup: failed", err);
    return NextResponse.json({ error: "Failed to create account." }, { status: 500 });
  }
}
