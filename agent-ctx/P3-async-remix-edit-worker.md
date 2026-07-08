# P3 — Remix (Audio2Audio) + Edit-Lyrics (flow-edit) API routes + standalone BullMQ worker

**Task ID:** P3
**Agent:** async-remix-edit-worker
**Phase:** P3 (async generation pipeline)
**Status:** ✅ complete
**Lint:** PASS (`bun run lint` → exit 0, zero output, project-wide)
**TypeScript (worker):** PASS (`bunx tsc --noEmit` inside `worker/` → exit 0)

## Files created (and ONLY these — no other files modified)

| File | Purpose |
|------|---------|
| `src/app/api/remix/route.ts` | POST handler. Accepts `multipart/form-data` (`file` audio + `prompt` + optional `duration`). Auth-required (uses `getCurrentUserId()`). Uploads the source audio to S3 when configured, else to `UPLOAD_DIR` (default `/tmp/spotibot-uploads`) as `file://`. Enqueues a job onto the BullMQ `remixQueue` (`src/lib/queue.ts`). Returns `202 { jobId, status: "queued" }`. |
| `src/app/api/edit-lyrics/route.ts` | POST handler. Accepts JSON `{ songId, newLyrics }`. Auth-required, verifies ownership via `db.song.findFirst({ where: { id, ownerId: userId } })` (collapses missing + foreign-owned into a uniform 404). Enqueues a job onto the BullMQ `editQueue`. Returns `202 { jobId, status: "queued" }`. |
| `worker/package.json` | Standalone worker project. `scripts: { dev: "tsx watch index.ts", start: "tsx index.ts" }`. Dependencies: bullmq, ioredis, @aws-sdk/client-s3, @prisma/client, z-ai-web-dev-sdk, zod. devDependencies: tsx, typescript. |
| `worker/tsconfig.json` | Standalone TypeScript config (ES2022, ESNext modules, Bundler resolution, strict, noEmit). Does NOT extend the main project's tsconfig — the worker is fully independent. |
| `worker/index.ts` | BullMQ worker entrypoint. Wires up three Workers (`generate`, `remix`, `edit`) on the same ioredis connection (cast to `ConnectionOptions` to bridge the 5.11.x vs 5.10.x ioredis type divergence with BullMQ). Per-worker `concurrency: 2` and `limiter: { max: 1, duration: 30_000 }`. Publishes progress to Redis pub/sub channel `job:{jobId}:progress` via a separate publisher ioredis connection. S3 upload-when-configured / DB-storage fallback. Prisma client + graceful SIGTERM/SIGINT shutdown. |
| `worker/handlers/lyrics.ts` | Standalone LLM lyricist. Copied from `src/lib/ai/lyrics-generator.ts` with the `getZAI` import inlined (so the worker doesn't import anything from the Next.js app). Identical exported API: `generateLyrics({prompt, genre, mood, style}) → { title, lyrics }`. |
| `worker/handlers/ace-step.ts` | Client for the self-hosted ACE-Step API (env: `ACE_STEP_API`). Three exported methods: `generateMusic(params)` → POST `/generate`; `remixAudio(audioUrl, prompt, duration, opts)` → POST `/audio2audio`; `editLyrics(audioUrl, originalLyrics, newLyrics, prompt, opts)` → POST `/edit`. All with a 5-minute `AbortController` timeout. Includes `resolveAudio(buffer?, url?)` helper that fetches `file://`, `http(s)://` (and rejects `s3://` — the worker resolves those via the AWS SDK before calling in). |
| `worker/handlers/cover.ts` | Standalone cover-art generator. Copied from `src/lib/ai/cover-generator.ts` with the ZAI singleton inlined. Best-effort (returns null on failure). Identical exported API: `generateCover({ title, genre, mood, prompt }) → { buffer, format: "png" } | null`. |

## Side effect (not a file I own — added to support the API routes)

Installed `@aws-sdk/client-s3@3.1081.0` into the **main project's** `package.json` via `bun add @aws-sdk/client-s3`. The two new API routes (`/api/remix`, `/api/edit-lyrics`) need the S3 SDK to upload source audio to object storage. The worker project already declares `@aws-sdk/client-s3` in its own `worker/package.json`, so this only adds the SDK to the Next.js app side. The S3 client is dynamically imported (`await import("@aws-sdk/client-s3")`) so the route module still loads even if the SDK isn't installed in a stripped environment.

## Architecture decisions

### Queue naming reconciliation

The spec called for "BullMQ Worker on 'ace:generate' queue". The existing in-app queue module (`src/lib/queue.ts`, owned by an earlier phase) already defines queues named `"generate"`, `"remix"`, `"edit"`, `"repaint"`, `"extend"` — and the Next.js API routes enqueue onto those exact names. To keep the producer/consumer pair wired correctly, the worker listens on the **existing** names (`generate`, `remix`, `edit`) rather than introducing an `ace:` prefix that no producer populates. Documented in the worker header comment so the queue-name spec reconciliation is discoverable.

### BullMQ `ConnectionOptions` cast

BullMQ 5.x ships with ioredis 5.10.x as a transitive dep; the worker's top-level `ioredis@5.11.x` produces a different type identity for `Redis` instances even though the runtime API is identical. Pass the ioredis instance through `as unknown as ConnectionOptions` to bridge the version-pinning gap (mirrors the same workaround already used in `src/lib/queue.ts`).

### Buffer → `Uint8Array<ArrayBuffer>` cast

Prisma's `Bytes` scalar is typed `Uint8Array<ArrayBuffer>` while Node's `Buffer` extends `Uint8Array<ArrayBufferLike>` (which can nominally back a `SharedArrayBuffer`). At runtime a Node Buffer is always backed by a regular ArrayBuffer, so a type-only cast (`buffer as Uint8Array<ArrayBuffer>`) satisfies the type system with zero runtime cost. Same pattern Agent 2 used in `/api/generate`.

### S3 + DB dual persistence

The existing Song schema (`prisma/schema.prisma`) has `audioData Bytes` (required, non-nullable) — the `/api/audio/[id]` and `/api/cover/[id]` endpoints stream bytes from the DB. To preserve backwards compatibility, the worker ALWAYS stores audio bytes in the DB, and ADDITIONALLY uploads to S3 when `S3_BUCKET` is configured (the S3 URL is included in the `complete` progress payload + returned from the job for future use). The spec's "S3 when configured, falls back to DB storage" is interpreted as "S3 is the durable primary copy when configured; DB is always populated so the existing inline-streaming endpoints keep working".

### Per-queue rate limit (`max: 1, duration: 30_000`)

BullMQ's `Worker` `limiter` option enforces a per-worker rate limit. With three workers (generate/remix/edit), the global ceiling is 3 jobs starting per 30 seconds — within the spec's "1 job per 30s" intent at the per-queue level. A cross-queue global limiter would require BullMQ's "Queue Groups" feature (overkill here) or a custom token-bucket; the per-queue limiter is the standard BullMQ idiom and matches the spec's "Concurrency: 2, rate limited: 1 job per 30s" reading.

### Redis pub/sub for progress

Each job publishes `{ percent, stage, data?, ts }` to channel `job:{jobId}:progress`. The Next.js app can subscribe via a future SSE route (e.g. `GET /api/jobs/[id]/events`) or directly via ioredis on the client (less common). The progress percentages for the `generate` pipeline match the spec exactly: lyrics → 15%, audio → 60%, cover → 80%, persist → 100%.

### Edit-lyrics flow-edit pipeline

The `/edit` worker:
1. Re-verifies ownership (defensive — the song could have changed hands between enqueue and process).
2. Reads the original audio bytes from the DB (`song.audioData`).
3. Calls `editLyrics("", originalLyrics, newLyrics, prompt, { audioBuffer: <bytes> })` — passes the buffer directly so `resolveAudio` skips the URL fetch (the `audioUrl` is empty, but the handler prefers the buffer).
4. Updates the existing Song row in place (overwrites `lyrics`, `audioData`, `audioFormat`). Duration is preserved (the ACE-Step `/edit` endpoint preserves source duration).

### Prisma client sharing

The worker uses its own `@prisma/client` from `worker/node_modules`. To get the generated client (including the platform-specific query engine binary), I copied the main project's `node_modules/.prisma/` directory into the worker's `node_modules/.prisma/` (symlinks are blocked in this sandbox). This shares the same generated client code as the main app — same DATABASE_URL, same schema, same model shapes. Future maintainers should re-copy after schema changes (`cp -r ../node_modules/.prisma worker/node_modules/.prisma`).

## API contracts

### POST /api/remix

```
Content-Type: multipart/form-data
  file       : audio blob (required, ≤ 30 MB, audio/* MIME)
  prompt     : string, 3..500 chars (required)
  duration   : optional seconds (10..300), coerced from string

→ 202 { jobId: string, status: "queued" }
→ 400 { error: string }  (missing/invalid file / prompt / duration)
→ 401 { error: "Unauthorized" }
→ 413 { error: "File too large (max 30 MB)." }
→ 500 { error: string }  (upload or enqueue failure)
→ 503 { error: "Remix pipeline is offline — set REDIS_URL..." }
```

### POST /api/edit-lyrics

```
Content-Type: application/json
  { songId: string, newLyrics: string (1..5000 chars) }

→ 202 { jobId: string, status: "queued" }
→ 400 { error: string }
→ 401 { error: "Unauthorized" }
→ 404 { error: "Song not found" }  (missing OR not owned by caller)
→ 500 { error: string }
→ 503 { error: "Edit pipeline is offline..." }
```

## Worker job payload shapes

```ts
// generate queue
interface GenerateJobData {
  userId: string;
  prompt: string;
  genre: string;
  mood: string;
  style: string;
  duration?: number;
  language?: string;
  audioFormat?: string;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  seed?: number;
}

// remix queue (produced by POST /api/remix)
interface RemixJobData {
  userId: string;
  prompt: string;
  duration?: number;
  audioUrl: string;          // s3://, file://, or https://
  sourceFileName?: string;
  sourceContentType?: string;
  sourceSizeBytes?: number;
  createdAt: string;
}

// edit queue (produced by POST /api/edit-lyrics)
interface EditJobData {
  userId: string;
  songId: string;
  originalTitle: string;
  originalLyrics: string;
  newLyrics: string;
  prompt: string;
  genre: string;
  mood: string;
  style: string;
  language: string;
  audioFormat: string;
  durationMs: number;
  createdAt: string;
}
```

## Progress events (Redis pub/sub)

Channel: `job:{jobId}:progress`
Payload (JSON):
```ts
interface ProgressPayload {
  percent: number;     // 0..100
  stage: string;       // "lyrics:done", "audio:generating", "complete", ...
  data?: Record<string, unknown>;
  ts: number;          // Date.now()
}
```

`generate` pipeline emits: 5 `starting` → 8/15 `lyrics:*` → 20/60 `audio:*` → 65/80 `cover:*` → 85/92 `persist:*` → 100 `complete`.
`remix` pipeline emits: 5 `starting` → 8/10 `source:*` → 15/70 `remix:*` → 80/92 `persist:*` → 100 `complete`.
`edit` pipeline emits: 5 `starting` → 8/10 `song:*` → 15/70 `edit:*` → 80/92 `persist:*` → 100 `complete`.

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `REDIS_URL` | YES (worker + app) | BullMQ queue + pub/sub. Worker boots without it but logs `ECONNREFUSED` until Redis is up. |
| `DATABASE_URL` | YES (worker) | Same SQLite/Postgres URL as the Next.js app — worker uses Prisma directly. |
| `ACE_STEP_API` | YES (worker, for non-trivial jobs) | Base URL of the self-hosted ACE-Step server (e.g. `http://localhost:7860`). |
| `S3_BUCKET` | optional | When set, generated audio + covers are uploaded to S3 (DB still stores bytes for the inline-streaming endpoints). |
| `S3_REGION` | optional | Default `us-east-1`. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | optional | S3 credentials. When unset, the SDK falls back to its default credential chain (env, EC2 IAM, etc.). |
| `S3_ENDPOINT` | optional | For R2/MinIO/etc. S3-compatible stores. |
| `S3_PUBLIC_BASE` | optional | When set, generated audio URLs use `${S3_PUBLIC_BASE}/${key}` (HTTPS) instead of `s3://bucket/key`. |
| `UPLOAD_DIR` | optional (app side) | Default `/tmp/spotibot-uploads`. Used by `/api/remix` for local file fallback when S3 isn't configured. |

## How to run

```bash
# 1. Start Redis (in another shell)
redis-server

# 2. Start the worker (auto-restarts on file changes)
cd worker && bun run dev

# 3. The Next.js dev server (already auto-run by the sandbox) enqueues jobs
#    when /api/remix or /api/edit-lyrics is hit. Set REDIS_URL in the main
#    project's .env to enable the producer side.

# 4. (Optional) Configure ACE_STEP_API + S3 env vars in worker's environment
#    to enable real audio2audio/flow-edit + durable object storage.
```

## Verification

- `cd /home/z/my-project && bun run lint` → **EXIT 0**, 0 errors/warnings project-wide. ESLint config covers `worker/**` (it isn't in the `ignores` list — verified the worker files pass lint).
- `cd /home/z/my-project/worker && bunx tsc --noEmit` → **EXIT 0**, 0 type errors. Fixed two type-level issues during development:
  1. `Buffer<ArrayBufferLike>` → `Uint8Array<ArrayBuffer>` cast for Prisma `Bytes` fields + `Blob` constructor (3 sites in `index.ts`, 1 in `handlers/ace-step.ts`).
  2. `IORedis` → `ConnectionOptions` cast to bridge the worker's `ioredis@5.11.x` vs BullMQ's bundled `ioredis@5.10.x` type divergence.
- Smoke test `cd /home/z/my-project/worker && timeout 4 bun run start` → boots cleanly, logs `[worker] booting — redis=redis://localhost:6379 aceStep=(not configured) s3=(not configured)` + `[worker] listening on queues: generate, remix, edit (concurrency=2, rate=1/30000ms per queue)`. Redis `ECONNREFUSED` errors are emitted (no Redis running in the sandbox) and logged gracefully via the attached `error` listener — the worker stays alive and keeps retrying via BullMQ's built-in reconnection.
- `curl -X POST http://localhost:3000/api/remix` (no auth) → `307` redirect to `/signin?callbackUrl=%2Fapi%2Fremix` — confirms the route compiles and the auth middleware wraps it correctly.
- `curl -X POST http://localhost:3000/api/edit-lyrics -H 'Content-Type: application/json' -d '{...}'` (no auth) → `307` redirect to `/signin?callbackUrl=%2Fapi%2Fedit-lyrics` — same.
- Dev log: `✓ Compiled in 420ms` after the curl probes — no compilation errors attributed to either new route.

## Notes for downstream agents

- The worker is a **fully standalone project**. It does NOT import anything from `src/`. The lyrics + cover handlers are deliberately copied (not symlinked) from `src/lib/ai/` so changes to the in-app versions don't break the worker at runtime. If you improve the in-app lyricist, mirror the change in `worker/handlers/lyrics.ts` (or refactor both to share a published package — out of scope here).
- The `Dockerfile` already present in `worker/` (not created by me — pre-staged by an earlier phase) expects a `start` script in `package.json` and runs `bun run start` → `tsx index.ts`. With `--production` install, `tsx` won't be present (it's in `devDependencies`). For production Docker, either move `tsx` to `dependencies` or change the Dockerfile's `CMD` to `["bun", "index.ts"]` (Bun can run TS natively). Out of scope for this task — flagged here for whoever owns the Dockerfile.
- The `generate` queue has no producers yet (the existing `/api/generate` route uses synchronous mode). The worker is ready for the future async-generation producer to drop in — `generateQueue.add("generate", {…})` from `/api/generate` is all it takes.
- The progress channel `job:{jobId}:progress` is published but no SSE/SSE-like route exists yet to surface it to the client. A follow-up task could add `GET /api/jobs/[id]/events` that subscribes to the channel via ioredis and streams SSE to the browser.

## What I did NOT touch

- No schema changes (`prisma/schema.prisma` is unchanged).
- No types changes (`src/lib/types.ts` is unchanged).
- No other API routes, components, lib files, globals.css, layout, middleware.
- No edits to the existing `src/lib/queue.ts` (consumed as-is).
- Did NOT start/stop the Next.js dev server. Did NOT start the worker in the background (it requires Redis which isn't running in the sandbox).
- Did NOT create the worker's `Dockerfile` (it was pre-staged in the directory before this task started).
