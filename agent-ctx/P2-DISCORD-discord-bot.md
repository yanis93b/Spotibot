# P2-DISCORD — Discord bot for SpotiBot

**Task ID:** P2-DISCORD
**Agent:** discord-bot
**Phase:** 2 (Discord bot)
**Status:** ✅ COMPLETE
**Lint/typecheck:** `npx tsc --noEmit` → 0 errors (standalone project, no `bun run lint` per spec)

## Scope

Built a standalone Discord bot (`discord-bot/`) that lets users generate songs
via slash commands. The bot enqueues jobs on the existing BullMQ `ace:generate`
queue and streams progress updates back to the originating Discord interaction
via Redis pub/sub on `job:{jobId}` channels.

The bot is **independent** of the Next.js app — its own `package.json`, own
`tsconfig.json`, own `node_modules`, runs as a separate process on its own.
It only shares two things with the rest of the platform:
1. The Redis instance (via `REDIS_URL`).
2. The BullMQ `ace:generate` queue (the same queue the worker consumes).

## Files created (and ONLY these)

| File | Purpose |
|------|---------|
| `discord-bot/package.json` | Manifest — name `spotibot-discord`, scripts `dev` (`tsx watch index.ts`), `start` (`tsx index.ts`), `deploy-commands` (`tsx deploy-commands.ts`). Deps: `discord.js@^14.16.0`, `ioredis@^5.4.0`, `bullmq@^5.13.0`. Dev deps: `tsx@^4.19.0`, `typescript@^5.6.0`, `@types/node@^22.0.0`. |
| `discord-bot/tsconfig.json` | TS config for Node — `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `noUncheckedIndexedAccess: true`, `noUnusedLocals/Parameters: true`, `isolatedModules: true`, `types: ["node"]`. Includes only `*.ts` in the bot root. |
| `discord-bot/deploy-commands.ts` | Registers 3 slash commands via Discord REST PUT. `/generate` (prompt required, genre/mood/style/duration optional, with curated choice lists + `maxLength`/`min`/`max` bounds), `/status` (jobid required), `/library` (no options). Picks guild vs. global scope based on `DISCORD_GUILD_ID` env (dev fast-path). PUT is idempotent — safe to re-run. |
| `discord-bot/index.ts` | Main bot file. Discord.js client with `GatewayIntentBits.Guilds` + `Partials.Channel`. Wires BullMQ `Queue` + `QueueEvents` on the `ace:generate` queue. Three command handlers. Live progress streaming via dedicated ioredis subscriber per `/generate` invocation. Graceful SIGINT/SIGTERM shutdown. |

## Architecture decisions

### BullMQ connection strategy (avoiding the duplicate-ioredis trap)

BullMQ bundles its own copy of `ioredis`. When the top-level `ioredis@5.11.1`
and BullMQ's bundled `ioredis` disagree on the `RedisOptions` shape (which
they do — the `Connector` types drifted between the two versions), TypeScript
rejects `connection: myIORedisInstance` with a long "Types of property
'options' are incompatible" error.

**Solution:** pass a plain options object to BullMQ instead of an `IORedis`
instance:

```ts
const bullmqConnection = {
  url: REDIS_URL,
  maxRetriesPerRequest: null,   // REQUIRED by BullMQ
  enableReadyCheck: true,
};
const generateQueue = new Queue(QUEUE_NAME, { connection: bullmqConnection });
const queueEvents = new QueueEvents(QUEUE_NAME, { connection: bullmqConnection });
```

BullMQ internally instantiates and manages its own connections from this
options object. On shutdown, `Queue.close()` + `QueueEvents.close()` tear
those connections down — no manual `ioredis.quit()` needed.

The pub/sub subscriber (`createSubscriber()`) is still built from the
top-level `ioredis` package — that's fine because it's **never** passed to
BullMQ. It exists solely to listen on `job:{jobId}` channels, which requires
entering subscribe-mode (and subscribe-mode connections can't issue normal
commands, so the BullMQ connection can't double as a subscriber).

### Job payload (`GenerateJobData`)

```ts
{
  prompt: string;       // required, ≤900 chars (enforced by slash option)
  genre: string;        // "" if not provided
  mood: string;         // "" if not provided
  style: string;        // "" if not provided
  duration?: number;    // 10–180 seconds, optional
  discordUserId: string;
  discordChannelId: string;
  discordGuildId: string | null;
  requestedAt: string;  // ISO timestamp
}
```

The first five fields mirror the Next.js `POST /api/generate` contract
(`{ prompt, genre, mood, style, voice? }`) so the same worker can serve both
the web and Discord paths. The Discord-context fields are added so the worker
can publish progress to the right channel and (in a future task) write the
finished track to the user's library.

### Progress protocol (Redis pub/sub on `job:{jobId}`)

The worker publishes JSON messages on `job:{jobId}`. The bot subscribes and
parses each as `ProgressEvent`:

```ts
{
  stage: "queued" | "lyrics" | "audio" | "upload" | "completed" | "failed";
  progress?: number;     // 0–100
  message?: string;      // human-readable status line
  title?: string;        // on completed
  audioUrl?: string;     // on completed — absolute or site-relative ("/api/audio/{id}")
  durationMs?: number;   // on completed
  error?: string;        // on failed
}
```

Non-terminal events (`queued`/`lyrics`/`audio`/`upload`) re-render the
progress embed (a 20-cell ASCII progress bar + stage label + parameters).
Terminal events render a final success/failure embed and resolve the
streaming promise.

### Edit-rate-limit throttling

Discord limits interaction-response edits to ~5/second. The worker may emit
many rapid `audio`-stage events as it concatenates TTS chunks. To stay under
the limit, non-terminal updates are throttled to one edit per 1200 ms
(`MIN_EDIT_INTERVAL_MS`). Terminal events (`completed`/`failed`) bypass the
throttle — they must always render.

### QueueEvents backstop

If the worker crashes mid-job, the pub/sub channel will never emit a terminal
event. As a backstop, the bot also registers a `queueEvents.on("failed", …)`
listener for the duration of each `/generate` invocation. If BullMQ emits a
`failed` event for the in-flight `jobId`, the bot renders the failure embed
and cleans up. The listener is removed on any terminal resolution (success,
failure, timeout, or subscribe error) via the `cleanup()` closure.

### Timeout safety

`JOB_TIMEOUT_MS` (default 15 min) protects against a worker that goes silent
without failing. On timeout, the bot edits the reply with a "still running in
the background, use `/status` to check later" message and unsubscribes — the
job itself is not cancelled (the worker may still be producing audio).

### Embed color contract

- **All success/in-progress embeds:** fuchsia `0xBE185D` (matches the SpotiBot web brand).
- **All failure embeds:** red `0xDC2626` (red-600) — distinct from fuchsia so failures are visually unmistakable.

### `audioUrl` resolution

The worker may publish either an absolute URL (`https://...`) or a
site-relative path (`/api/audio/{id}`) — matching the web app's `Song.audioUrl`
contract. `absoluteUrl()` coerces relative paths to `${SPOTIBOT_WEB_BASE_URL}${path}`
(default `http://localhost:3000`) so the embed's `[▶ Play track]` link is
always clickable. The `SPOTIBOT_WEB_BASE_URL` env var is optional and
documented in the file header.

