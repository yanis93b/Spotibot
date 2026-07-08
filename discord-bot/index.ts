/**
 * index.ts — SpotiBot Discord bot
 *
 * Connects to Discord with Guilds intent and exposes three slash commands:
 *
 *   /generate  — enqueue an Ace Music generation job on the BullMQ `ace:generate`
 *                queue, defer the reply, stream progress updates back to the
 *                interaction via Redis pub/sub (`job:{jobId}`), and edit the
 *                reply one final time on completion or failure.
 *   /status    — fetch a BullMQ job by id and render its current state as an
 *                embed.
 *   /library   — placeholder reply (real implementation will live in a future
 *                task that wires this to the Next.js /api/songs endpoint).
 *
 * All embeds use a fuchsia accent (0xBE185D) to match the SpotiBot web brand.
 *
 * Required env:
 *   DISCORD_TOKEN      — bot token from the Discord Developer Portal
 *   DISCORD_CLIENT_ID  — the application's OAuth2 client id
 *   REDIS_URL          — ioredis connection string (e.g. redis://localhost:6379)
 *
 * Optional env:
 *   DISCORD_GUILD_ID   — if set, only listens in this guild (dev convenience)
 *   JOB_TIMEOUT_MS     — abandon the live progress subscription after this many
 *                        ms without a terminal event (default 900_000 = 15 min)
 */

import {
  ActivityType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  type ChatInputCommandInteraction,
  type ColorResolvable,
} from "discord.js";
import IORedis from "ioredis";
import { Queue, QueueEvents } from "bullmq";

// ─── Config ────────────────────────────────────────────────────────────────

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS ?? 900_000);

if (!DISCORD_TOKEN) {
  console.error("[bot] Missing env DISCORD_TOKEN");
  process.exit(1);
}
if (!DISCORD_CLIENT_ID) {
  console.error("[bot] Missing env DISCORD_CLIENT_ID");
  process.exit(1);
}
if (!REDIS_URL) {
  console.error("[bot] Missing env REDIS_URL");
  process.exit(1);
}

/** Fuchsia brand accent — matches the SpotiBot web app's primary color. */
const FUCHSIA = 0xbe185d as ColorResolvable;

/** BullMQ queue name — must match the worker's queue name exactly. */
const QUEUE_NAME = "ace:generate";

/** Pub/sub channel pattern for per-job progress events. */
const jobChannel = (jobId: string): string => `job:${jobId}`;

// ─── Redis + BullMQ wiring ─────────────────────────────────────────────────

/**
 * Connection options handed to BullMQ. We pass the URL string + options
 * (rather than an `IORedis` instance) so BullMQ creates + manages its own
 * connections — this avoids the duplicate-ioredis-types conflict that arises
 * when the top-level `ioredis` package and BullMQ's bundled copy disagree on
 * the `RedisOptions` shape.
 *
 * `maxRetriesPerRequest: null` is REQUIRED by BullMQ — it does not tolerate
 * finite retry caps on the connections it owns (it blocks forever waiting for
 * blocking reads).
 */
const bullmqConnection = {
  url: REDIS_URL,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
};

const generateQueue = new Queue(QUEUE_NAME, { connection: bullmqConnection });
const queueEvents = new QueueEvents(QUEUE_NAME, { connection: bullmqConnection });

queueEvents.on("error", (err) => {
  console.error("[bot] queueEvents error:", err.message);
});

/**
 * Separate subscriber connection for Redis pub/sub. A subscriber enters
 * subscribe-mode and can't issue normal commands, so it MUST be a different
 * connection from the BullMQ one.
 */
function createSubscriber(): IORedis {
  const sub = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  sub.on("error", (err) => console.error("[bot] subscriber error:", err.message));
  return sub;
}

// ─── Job payload + progress protocol ───────────────────────────────────────

/**
 * Payload submitted to the `ace:generate` queue. Mirrors the web app's
 * POST /api/generate contract (prompt/genre/mood/style/voice) and adds the
 * Discord context the worker needs to publish progress + results.
 */
export interface GenerateJobData {
  prompt: string;
  genre: string;
  mood: string;
  style: string;
  voice?: string;
  duration?: number;
  // Discord context — published back on completion so we can format the reply:
  discordUserId: string;
  discordChannelId: string;
  discordGuildId: string | null;
  requestedAt: string; // ISO
}

