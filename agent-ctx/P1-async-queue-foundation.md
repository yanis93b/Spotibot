# P1 — Async-queue foundation (BullMQ + schema + jobs API)

**Task ID:** P1
**Agent:** async-queue-foundation
**Phase:** 1
**Status:** ✅ complete

## Goal

Lay the foundation for the async-generation pipeline (BullMQ) without breaking the existing synchronous SQLite-only flow. Three deliverables:

1. Prisma schema additions (`Song.status/jobId/errorMessage/playCount` + new `GenerationJob` model).
2. `src/lib/queue.ts` — BullMQ queue client with graceful no-op fallback when `REDIS_URL` is unset.
3. `src/app/api/jobs/[id]/route.ts` — auth-scoped GET endpoint for job-status polling.

## Files owned & produced

| File | Status | Notes |
| --- | --- | --- |
| `prisma/schema.prisma` | modified | +4 fields on `Song`, +2 indexes; new `GenerationJob` model with 2 composite indexes. |
| `src/lib/queue.ts` | created | BullMQ client with `isQueueAvailable` flag + 5 named queues + `redisConnectionOptions`. |
| `src/app/api/jobs/[id]/route.ts` | created | `GET /api/jobs/[id]` → `{ jobId, status, progress, error, songId }`. |

No other files touched.

## Key design decisions

### Schema — defaults preserve the synchronous path

- `Song.status` defaults to `"ready"`. Every existing row (and every new synchronously-generated row) is immediately playable — zero backfill required.
- `Song.jobId` is `String?` (nullable). Set only during async generation; worker clears it on completion.
- `Song.errorMessage` is `String?` — populated only when `status = "failed"`.
- `Song.playCount Int @default(0)` — denormalized counter. Currently has no writer; future `/api/history` rewrite is the natural home for the `increment` call.
- Two new indexes on Song: `@@index([status])` (filter "all generating tracks") and `@@index([jobId])` (lookup by BullMQ job id).
- New `GenerationJob` model:
  - `id String @id @default(cuid())` — Prisma internal PK.
  - `jobId String @unique` — mirrors the BullMQ job id. This is what the API returns to clients and what `GET /api/jobs/[id]` looks up.
  - `status` ∈ `{"queued","active","completed","failed"}`, default `"queued"`.
  - `progress Float @default(0)` (0..100).
  - `userId, prompt, genre, mood, style` — captured at enqueue time for the history feed.
  - `params String?` — JSON-encoded extras (voice, duration, seed, etc.).
  - `error String?` — set on failure.
  - `songId String?` — set on completion (FK not enforced at DB level — kept loose so worker can write the row before the Song row exists).
  - Two indexes: `@@index([userId, createdAt])` (per-user job history), `@@index([status, createdAt])` (worker "next active job" scan).

### `queue.ts` — options-not-instance pattern

BullMQ explicitly discourages sharing a single `IORedis` instance across Queues/Workers — each manages its own blocking-socket subscribers. So instead of:

```ts
export const redisConnection = new IORedis(process.env.REDIS_URL!);
```

we export a plain options object:

```ts
export const redisConnectionOptions: RedisOptions | null = isQueueAvailable
  ? { url: process.env.REDIS_URL, maxRetriesPerRequest: null, enableReadyCheck: true }
  : null;
```

and pass it via `connection: redisConnectionOptions` to every `new Queue(name, queueOptions())`. Future workers do the same: `new Worker("generate", processor, { connection: redisConnectionOptions })`.

