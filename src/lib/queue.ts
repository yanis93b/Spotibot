/**
 * src/lib/queue.ts
 *
 * BullMQ queue client for the async generation pipeline (Phase P1).
 *
 * Design:
 *   - When `process.env.REDIS_URL` is set, we configure real BullMQ Queues
 *     backed by that Redis. BullMQ creates its own connections internally
 *     from the shared `redisConnectionOptions` object (per BullMQ's
 *     recommendation: each Queue / Worker manages its own subscribers).
 *   - When `REDIS_URL` is NOT set (the local SQLite / synchronous-dev path),
 *     we export "no-op" queue proxies. They are typed as `Queue` so callers
 *     can write normal-looking code, but invoking any method throws a clear,
 *     actionable error. This lets the rest of the app import the queues
 *     unconditionally while the synchronous generation path stays the
 *     default — exactly the "keep the synchronous fallback" mandate.
 *
 * Exports:
 *   - `isQueueAvailable`        — Boolean(process.env.REDIS_URL)
 *   - `redisConnectionOptions`  — shared ioredis options (or null)
 *   - `generateQueue`           — Queue<"generate">
 *   - `remixQueue`              — Queue<"remix">
 *   - `repaintQueue`            — Queue<"repaint">
 *   - `editQueue`               — Queue<"edit">
 *   - `extendQueue`             — Queue<"extend">
 *
 * Server-only. Never import from a client component — BullMQ / ioredis use
 * Node APIs and will not bundle for the browser.
 */

import {
  Queue,
  type QueueOptions,
  type RedisOptions,
} from "bullmq";

/**
 * True when the Redis-backed BullMQ pipeline is wired up. Callers should
 * branch on this before enqueueing — when false, the synchronous fallback
 * path runs instead (the existing `/api/generate` flow).
 */
export const isQueueAvailable = Boolean(process.env.REDIS_URL);

/**
 * Shared connection options handed to every BullMQ Queue (and, in future
 * phases, every Worker). We pass options (not an IORedis instance) because
 * BullMQ creates its own connections internally — sharing a single instance
 * across Queues / Workers is explicitly discouraged by the library.
 *
 * `maxRetriesPerRequest: null` is REQUIRED by BullMQ (it blocks with BRPOPLPUSH
 * under the hood, which must not be aborted by ioredis's default retry limit).
 *
 * `null` when the queue layer is unavailable so callers can easily guard.
 */
export const redisConnectionOptions: RedisOptions | null = isQueueAvailable
  ? {
      url: process.env.REDIS_URL as string,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      // Lazy connect is left at ioredis's default (false) so a missing Redis
      // at boot surfaces immediately rather than on first enqueue.
    }
  : null;

/** Names of every queue this module owns. Used by the no-op fallback. */
const QUEUE_NAMES = [
  "generate",
  "remix",
  "repaint",
  "edit",
  "extend",
] as const;

type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Shared queue options: same connection, sensible defaults. The defaults
 * give us 3 attempts with exponential backoff, retain the last 100 completed
 * jobs for 24h, and cap failed jobs at 200 — enough for debugging without
 * unbounded Redis growth.
 */
function queueOptions(): QueueOptions {
  return {
    connection: redisConnectionOptions as QueueOptions["connection"],
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2_000,
      },
      removeOnComplete: { count: 100, age: 60 * 60 * 24 },
      removeOnFail: { count: 200 },
    },
  };
}

/**
 * A `Proxy` masquerading as a BullMQ `Queue` for environments where Redis
 * isn't configured (local dev / SQLite-only). Any property access that
 * resolves to a function throws a clear, actionable error; a few known
 * non-method properties (`name`, `opts`, `isNoopQueue`) return sane values
 * so feature-detection patterns like `if (queue.name)` behave predictably.
 *
 * We intentionally don't fake `add()` / `getJob()` to return values — the
 * whole point is to make the unavailability LOUD so callers branch on
 * `isQueueAvailable` instead of silently no-oping.
 */
function createNoopQueue(name: QueueName): Queue {
  const message =
    `[queue:${name}] BullMQ is unavailable — REDIS_URL is not set. ` +
    `Set REDIS_URL to enable async generation, or branch on ` +
    `\`isQueueAvailable\` from "@/lib/queue" and use the synchronous ` +
    `generation fallback.`;

  // A few non-method properties BullMQ's Queue exposes; we surface them so
  // `queue.name` / `queue.opts` reads don't throw (feature detection).
  const stub: Record<string, unknown> = {
    name,
    opts: queueOptions(),
    isNoopQueue: true,
  };

  return new Proxy(stub, {
    get(target, prop: string | symbol) {
      if (typeof prop !== "string" || prop in target) {
        return target[prop as string];
      }
      // Return a throwing function for any method access (`queue.add(...)`,
      // `queue.getJob(...)`, `queue.pause()`, etc.). This makes the failure
      // happen at the call site rather than at the property read — much
      // friendlier error for callers doing `const job = await queue.add(...)`.
      return () => {
        throw new Error(message);
      };
    },
    // Allow callers to feature-detect via `"isNoopQueue" in queue`.
    has(target, prop) {
      return prop in target;
    },
  }) as unknown as Queue;
}

/**
 * Build (or stub) a queue by name. Centralised so every queue uses the same
 * connection + default job options, and the no-op fallback is identical
 * across all of them.
 */
function buildQueue(name: QueueName): Queue {
  if (!isQueueAvailable || !redisConnectionOptions) {
    return createNoopQueue(name);
  }
  return new Queue(name, queueOptions());
}

// ─── Public queue instances ────────────────────────────────────────────────
// Each is a real BullMQ Queue when Redis is configured, or a no-op proxy
// otherwise. Job payload types are intentionally loose here — the
// producer / worker pair owns the precise payload type per queue.

/** Primary song-generation queue (POST /api/generate async path). */
export const generateQueue: Queue = buildQueue("generate");

/** Remix an existing track into a new variation. */
export const remixQueue: Queue = buildQueue("remix");

/** Regenerate only the cover art for a track (audio unchanged). */
export const repaintQueue: Queue = buildQueue("repaint");

/** Edit a track's prompt-derived attributes without full regeneration. */
export const editQueue: Queue = buildQueue("edit");

/** Extend a track's duration (append additional bars). */
export const extendQueue: Queue = buildQueue("extend");