/** Shape of progress events published on `job:{jobId}`. */
interface ProgressEvent {
  stage: string; // "queued" | "lyrics" | "audio" | "upload" | "completed" | "failed"
  progress?: number; // 0–100
  message?: string;
  title?: string;
  audioUrl?: string;
  durationMs?: number;
  error?: string;
}

/** Friendly labels for the generation pipeline stages. */
const STAGE_LABELS: Record<string, string> = {
  queued: "Queued",
  lyrics: "Writing lyrics",
  audio: "Synthesizing audio",
  upload: "Finalizing track",
  completed: "Completed",
  failed: "Failed",
};

// ─── Embed builders ────────────────────────────────────────────────────────

/**
 * A "now generating" embed with a live progress bar. Renders the prompt,
 * requested params, current stage label, and a 20-cell ASCII progress bar.
 */
function progressEmbed(
  data: GenerateJobData,
  jobId: string,
  evt: ProgressEvent
): EmbedBuilder {
  const pct = Math.max(0, Math.min(100, evt.progress ?? 0));
  const filled = Math.round(pct / 5); // 20 cells
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);

  const params: Array<[string, string]> = [
    ["Genre", data.genre || "—"],
    ["Mood", data.mood || "—"],
    ["Style", data.style || "—"],
    ["Duration", data.duration ? `${data.duration}s` : "90s (default)"],
  ];

  const stageLabel = STAGE_LABELS[evt.stage] ?? evt.stage;
  const statusLine = evt.message ? `\n${evt.message}` : "";

  return new EmbedBuilder()
    .setColor(FUCHSIA)
    .setTitle("🎵 Generating your song…")
    .setDescription(`\`\`\`\n${bar} ${pct.toFixed(0)}%\n\`\`\``)
    .addFields(
      { name: "Prompt", value: truncate(data.prompt, 1024) },
      { name: "Stage", value: `${stageLabel}${statusLine}`, inline: true },
      { name: "Job ID", value: `\`${jobId}\``, inline: true },
      {
        name: "Parameters",
        value: params.map(([k, v]) => `**${k}:** ${v}`).join("\n"),
        inline: false,
      }
    )
    .setFooter({ text: "SpotiBot · Ace Music engine" })
    .setTimestamp();
}

/** Final-success embed — shows the finished track + a playback link. */
function completedEmbed(
  data: GenerateJobData,
  jobId: string,
  evt: ProgressEvent
): EmbedBuilder {
  const title = evt.title ?? "Untitled track";
  const audioUrl = evt.audioUrl ?? "(no audio url provided)";
  const duration = evt.durationMs
    ? `${(evt.durationMs / 1000).toFixed(1)}s`
    : "—";

  return new EmbedBuilder()
    .setColor(FUCHSIA)
    .setTitle("✅ Song ready!")
    .setDescription(`**[${title}](${absoluteUrl(audioUrl)})**`)
    .addFields(
      { name: "Prompt", value: truncate(data.prompt, 1024) },
      { name: "Duration", value: duration, inline: true },
      { name: "Job ID", value: `\`${jobId}\``, inline: true },
      {
        name: "Listen",
        value: `[▶ Play track](${absoluteUrl(audioUrl)})`,
        inline: false,
      }
    )
    .setFooter({ text: "SpotiBot · Ace Music engine" })
    .setTimestamp();
}

/** Final-failure embed. */
function failedEmbed(data: GenerateJobData, jobId: string, evt: ProgressEvent): EmbedBuilder {
  const reason = evt.error ?? "Unknown error";
  return new EmbedBuilder()
    .setColor(0xdc2626) // red-600 for failure, distinct from fuchsia
    .setTitle("❌ Generation failed")
    .setDescription(`Your song could not be generated.`)
    .addFields(
      { name: "Prompt", value: truncate(data.prompt, 1024) },
      { name: "Reason", value: truncate(reason, 1024) },
      { name: "Job ID", value: `\`${jobId}\``, inline: true }
    )
    .setFooter({ text: "SpotiBot · Ace Music engine" })
    .setTimestamp();
}