## Slash command surface

### `/generate`
- `prompt` (string, required, ≤900 chars)
- `genre` (choice: pop/rock/hiphop/electronic/jazz/classical/rnb/folk/metal/ambient)
- `mood` (choice: happy/sad/energetic/calm/dark/romantic/epic/dreamy)
- `style` (free-form string, ≤120 chars)
- `duration` (integer 10–180 seconds)

Defers reply → enqueues job → renders initial "Queued" embed → streams
progress → renders final embed.

### `/status`
- `jobid` (string, required)

Defers reply → `generateQueue.getJob(jobId)` → renders a state embed
(completed/failed/active/waiting/delayed/paused/unknown) using BullMQ's
`job.getState()` for the canonical state, `job.progress` for the percent,
`job.returnvalue` for the result (title/audioUrl/durationMs) on completed
jobs, and `job.failedReason` on failed jobs. "unknown" state (job not found
or already evicted from `removeOnComplete`/`removeOnFail`) renders a
helpful hint.

### `/library`
- (no options)

Placeholder reply — a fuchsia embed explaining the library will be wired to
the web app's `/api/songs` endpoint in a future task. For now it points users
to the web app.

## Environment variables

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `DISCORD_TOKEN` | ✅ | — | Bot token from Discord Developer Portal. Bot exits if missing. |
| `DISCORD_CLIENT_ID` | ✅ | — | Application (OAuth2) id. Validated at startup; used by `deploy-commands.ts` for the registration route. |
| `REDIS_URL` | ✅ | `redis://localhost:6379` | ioredis connection string shared by BullMQ + the pub/sub subscriber. |
| `DISCORD_GUILD_ID` | ❌ | — | If set, `deploy-commands.ts` registers as guild commands (instant propagation — dev fast-path). If unset, registers globally (1-hour propagation). |
| `JOB_TIMEOUT_MS` | ❌ | `900000` (15 min) | Abandon live progress subscription after this many ms without a terminal event. |
| `SPOTIBOT_WEB_BASE_URL` | ❌ | `http://localhost:3000` | Prepended to site-relative `audioUrl`s (e.g. `/api/audio/{id}`) when rendering embed links. |

## Verification

- `cd /home/z/my-project/discord-bot && bun install` → 52 packages, lockfile saved, 0 errors.
- `cd /home/z/my-project/discord-bot && npx tsc --noEmit` → **0 errors, 0 warnings** across both `index.ts` and `deploy-commands.ts`.
- Did NOT run `bun run lint` (this is a standalone project outside the Next.js eslint config, per the task spec).
- Did NOT start the bot (requires a real `DISCORD_TOKEN` + Discord guild + a worker consuming `ace:generate` — out of scope for this task).
- Did NOT modify any other agent's files. No `src/`, no `prisma/`, no `package.json` (root), no `Caddyfile`, no `.env*`.

## Integration TODOs (for the orchestrator / future agents)

1. **Worker contract** — the BullMQ worker that consumes `ace:generate` (owned by a future task) MUST:
   - Accept `GenerateJobData` (the shape exported from `index.ts`).
   - Publish `ProgressEvent` JSON on `job:{jobId}` at each pipeline stage.
   - On success, publish `{ stage: "completed", title, audioUrl, durationMs }`.
   - On failure, publish `{ stage: "failed", error }`.
   - Persist the finished `Song` to the database (so it shows up in the web library and `/library` can list it later).
2. **`/library` real implementation** — wire to the Next.js `/api/songs` endpoint scoped by `discordUserId` (will need a new field on `Song` or a join table mapping Discord users → SpotiBot accounts). For now, `/library` returns a placeholder embed.
3. **Operational** — set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `REDIS_URL` in the bot's env. Run `bun run deploy-commands` once after the first deploy (or whenever the slash command schema changes). Then `bun run dev` (or `bun run start` in production) to launch the bot. The bot needs no inbound port — it only opens an outbound Discord gateway connection.
4. **Optional** — set `SPOTIBOT_WEB_BASE_URL` to the public-facing URL so Discord embed links to tracks resolve for end users (not `localhost:3000`).