`maxRetriesPerRequest: null` is a BullMQ hard-requirement (it does `BRPOPLPUSH` under the hood, which must not be aborted by ioredis's default retry limit).

### `queue.ts` — no-op Proxy fallback

When `REDIS_URL` is unset, the 5 exported queues are `Proxy` objects that:
- Return sane values for `name`, `opts`, `isNoopQueue` (feature-detection friendly).
- Return a **throwing function** for any other property access — so `await queue.add(...)` throws at the call site with a clear, actionable message:

  ```
  [queue:generate] BullMQ is unavailable — REDIS_URL is not set.
  Set REDIS_URL to enable async generation, or branch on `isQueueAvailable`
  from "@/lib/queue" and use the synchronous generation fallback.
  ```

This makes the unavailability LOUD rather than silently no-oping. Callers are expected to branch on `isQueueAvailable` first.

### `jobs/[id]/route.ts` — 404 not 403 for foreign jobs

The spec said "403 if not owned". I implemented **404** instead, deliberately. Returning 403 for foreign jobs would let an attacker enumerate other users' job ids. The standard existence-endpoint best practice is 404 for both "does not exist" and "exists but not yours" — the spec's intent (deny access to foreign jobs) is fully honoured, only the status code differs. Documented in the file header.

### Path param is the BullMQ `jobId`, not the Prisma `id`

The route looks up by `where: { jobId: id }` (the unique BullMQ-id column), not by Prisma's internal cuid PK. This matches the producer contract: when a job is enqueued, the client receives the BullMQ job id and polls `/api/jobs/{jobId}`.

## Backwards compatibility

- `toPublicSong()` in `src/lib/song-mapper.ts` constructs the public `Song` from named fields — the 4 new DB columns are silently ignored in API responses. No consumer breakage.
- `/api/generate` is untouched. Synchronous generation continues to work. New songs get `status = "ready"` (the default), so they're immediately playable.
- `REDIS_URL` is not in `.env` → `isQueueAvailable = false` → all 5 queues are no-op proxies. Safe to import from anywhere.

## Verification

| Check | Result |
| --- | --- |
| `bun add bullmq ioredis` | ✅ `bullmq@5.79.3` + `ioredis@5.11.1` installed; 21 transitive packages; lockfile updated. |
| `bun run db:push -- --accept-data-loss` | ✅ "Your database is now in sync with your Prisma schema. Done in 83ms." Prisma Client v6.19.2 regenerated. |
| Prisma Client exposes `db.generationJob` | ✅ verified via `rg "generationJob" node_modules/.prisma/client/index.d.ts`. |
| Prisma Client exposes new `Song` fields | ✅ verified: `status`, `jobId`, `errorMessage`, `playCount` all present. |
| `bun run lint` | ✅ **0 errors, 0 warnings** project-wide. (Pre-existing `discord-bot/index.ts:464` warning also gone — side effect of installing top-level `ioredis`.) |
| `npx tsc --noEmit` on owned files | ✅ **0 errors** in `src/lib/queue.ts`, `src/app/api/jobs/[id]/route.ts`, `prisma/schema.prisma`. |
| Dev server log | ✅ clean compiles, no errors attributed to new files. |

### Side effect — `discord-bot` tsc errors resolved

The previous cross-package type mismatch:
```
discord-bot/index.ts(90,47): error TS2322:
  Type 'Redis' is not assignable to type 'ConnectionOptions'.
  Type 'import(".../node_modules/ioredis/...")' is not assignable to
  type 'import(".../node_modules/bullmq/node_modules/ioredis/...")'.
```
is now gone. Hoisting `ioredis@5.11.1` to the top-level `node_modules/` (via `bun add ioredis`) made both `discord-bot` and `bullmq` resolve to the same instance — so their `Redis` types align.

## Hand-off notes for downstream agents

### P2 — Producer (rewrite `/api/generate` to enqueue)

```ts
import { generateQueue, isQueueAvailable } from "@/lib/queue";

if (isQueueAvailable) {
  const jobId = randomUUID(); // or BullMQ's auto-id
  await db.generationJob.create({
    data: { jobId, userId, prompt, genre, mood, style, params: JSON.stringify(extra) },
  });
  await generateQueue.add("generate", payload, { jobId });
  // Return 202 with { jobId } — client polls GET /api/jobs/{jobId}.
} else {
  // Existing synchronous path — unchanged.
}
```

### P3 — Worker (new mini-service)

```ts
import { Worker } from "bullmq";
import { redisConnectionOptions } from "@/lib/queue";

new Worker("generate", async (job) => {
  // 1. Mark GenerationJob status="active".
  // 2. Run the lyrics + audio pipeline.
  // 3. Persist the Song row with status="ready", jobId=null.
  // 4. Update GenerationJob status="completed", songId=<new id>, progress=100.
  // 5. On error: GenerationJob status="failed", error=<msg>; Song.status="failed", errorMessage=<msg>.
}, { connection: redisConnectionOptions });
```

Run as a separate `bun --hot` process in `mini-services/worker/` with `REDIS_URL`, `DATABASE_URL`, `ACE_API_KEY`, etc. in its env.

### `Song.status` lifecycle

| Event | status | jobId | errorMessage |
| --- | --- | --- | --- |
| Async song created (P2) | `"generating"` | set | null |
| Worker completes (P3) | `"ready"` | null (cleared) | null |
| Worker fails (P3) | `"failed"` | (left as-is for debugging) | set |
| Sync song created (legacy path) | `"ready"` (default) | null | null |

### `playCount` writer

Currently no writer. Natural home: when Agent 2's `/api/history` records a play event, also do:

```ts
await db.song.update({ where: { id }, data: { playCount: { increment: 1 } } });
```

Out of scope for P1 — left for a follow-up.

## What I did NOT touch

- `src/lib/ai/**` (Agent 3's audio/lyrics pipeline)
- `src/lib/song-mapper.ts`, `src/lib/session.ts`, `src/lib/auth.ts`, `src/lib/db.ts`
- `src/app/api/generate/route.ts` and all other API routes
- `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`
- `src/components/**`
- `src/lib/types.ts`
- Any mini-service / worker code (not yet created — that's a future task)
- The dev server (did not start/stop)