/** /status embed — renders whatever state the BullMQ job is currently in. */
function statusEmbed(
  jobId: string,
  state: "completed" | "failed" | "active" | "waiting" | "delayed" | "paused" | "unknown",
  data?: Partial<GenerateJobData>,
  progress?: number,
  result?: unknown,
  failureReason?: string
): EmbedBuilder {
  const stateMeta: Record<string, { label: string; emoji: string }> = {
    completed: { label: "Completed", emoji: "✅" },
    failed: { label: "Failed", emoji: "❌" },
    active: { label: "In progress", emoji: "🎵" },
    waiting: { label: "Waiting in queue", emoji: "⏳" },
    delayed: { label: "Delayed", emoji: "⏱️" },
    paused: { label: "Paused", emoji: "⏸️" },
    unknown: { label: "Not found", emoji: "❓" },
  };
  // `noUncheckedIndexedAccess` would let `stateMeta[state]` be undefined;
  // `unknown` is the catch-all fallback so `meta` is always defined.
  const meta = stateMeta[state] ?? { label: "Unknown", emoji: "❓" };

  const embed = new EmbedBuilder()
    .setColor(FUCHSIA)
    .setTitle(`${meta.emoji} Job status: ${meta.label}`)
    .addFields({ name: "Job ID", value: `\`${jobId}\``, inline: false });

  if (progress != null) {
    embed.addFields({ name: "Progress", value: `${Math.round(progress)}%`, inline: true });
  }
  if (data?.prompt) {
    embed.addFields({ name: "Prompt", value: truncate(data.prompt, 1024), inline: false });
  }
  if (state === "completed" && result && typeof result === "object") {
    const r = result as { title?: string; audioUrl?: string; durationMs?: number };
    if (r.title) embed.addFields({ name: "Title", value: truncate(r.title, 256), inline: true });
    if (r.audioUrl)
      embed.addFields({
        name: "Listen",
        value: `[▶ Play track](${absoluteUrl(r.audioUrl)})`,
        inline: false,
      });
  }
  if (state === "failed" && failureReason) {
    embed.addFields({ name: "Reason", value: truncate(failureReason, 1024), inline: false });
  }
  if (state === "unknown") {
    embed.addFields({
      name: "Hint",
      value:
        "The job may have already finished and been removed from the queue, or the id is incorrect.",
      inline: false,
    });
  }

  return embed.setFooter({ text: "SpotiBot · Ace Music engine" }).setTimestamp();
}

/** /library placeholder embed. */
function libraryPlaceholderEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(FUCHSIA)
    .setTitle("📚 Your SpotiBot library")
    .setDescription(
      "Your personal library will appear here in a future update.\n\n" +
        "For now, head over to the **SpotiBot web app** to browse, manage, and " +
        "play all the songs you've generated — including ones started from Discord."
    )
    .addFields({
      name: "Coming soon",
      value: "• Track listing with inline playback\n• Delete / re-share from Discord\n• Filter by genre & mood",
      inline: false,
    })
    .setFooter({ text: "SpotiBot · Ace Music engine" })
    .setTimestamp();
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * Coerce a job result `audioUrl` (which the worker may publish as either an
 * absolute URL or a site-relative path like "/api/audio/{id}") into a fully
 * clickable URL for the embed.
 */
