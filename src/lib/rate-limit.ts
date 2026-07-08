/**
 * src/lib/rate-limit.ts
 *
 * Distributed rate limiting for the generate pipeline (and any other
 * heavy AI endpoint that wants to gate by IP).
 *
 * ── Strategy ───────────────────────────────────────────────────────────────
 * If both `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set,
 * we use `@upstash/ratelimit` + `@upstash/redis` with a **sliding window**
 * of 8 requests / minute / IP. This is a *distributed* limit — it's shared
 * across every server instance and survives restarts, which matters once
 * the app runs behind more than one Pod / Vercel function.
 *
 * If those env vars are NOT set (typical for local dev, CI, and small
 * single-instance deploys), we fall back to an in-memory Map-based sliding
 * window with the SAME 8 req/min/IP semantics. This is the exact algorithm
 * that used to live inline in `src/app/api/generate/route.ts`; it has been
 * hoisted here so it can be shared across routes and swapped for Upstash
 * without touching call sites.
 *
 * ── API ────────────────────────────────────────────────────────────────────
 *   rateLimit(ip): Promise<{ success: boolean; remaining: number }>
 *
 * - `success`  — true when the caller is under the limit and may proceed.
 * - `remaining`— how many requests the caller has left in the current
 *                window (0 when the limit has been hit). For the Upstash
 *                path this comes straight from the library; for the
 *                in-memory path it is `MAX - windowCount` (clamped at 0).
 *
 * The caller is responsible for IP extraction (e.g. from
 * `x-forwarded-for`) — this keeps the function pure and easy to test.
 *
 * ── Server-only ────────────────────────────────────────────────────────────
 * Both backends read `process.env` and (for Upstash) make HTTP calls —
 * neither belongs on the client. The function is `async` and uses Node
 * globals, so it can't accidentally end up in a Client Component bundle
 * (it would fail to compile tree-shake). Do not import this from a
 * `'use client'` file.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// ---------------------------------------------------------------------------
// Configuration — shared by both backends so the two paths are equivalent.
// 8 generations / minute / IP matches the Ace Music model's cost profile
// (each call is several seconds of GPU time) and is the value the inline
// limiter in `generate/route.ts` already enforced.
// ---------------------------------------------------------------------------
const RATE_LIMIT_MAX = 8;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

export interface RateLimitResult {
  /** true when the caller is under the limit and may proceed. */
  success: boolean;
  /** Requests remaining in the current window (0 when blocked). */
  remaining: number;
}

// ---------------------------------------------------------------------------
// Upstash backend (lazy singleton — only constructed when env vars are set)
// ---------------------------------------------------------------------------
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const useUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

/**
 * Lazily-built Upstash Ratelimit instance. We construct it once on first
 * use (rather than at module load) so that:
 *   1. Local dev (no env vars) never pays the import-time cost of building
 *      an HTTP client that would immediately 401.
 *   2. If the env vars are mis-set, the error surfaces on the first real
 *      request instead of breaking every route that transitively imports
 *      this module.
 */
let _upstashLimiter: Ratelimit | null = null;
function getUpstashLimiter(): Ratelimit {
  if (_upstashLimiter) return _upstashLimiter;

  // Both UPSTASH_URL and UPSTASH_TOKEN are guaranteed truthy here because
  // `useUpstash` was true at module load. (We re-check defensively in case
  // the env was mutated at runtime — extremely unlikely but cheap.)
  if (!UPSTASH_URL || !UPSTASH_TOKEN) {
    throw new Error("rate-limit: Upstash env vars missing");
  }

  const redis = new Redis({
    url: UPSTASH_URL,
    token: UPSTASH_TOKEN,
    // Trim latency logging in production — it's noisy and we already get
    // request timing from the Upstash dashboard.
    latencyLogging: false,
  });

  _upstashLimiter = new Ratelimit({
    redis,
    // Sliding window = exact same semantics as the in-memory fallback
    // (no fixed-window burst at the boundary). 8 req / 1 m per IP.
    limiter: Ratelimit.slidingWindow(RATE_LIMIT_MAX, "1 m"),
    // Namespace keys so this limiter doesn't collide with any other
    // Upstash-backed feature that might share the same Redis DB.
    prefix: "spotibot:rl",
    analytics: false,
  });
  return _upstashLimiter;
}

