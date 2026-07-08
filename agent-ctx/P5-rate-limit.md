# P5 — Distributed rate limiting (Upstash) + env docs

**Task ID:** P5
**Agent:** backend-rate-limit
**Phase:** 5 (partial)
**Status:** ✅ complete

## Goal

Add a distributed rate limiter (`@upstash/ratelimit` + `@upstash/redis`) so the
generate pipeline's per-IP cap survives multi-instance deploys and process
restarts. Fall back to the existing in-memory Map-based limiter when Upstash
isn't configured (local dev, CI, single-Pod staging).

## Files owned & modified (and ONLY these)

| File | Change |
|------|--------|
| `src/lib/rate-limit.ts` | NEW. Exports `rateLimit(ip): Promise<{ success; remaining }>`. Upstash sliding-window (8 req/min/IP) when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set; otherwise falls back to in-memory sliding-window Map (same 8 req/min/IP algorithm that was inlined in `src/app/api/generate/route.ts`). |
| `.env.example` | Rewrote to enumerate ALL env vars the full stack references — Database, Ace Music API, NextAuth, GitHub OAuth, Redis (BullMQ + Socket.io pub/sub), Upstash, S3/R2, ACE-Step self-hosted, Socket.io server URL, Discord bot. |

## Implementation notes

### `src/lib/rate-limit.ts`

**Detection:**
```ts
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL?.trim();
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const useUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);
```
Both vars must be present AND non-empty. Whitespace-trimmed so an accidental
`UPSTASH_REDIS_REST_URL=" "` doesn't pretend to be configured.

**Upstash path** (lazy singleton):
- `new Redis({ url, token, latencyLogging: false })` — explicit construction
  rather than `Redis.fromEnv()` so we control the env-var names and the failure
  mode. `Redis.fromEnv()` would throw at module load if the vars were missing,
  which we don't want (the in-memory fallback path is the default in dev).
- `new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(8, "1 m"), prefix: "spotibot:rl", analytics: false })`
- Sliding window (not fixed window) — matches the in-memory fallback's
  semantics exactly, so swapping backends doesn't change behavior at the
  window boundary.
- `prefix: "spotibot:rl"` namespaces the Redis keys so this limiter doesn't
  collide with any other Upstash-backed feature that might share the DB.
- `analytics: false` — we don't run the Upstash analytics dashboard and it
  would add a second REST call per request.
- Singleton built on first call to `rateLimit()` (not at module load). This
  means local dev (no env vars) never pays the cost of constructing an HTTP
  client that would immediately 401, and any misconfiguration surfaces on
  the first real request rather than breaking every route that transitively
  imports this module.