function absoluteUrl(audioUrl: string): string {
  if (!audioUrl) return "";
  if (/^https?:\/\//i.test(audioUrl)) return audioUrl;
  if (audioUrl.startsWith("/")) {
    const base = process.env.SPOTIBOT_WEB_BASE_URL ?? "http://localhost:3000";
    return `${base}${audioUrl}`;
  }
  return audioUrl;
}

/**
 * Pull the option string safely — Discord returns null when the option wasn't
 * provided. We normalize to "" (empty string) for downstream payload typing.
 */
function optStr(interaction: ChatInputCommandInteraction, name: string): string {
  const v = interaction.options.getString(name);
  return v ?? "";
}

function optInt(interaction: ChatInputCommandInteraction, name: string): number | undefined {
  const v = interaction.options.getInteger(name);
  return v ?? undefined;
}

// ─── Live progress streaming ───────────────────────────────────────────────

/**
 * Subscribe to `job:{jobId}` on a dedicated ioredis subscriber and edit the
 * deferred interaction reply on each progress event. Resolves when a terminal
 * event ("completed" or "failed") arrives, when the job times out, or when the
 * subscriber errors out.
 *
 * Returns the final terminal event (or null on timeout/error), so the caller
 * can render the final embed consistently.
 */
function streamProgress(
  interaction: ChatInputCommandInteraction,
  data: GenerateJobData,
  jobId: string
): Promise<ProgressEvent | null> {
  return new Promise((resolve) => {
    const sub = createSubscriber();
    const channel = jobChannel(jobId);
    let settled = false;

    // `onFailed` is registered on `queueEvents` AFTER `cleanup` is defined.
    // `cleanup` closes over `onFailed` via this mutable binding so it can also
    // remove the listener — breaking the otherwise-circular reference.
    let onFailed: ((args: { jobId: string; failedReason: string }) => void) | null = null;

    let timer: NodeJS.Timeout;
    const cleanup = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onFailed) queueEvents.removeListener("failed", onFailed);
      sub.unsubscribe(channel).catch(() => {});
      sub.quit().catch(() => {});
    };

    timer = setTimeout(() => {
      if (settled) return;
      console.warn(`[bot] job ${jobId} timed out after ${JOB_TIMEOUT_MS}ms`);
      cleanup();
      resolve(null);
    }, JOB_TIMEOUT_MS);

    sub.subscribe(channel).then(
      () => {
        /* subscribed — worker events will now arrive */
      },
      (err) => {
        console.error(`[bot] subscribe to ${channel} failed:`, err.message);
        cleanup();
        resolve(null);
      }
    );

    let lastEdit = 0;
    const MIN_EDIT_INTERVAL_MS = 1200; // throttle to avoid Discord's 5 edits/s rate limit

    sub.on("message", (_channel: string, raw: string) => {
      if (settled) return;
      let evt: ProgressEvent;
      try {
        evt = JSON.parse(raw) as ProgressEvent;
      } catch {
        console.warn(`[bot] invalid progress payload on ${channel}:`, raw);
        return;
      }

      const isTerminal = evt.stage === "completed" || evt.stage === "failed";

      // Throttle non-terminal updates to avoid hitting Discord's edit rate limit.
      // Terminal events are always rendered immediately.
      const now = Date.now();
      if (!isTerminal && now - lastEdit < MIN_EDIT_INTERVAL_MS) return;
      lastEdit = now;

      if (evt.stage === "completed") {
        interaction
          .editReply({ embeds: [completedEmbed(data, jobId, evt)] })
          .catch((e) => console.error("[bot] editReply (completed) failed:", e.message))
          .finally(() => {
            cleanup();
            resolve(evt);
          });
      } else if (evt.stage === "failed") {
        interaction
          .editReply({ embeds: [failedEmbed(data, jobId, evt)] })
          .catch((e) => console.error("[bot] editReply (failed) failed:", e.message))
          .finally(() => {
            cleanup();
            resolve(evt);
          });
      } else {
        interaction
          .editReply({ embeds: [progressEmbed(data, jobId, evt)] })
          .catch((e) => console.error("[bot] editReply (progress) failed:", e.message));
      }
    });

    // Also listen on QueueEvents for safety — if the worker crashes mid-job,
    // the pub/sub channel will never publish a terminal event but BullMQ will
    // still emit `failed` on QueueEvents. This is our backstop.
    onFailed = (args: { jobId: string; failedReason: string }): void => {
      if (args.jobId !== jobId || settled) return;
      const evt: ProgressEvent = { stage: "failed", error: args.failedReason };
      interaction
        .editReply({ embeds: [failedEmbed(data, jobId, evt)] })
        .catch((e) => console.error("[bot] editReply (queue failed) failed:", e.message))
        .finally(() => {
          cleanup();
          resolve(evt);
        });
    };
    queueEvents.on("failed", onFailed);
  });
}

// ─── Command handlers ──────────────────────────────────────────────────────

