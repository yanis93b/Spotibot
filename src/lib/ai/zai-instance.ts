/**
 * ZAI SDK singleton holder.
 *
 * The `z-ai-web-dev-sdk` client is relatively expensive to construct because it
 * resolves credentials/config on `ZAI.create()`. To avoid re-creating it on
 * every request — and crucially to survive Next.js dev hot-reloads, which
 * re-evaluate modules and would otherwise produce a fresh client each time — we
 * cache the created instance on `globalThis`, mirroring the well-known Prisma
 * singleton pattern.
 *
 * This module is SERVER-ONLY. It is imported exclusively by API route handlers
 * and the AI service layer; it must never be pulled into a client bundle.
 */

import ZAI from "z-ai-web-dev-sdk";

/**
 * The fully-initialized ZAI client type. We derive it from the static
 * `ZAI.create()` factory so the type tracks the SDK automatically.
 */
type ZaiClient = Awaited<ReturnType<typeof ZAI.create>>;

/**
 * Cast `globalThis` to a shape that optionally carries our cached client.
 * Using `globalThis` (rather than a module-scoped variable) is what makes the
 * instance survive hot-reload in development.
 */
const globalForZai = globalThis as unknown as { __zai?: ZaiClient };

/**
 * Lazily create and cache the ZAI client.
 *
 * On the first call, `ZAI.create()` runs and the result is stored on
 * `globalThis.__zai`. Subsequent calls (from any module, in any HMR state)
 * return the cached instance directly.
 */
export async function getZAI(): Promise<ZaiClient> {
  if (!globalForZai.__zai) {
    globalForZai.__zai = await ZAI.create();
  }
  return globalForZai.__zai;
}