**In-memory fallback** (mirrors `generate/route.ts`'s old inline limiter):
- `Map<ip, number[]>` of request timestamps within the last 60 s.
- On each call: drop timestamps older than `now - 60_000`, count the rest.
- If `count >= 8` → reject (`success=false`, `remaining=0`), and DO NOT push
  `now` (a rejected request shouldn't extend the cooldown — otherwise a
  sustained flood would block the IP indefinitely).
- Else → push `now`, return `success=true`, `remaining = 8 - count`.
- Per-process: in a multi-instance deploy the effective limit becomes
  `8 × instanceCount`, which is the whole reason the Upstash path exists.
  Local dev and single-Pod staging don't care.

**Failure mode — fail open:**
If the Upstash REST call throws (transient network failure, bad token,
Upstash itself is down), we `console.error` the message and return
`{ success: true, remaining: 7 }`. **Rationale:** a rate-limiter outage
shouldn't take the whole generate endpoint down. Users might generate a
couple extra songs during the outage window; that's preferable to 429-ing
everyone. This matches the standard production pattern (Upstash's own docs
recommend fail-open for non-critical limits).

**Empty IP:** bucketed under the shared key `"unknown"` so a flood of
unidentifiable requests (e.g. missing `x-forwarded-for`) still gets
throttled as a group instead of each one getting its own fresh bucket.

**Exports:**
- `rateLimit(ip): Promise<{ success: boolean; remaining: number }>` — the
  public API per spec.
- `isUsingUpstash: boolean` — for health checks / observability.
- `_resetMemoryBucketsForTests()` — test-only helper (the spec says no
  tests, but future test authors will want this; it's a no-op when Upstash
  is active).

### `.env.example`

Replaced the previous 20-line file (which only documented Database, Ace
Music, NextAuth, and GitHub OAuth) with the full 30-line spec from the
task. New sections:
- `REDIS_URL` — for BullMQ queue + Socket.io pub/sub (optional in dev).
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — for this module.
- `S3_*` — for the S3/R2 audio storage adapter (Phase 5 storage work,
  falls back to inline DB storage when unset).
- `ACE_STEP_API` — self-hosted ACE-Step endpoint (falls back to cloud API).
- `NEXT_PUBLIC_SOCKET_URL` — client-side Socket.io URL.
- `DISCORD_TOKEN` + `DISCORD_CLIENT_ID` — Discord bot.

The file is intentionally the canonical reference — any new env var added
by any future phase should be appended here.

## Why I did NOT touch `src/app/api/generate/route.ts`

The spec's "Files you OWN" list is `rate-limit.ts` and `.env.example` only.
The generate route still has its own inline `rateLimitExceeded()` Map. Two
options:

1. **Migrate the route now** to call `rateLimit(ip)` from the new module.
2. **Leave the route alone** and let a later task do the migration.

I chose (2) because:
- The spec didn't ask me to touch the route.
- The route's inline limiter and the new module's in-memory fallback have
  identical semantics (both are 8 req/min/IP sliding window, both fail
  closed for in-memory), so leaving the route as-is doesn't introduce a
  behavior regression.
- Migrating the route would create two rate-limit checks (one inline, one
  via the module) unless I also delete the inline code — and deleting the
  inline code is exactly the kind of cross-file refactor that should be
  its own task with its own worklog entry.

**TODO for a future task:** delete `rateBuckets` / `rateLimitExceeded` /
`getClientIp` from `src/app/api/generate/route.ts` and replace the
`rateLimitExceeded(ip)` call with `!(await rateLimit(ip)).success`. The
new module's `rateLimit()` is a drop-in replacement.

## Verification

- `cd /home/z/my-project && bun add @upstash/ratelimit @upstash/redis` →
  installed `@upstash/ratelimit@2.0.8` + `@upstash/redis@1.38.0`, 4
  packages total, lockfile updated. No peer-dep warnings.
- `npx eslint src/lib/rate-limit.ts` → **EXIT 0**, 0 errors, 0 warnings.
- `npx tsc --noEmit --skipLibCheck 2>&1 | grep rate-limit` → no matches
  (zero type errors in `rate-limit.ts`).
- `bun run lint` (project-wide): 1 error in `src/hooks/use-job-socket.ts`
  and 1 warning in `discord-bot/index.ts` — both in files I don't own and
  didn't touch. The `use-job-socket.ts` file appeared in `src/hooks/`
  partway through this task (it wasn't in the original LS listing),
  indicating another agent is concurrently developing the queue/socket
  Phase 5 work; that lint error is theirs, not mine.
- Dev log: clean — `✓ Ready in 1785ms`, no errors attributed to my file.
  (My file isn't imported anywhere yet — see "Why I did NOT touch the
  generate route" above — so the dev server hasn't compiled it. It will
  compile lazily once the route is migrated in a follow-up task.)

## Follow-ups for the orchestrator (out of this task's ownership)

1. **Migrate `src/app/api/generate/route.ts`** to call
   `rateLimit(ip)` from this module instead of its inline
   `rateLimitExceeded()`. Delete the inline limiter + `rateBuckets` Map.
2. **Apply the same limiter to other heavy AI endpoints** (cover
   generation, queue endpoints) if/when they're added — they should all
   share the same per-IP budget.
3. **Document Upstash setup** in the project README once the env vars are
   actually used by the running app (right now they're documented in
   `.env.example` but no live code reads them — that changes once (1) is
   done).