async function handleGenerate(interaction: ChatInputCommandInteraction): Promise<void> {
  const data: GenerateJobData = {
    prompt: optStr(interaction, "prompt"),
    genre: optStr(interaction, "genre"),
    mood: optStr(interaction, "mood"),
    style: optStr(interaction, "style"),
    duration: optInt(interaction, "duration"),
    discordUserId: interaction.user.id,
    discordChannelId: interaction.channelId,
    discordGuildId: interaction.guildId,
    requestedAt: new Date().toISOString(),
  };

  if (!data.prompt.trim()) {
    await interaction.reply({
      content: "❌ The `prompt` option is required.",
      ephemeral: true,
    });
    return;
  }

  // Defer the reply — Discord gives us up to 15 minutes to follow up.
  await interaction.deferReply();

  // Enqueue the job on the `ace:generate` queue. BullMQ returns a Job with
  // an auto-generated id; we publish progress to `job:{id}`.
  let jobId: string;
  try {
    const job = await generateQueue.add("generate", data, {
      // Long-running audio synthesis — generous per-job timeout, no early
      // discard. BullMQ will retry once on worker crash if we set attempts > 1.
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    });
    jobId = job.id ?? "";
    if (!jobId) {
      throw new Error("BullMQ returned an empty job id");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[bot] enqueue failed:", msg);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xdc2626)
          .setTitle("❌ Could not start generation")
          .setDescription(`The job could not be enqueued: ${truncate(msg, 1024)}`)
          .setTimestamp(),
      ],
    });
    return;
  }

  // Render the initial "queued" embed so the user sees immediate feedback
  // before the worker's first progress event arrives.
  const initial: ProgressEvent = { stage: "queued", progress: 0, message: "Job enqueued…" };
  await interaction.editReply({ embeds: [progressEmbed(data, jobId, initial)] });

  // Stream progress updates until terminal.
  const terminal = await streamProgress(interaction, data, jobId);

  // If streamProgress returned null, the subscriber timed out / errored before
  // a terminal event arrived. Surface a graceful "still running" message so
  // the user knows to /status later.
  if (!terminal) {
    await interaction
      .editReply({
        content: `⏳ Generation is still running in the background. Use \`/status jobid:${jobId}\` to check on it later.`,
        embeds: [],
      })
      .catch((e) => console.error("[bot] final timeout editReply failed:", e.message));
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const jobId = interaction.options.getString("jobid", true).trim();

  await interaction.deferReply();

  let state:
    | "completed"
    | "failed"
    | "active"
    | "waiting"
    | "delayed"
    | "paused"
    | "unknown" = "unknown";
  let data: Partial<GenerateJobData> | undefined;
  let progress: number | undefined;
  let result: unknown;
  let failureReason: string | undefined;

  try {
    const job = await generateQueue.getJob(jobId);
    if (!job) {
      state = "unknown";
    } else {
      // Prefer the explicit job state() method — BullMQ resolves this against
      // the queue's internal sets (completed/failed/active/waiting/delayed/paused).
      const s = await job.getState();
      state = (s as typeof state) ?? "unknown";
      data = (job.data ?? {}) as Partial<GenerateJobData>;
      const p = job.progress;
      progress = typeof p === "number" ? p : undefined;
      result = job.returnvalue;
      failureReason = job.failedReason;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[bot] /status getJob failed:", msg);
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xdc2626)
          .setTitle("❌ Could not look up job")
          .setDescription(truncate(msg, 1024))
          .setTimestamp(),
      ],
    });
    return;
  }

  await interaction.editReply({
    embeds: [statusEmbed(jobId, state, data, progress, result, failureReason)],
  });
}

async function handleLibrary(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ embeds: [libraryPlaceholderEmbed()] });
}

// ─── Client ────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] Logged in as ${c.user.tag} (id=${c.user.id})`);
  c.user.setPresence({
    activities: [{ name: "for /generate", type: ActivityType.Watching }],
    status: "online",
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case "generate":
        await handleGenerate(interaction);
        break;
      case "status":
        await handleStatus(interaction);
        break;
      case "library":
        await handleLibrary(interaction);
        break;
      default:
        await interaction
          .reply({ content: "Unknown command.", ephemeral: true })
          .catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bot] unhandled error in /${interaction.commandName}:`, msg);
    const payload = {
      content: `❌ Something went wrong running \`/${interaction.commandName}\`.`,
      ephemeral: true,
    };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch {
      /* best effort */
    }
  }
});

// Graceful shutdown — close Redis connections so `tsx watch` restarts cleanly.
async function shutdown(signal: string): Promise<void> {
  console.log(`[bot] received ${signal}, shutting down…`);
  try {
    await client.destroy();
  } catch {
    /* ignore */
  }
  try {
    await queueEvents.close();
  } catch {
    /* ignore */
  }
  try {
    // `Queue.close()` also closes the underlying Redis connections BullMQ
    // opened from `bullmqConnection` — so there's nothing else to teardown.
    await generateQueue.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

client.login(DISCORD_TOKEN).catch((err) => {
  console.error("[bot] login failed:", err);
  process.exit(1);
});