// ---------------------------------------------------------------------------
// In-memory fallback backend (Map<ip, timestamp[]>)
// ---------------------------------------------------------------------------
const memoryBuckets = new Map<string, number[]>();

/**
 * Sliding-window in-memory rate limit. Matches the algorithm that lived
 * inline in `src/app/api/generate/route.ts` before this module existed:
 *   1. Drop timestamps older than `RATE_LIMIT_WINDOW_MS`.
 *   2. If the remaining count is already >= MAX, reject (success=false,
 *      remaining=0) and DO NOT record the rejected timestamp (otherwise
 *      a sustained flood would extend the block window indefinitely).
 *   3. Otherwise record `now` and return `remaining = MAX - count`.
 *
 * NOTE: this Map is per-process. In a multi-instance deploy the effective
 * limit is `MAX * instanceCount` per IP — which is exactly why the Upstash
 * path exists. Local dev and single-Pod staging don't care.
 */
function rateLimitInMemory(ip: string): RateLimitResult {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (memoryBuckets.get(ip) ?? []).filter((t) => t > cutoff);

  if (recent.length >= RATE_LIMIT_MAX) {
    // Refresh the bucket so old timestamps don't accumulate, but do NOT
    // push `now` — a rejected request shouldn't extend the cooldown.
    memoryBuckets.set(ip, recent);
    return { success: false, remaining: 0 };
  }

  recent.push(now);
  memoryBuckets.set(ip, recent);
  return { success: true, remaining: Math.max(0, RATE_LIMIT_MAX - recent.length) };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Check whether `ip` may proceed with a rate-limited action.
 *
 * - Upstash path: forwards to the distributed limiter and returns its
 *   `success` / `remaining`. If the Upstash REST call itself throws (e.g.
 *   transient network failure, bad token), we **fail open** — log the
 *   error and allow the request — so a Redis outage doesn't take the
 *   whole generate endpoint down. This matches the standard production
 *   pattern for rate limiters.
 * - In-memory path: pure function, cannot throw.
 *
 * @param ip Caller IP (typically the first hop of `x-forwarded-for`).
 */
export async function rateLimit(ip: string): Promise<RateLimitResult> {
  // Empty / unknown IP → bucket it under a single shared key so a flood
  // of unidentifiable requests still gets throttled as a group (rather
  // than each one getting its own fresh bucket).
  const identifier = ip && ip.length > 0 ? ip : "unknown";

  if (!useUpstash) {
    return rateLimitInMemory(identifier);
  }

  try {
    const limiter = getUpstashLimiter();
    const res = await limiter.limit(identifier);
    return {
      success: res.success,
      remaining: Math.max(0, res.remaining),
    };
  } catch (err) {
    // Fail open: a broken Upstash shouldn't block users. The in-memory
    // path is the source of truth for "is this allowed"; if Upstash is
    // down we degrade to "allow" rather than 429-ing everyone.
    console.error(
      "rate-limit: Upstash call failed, failing open",
      err instanceof Error ? err.message : err,
    );
    return { success: true, remaining: RATE_LIMIT_MAX - 1 };
  }
}

// ---------------------------------------------------------------------------
// Exported for tests / health checks. Not part of the public call API.
// ---------------------------------------------------------------------------

/** True when the Upstash distributed limiter is wired up (env vars set). */
export const isUsingUpstash = useUpstash;

/** Reset the in-memory buckets — only used by tests, hence not exported
 *  in the type surface. No-op when Upstash is active. */
export function _resetMemoryBucketsForTests(): void {
  memoryBuckets.clear();
}
