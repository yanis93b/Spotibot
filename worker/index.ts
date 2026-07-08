/**
 * worker/index.ts
 *
 * Standalone BullMQ worker for the SpotiBot async pipeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS
 * ─────────────────────────────────────────────────────────────────────────────
 * A long-running Node/Bun process that drains three BullMQ queues produced by
 * the Next.js app:
 *
 *   - "generate"   — full text-to-music song generation (lyrics → audio →
 *                    cover → persist). Producers: future async /api/generate.
 *   - "remix"      — audio2audio remix of a source audio file. Producer:
 *                    POST /api/remix.
 *   - "edit"       — flow-edit of an existing song's lyrics. Producer:
 *                    POST /api/edit-lyrics.
 *
 * Each worker has `concurrency: 2` and a per-queue `limiter: { max: 1,
 * duration: 30_000 }` so each queue starts at most one job per 30 seconds
 * (the upstream ACE-Step server is GPU-bound and chokes on parallel hits).
 * With three queues, that's a global ceiling of 3 jobs starting per 30s; the
 * BullMQ limiter naturally back-pressures excess jobs.
 *
 * Progress is published to a Redis pub/sub channel per job:
 *   `job:{jobId}:progress`  → { percent, stage, data?, ts }
 * The Next.js app can subscribe (or expose a /api/jobs/[id]/events SSE route)
 * so the UI can show a real-time progress bar.
 *
 * Persistence:
 *   - When `S3_BUCKET` is configured, generated audio + covers are uploaded to
 *     S3 (compatible with R2/MinIO via `S3_ENDPOINT`). The bytes are also kept
 *     in the DB (audioData/coverData) so the existing /api/audio/[id] and
 *     /api/cover/[id] endpoints keep streaming inline — S3 is the durable
 *     primary copy, DB is the fast-access cache.
 *   - When S3 isn't configured, only the DB stores the bytes (the existing
 *     behaviour, fully backwards compatible).
 *
 * Environment variables:
 *   REDIS_URL                — redis://… (required; BullMQ + pub/sub)
 *   DATABASE_URL             — same SQLite/Postgres URL as the Next.js app
 *   ACE_STEP_API             — base URL of the self-hosted ACE-Step server
 *   S3_BUCKET, S3_REGION,
 *   S3_ACCESS_KEY_ID,
 *   S3_SECRET_ACCESS_KEY,
 *   S3_ENDPOINT,
 *   S3_PUBLIC_BASE           — S3-compatible object storage (all optional)
 *
 * Run:  `bun run dev`  (tsx watch index.ts)  → auto-restart on file changes
 *        bun run start  (tsx index.ts)        → one-shot
 */

import {
  Worker,
  type Job,
  type ConnectionOptions,
} from "bullmq";
import IORedis from "ioredis";
import { PrismaClient } from "@prisma/client";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { generateLyrics, type LyricsParams } from "./handlers/lyrics";
import { generateCover } from "./handlers/cover";
import {
  generateMusic,
  remixAudio,
  editLyrics,
  ACE_STEP_CONFIG,
} from "./handlers/ace-step";

// ─── Configuration ─────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_PUBLIC_BASE = process.env.S3_PUBLIC_BASE;
const S3_CONFIGURED = Boolean(S3_BUCKET);

const QUEUE_CONCURRENCY = 2;
const RATE_MAX = 1;
const RATE_DURATION_MS = 30_000;

// ─── Connections ───────────────────────────────────────────────────────────

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the connection so it can
 * retry internal commands indefinitely without surfacing a fetch-style error
 * to the worker.
 *
 * We construct a single ioredis instance and pass it to BullMQ via a
 * `ConnectionOptions` cast — the cast is purely a TypeScript-level bridge
 * because the worker's `ioredis` major version (5.11.x) can be slightly
 * newer than the one BullMQ ships with (5.10.x); the runtime API is
 * identical, but the type identities diverge so the cast avoids a
 * version-pinning war between the two packages.
 */
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});
const connectionOptions = connection as unknown as ConnectionOptions;

/** Separate connection for pub/sub so it never blocks the worker's queue ops. */
const publisher = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

// ioredis emits `error` events when the connection drops (e.g. Redis restarting
// or never available at boot). Without a listener Node treats them as uncaught
// exceptions and tears the process down. We log + ignore so the worker stays
// alive and the built-in reconnection logic can do its job.
function attachRedisErrorLog(name: string, conn: IORedis): void {
  conn.on("error", (err) => {
    console.error(`[redis:${name}] ${err.message}`);
  });
}
attachRedisErrorLog("worker", connection);
attachRedisErrorLog("publisher", publisher);

/** Prisma client — same DATABASE_URL as the Next.js app. */
const prisma = new PrismaClient();

/** Lazily-constructed S3 client (only built when S3 is configured). */
let s3: S3Client | null = null;
function getS3(): S3Client | null {
  if (!S3_CONFIGURED) return null;
  if (!s3) {
    s3 = new S3Client({
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      credentials:
        S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: S3_ACCESS_KEY_ID,
              secretAccessKey: S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }
  return s3;
}

// ─── Progress publishing ───────────────────────────────────────────────────

export interface ProgressPayload {
  percent: number;
  stage: string;
  data?: Record<string, unknown>;
  ts: number;
}

function publishProgress(
  jobId: string,
  percent: number,
  stage: string,
  data?: Record<string, unknown>,
): void {
  const payload: ProgressPayload = {
    percent: Math.max(0, Math.min(100, percent)),
    stage,
    data,
    ts: Date.now(),
  };
  publisher
    .publish(`job:${jobId}:progress`, JSON.stringify(payload))
    .catch((err) =>
      console.error(`[worker] failed to publish progress for ${jobId}`, err),
    );
}

// ─── S3 helpers ────────────────────────────────────────────────────────────

/**
 * Upload a buffer to S3 (when configured) under a generated key. Returns the
 * public URL when `S3_PUBLIC_BASE` is set, otherwise an `s3://` URL the worker
 * can resolve later via `downloadAudio`. Returns `null` when S3 isn't
 * configured (caller should fall back to DB-only storage).
 */
async function uploadToS3(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string | null> {
  const client = getS3();
  if (!client || !S3_BUCKET) return null;
  await client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
  if (S3_PUBLIC_BASE) {
    return `${S3_PUBLIC_BASE.replace(/\/+$/, "")}/${key}`;
  }
  return `s3://${S3_BUCKET}/${key}`;
}

/**
 * Download audio from `file://`, `s3://`, or `http(s)://` URLs into a Buffer.
 * Used by the remix/edit pipelines to fetch the source audio the API route
 * persisted to S3 / local disk.
 */
async function downloadAudio(url: string): Promise<Buffer> {
  if (url.startsWith("file://")) {
    return readFile(url.slice("file://".length));
  }
  if (url.startsWith("s3://")) {
    const match = url.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new Error(`Invalid s3 URL: ${url}`);
    const [, bucket, key] = match;
    const client = getS3();
    if (!client) throw new Error("S3 client not configured for s3:// download");
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const bytes = await res.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }
  // HTTP/HTTPS — assume the URL is publicly fetchable.
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ─── Job data shapes ───────────────────────────────────────────────────────

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

interface RemixJobData {
  userId: string;
  prompt: string;
  duration?: number;
  audioUrl: string;
  sourceFileName?: string;
  sourceContentType?: string;
  sourceSizeBytes?: number;
  createdAt: string;
}

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

// ─── Worker options (shared) ───────────────────────────────────────────────

const workerOptions = {
  connection: connectionOptions,
  concurrency: QUEUE_CONCURRENCY,
  limiter: {
    max: RATE_MAX,
    duration: RATE_DURATION_MS,
  },
};

// ─── Caption helper (mirrors /api/generate) ────────────────────────────────

const STYLE_TO_CAPTION: Record<string, string> = {
  "Male Vocal": "male lead vocal",
  "Female Vocal": "female lead vocal",
  "Instrumental Focus": "instrumental, no vocals",
  Choir: "choir vocals",
  "Spoken Word": "spoken-word vocal",
};

function buildCaption(params: {
  prompt: string;
  genre: string;
  mood: string;
  style: string;
}): string {
  const styleHint = STYLE_TO_CAPTION[params.style] ?? "";
  return [
    params.prompt,
    params.genre,
    params.mood.toLowerCase(),
    styleHint,
  ]
    .filter(Boolean)
    .join(", ");
}

// ─── "generate" worker ─────────────────────────────────────────────────────
// Pipeline: lyrics (15%) → audio (60%) → cover (80%) → persist (100%).

const generateWorker = new Worker(
  "generate",
  async (job: Job<GenerateJobData>) => {
    const data = job.data;
    const jobId = job.id ?? "unknown";
    console.log(`[generate:${jobId}] start — userId=${data.userId} prompt="${data.prompt.slice(0, 60)}…"`);

    publishProgress(jobId, 5, "starting");

    // ── Stage 1: Lyrics (15%) ────────────────────────────────────────────
    publishProgress(jobId, 8, "lyrics:generating");
    const lyricsParams: LyricsParams = {
      prompt: data.prompt,
      genre: data.genre,
      mood: data.mood,
      style: data.style,
    };
    const { title, lyrics } = await generateLyrics(lyricsParams);
    publishProgress(jobId, 15, "lyrics:done", { title });

    // ── Stage 2: Audio (60%) ─────────────────────────────────────────────
    publishProgress(jobId, 20, "audio:generating");
    const caption = buildCaption({
      prompt: data.prompt,
      genre: data.genre,
      mood: data.mood,
      style: data.style,
    });
    const audio = await generateMusic({
      prompt: caption,
      lyrics,
      duration: data.duration ?? 30,
      audioFormat: data.audioFormat || "mp3",
      language: data.language || "en",
      bpm: data.bpm,
      keyScale: data.keyScale,
      timeSignature: data.timeSignature,
      seed: data.seed,
    });
    publishProgress(jobId, 60, "audio:done", {
      bytes: audio.buffer.length,
      format: audio.format,
    });

    // ── Stage 3: Cover (80%) ─────────────────────────────────────────────
    publishProgress(jobId, 65, "cover:generating");
    const coverResult = await generateCover({
      title,
      genre: data.genre,
      mood: data.mood,
      prompt: data.prompt,
    });
    publishProgress(jobId, 80, "cover:done", {
      hasCover: Boolean(coverResult),
    });

    // ── Stage 4: Persist (100%) ──────────────────────────────────────────
    publishProgress(jobId, 85, "persist:uploading");
    const audioKey = `songs/${data.userId}/${jobId}.${audio.format}`;
    const s3AudioUrl = await uploadToS3(
      audio.buffer,
      audioKey,
      audio.contentType,
    );
    if (coverResult) {
      const coverKey = `covers/${data.userId}/${jobId}.png`;
      await uploadToS3(coverResult.buffer, coverKey, "image/png");
    }

    publishProgress(jobId, 92, "persist:db");
    const song = await prisma.song.create({
      data: {
        title,
        prompt: data.prompt,
        lyrics,
        genre: data.genre,
        mood: data.mood,
        style: data.style,
        voice: data.language || "en",
        // Prisma's Bytes scalar is typed `Uint8Array<ArrayBuffer>` while Node's
        // Buffer extends `Uint8Array<ArrayBufferLike>`. The runtime values
        // are identical (Buffer IS a Uint8Array) — this is a type-level only
        // cast, mirroring the same workaround in the Next.js app's
        // /api/generate route.
        audioData: audio.buffer as Uint8Array<ArrayBuffer>,
        audioFormat: audio.format,
        durationMs: Math.round((data.duration ?? 30) * 1000),
        coverData: (coverResult?.buffer as Uint8Array<ArrayBuffer>) ?? undefined,
        coverFormat: coverResult?.format ?? "png",
        bpm: data.bpm ?? null,
        keyScale: data.keyScale || null,
        timeSig: data.timeSignature || null,
        seed:
          typeof data.seed === "number" ? BigInt(Math.round(data.seed)) : null,
        ownerId: data.userId,
      },
    });

    publishProgress(jobId, 100, "complete", {
      songId: song.id,
      s3AudioUrl,
    });
    console.log(`[generate:${jobId}] complete — songId=${song.id}`);
    return { songId: song.id, s3AudioUrl };
  },
  workerOptions,
);

// ─── "remix" worker ────────────────────────────────────────────────────────
// Pipeline: fetch source (10%) → audio2audio (70%) → persist (100%).

const remixWorker = new Worker(
  "remix",
  async (job: Job<RemixJobData>) => {
    const data = job.data;
    const jobId = job.id ?? "unknown";
    console.log(
      `[remix:${jobId}] start — userId=${data.userId} audioUrl=${data.audioUrl}`,
    );

    publishProgress(jobId, 5, "starting");

    // ── Stage 1: Fetch source audio (10%) ────────────────────────────────
    publishProgress(jobId, 8, "source:downloading");
    const sourceBuffer = await downloadAudio(data.audioUrl);
    publishProgress(jobId, 10, "source:downloaded", {
      bytes: sourceBuffer.length,
    });

    // ── Stage 2: Remix via ACE-Step audio2audio (70%) ────────────────────
    publishProgress(jobId, 15, "remix:generating");
    const remixed = await remixAudio(data.audioUrl, data.prompt, data.duration, {
      audioBuffer: sourceBuffer,
      audioFormat: "mp3",
    });
    publishProgress(jobId, 70, "remix:done", {
      bytes: remixed.buffer.length,
      format: remixed.format,
    });

    // ── Stage 3: Persist (100%) ──────────────────────────────────────────
    publishProgress(jobId, 80, "persist:uploading");
    const audioKey = `remix/${data.userId}/${jobId}.${remixed.format}`;
    const s3AudioUrl = await uploadToS3(
      remixed.buffer,
      audioKey,
      remixed.contentType,
    );

    publishProgress(jobId, 92, "persist:db");
    const durationSec = data.duration ?? 30;
    const song = await prisma.song.create({
      data: {
        title: `Remix — ${data.prompt.slice(0, 40)}`.trim(),
        prompt: data.prompt,
        lyrics: "(Remix — no lyrics)",
        genre: "Remix",
        mood: "Remix",
        style: "Remix",
        voice: "en",
        audioData: remixed.buffer as Uint8Array<ArrayBuffer>,
        audioFormat: remixed.format,
        durationMs: Math.round(durationSec * 1000),
        ownerId: data.userId,
      },
    });

    publishProgress(jobId, 100, "complete", {
      songId: song.id,
      s3AudioUrl,
    });
    console.log(`[remix:${jobId}] complete — songId=${song.id}`);
    return { songId: song.id, s3AudioUrl };
  },
  workerOptions,
);

// ─── "edit" worker ─────────────────────────────────────────────────────────
// Pipeline: fetch source audio (10%) → flow-edit (70%) → persist (100%).

const editWorker = new Worker(
  "edit",
  async (job: Job<EditJobData>) => {
    const data = job.data;
    const jobId = job.id ?? "unknown";
    console.log(
      `[edit:${jobId}] start — songId=${data.songId} userId=${data.userId}`,
    );

    publishProgress(jobId, 5, "starting");

    // ── Stage 1: Fetch the existing song's audio (10%) ───────────────────
    // The API route verified ownership before enqueuing; we re-verify here
    // defensively in case the row changed hands between enqueue and process.
    publishProgress(jobId, 8, "song:loading");
    const song = await prisma.song.findFirst({
      where: { id: data.songId, ownerId: data.userId },
      select: {
        id: true,
        title: true,
        lyrics: true,
        audioData: true,
        audioFormat: true,
      },
    });
    if (!song) {
      throw new Error(
        `Edit job ${jobId}: song ${data.songId} not found or not owned by ${data.userId}`,
      );
    }
    publishProgress(jobId, 10, "song:loaded", {
      title: song.title,
      bytes: song.audioData.length,
    });

    // The flow-edit endpoint expects a fetch-able URL or a Buffer. We have
    // the bytes inline from the DB, so we pass them directly via the helper
    // and skip the URL fetch by passing an empty/placeholder URL (the buffer
    // wins over the URL inside `remixAudio`/`editLyrics`).
    publishProgress(jobId, 15, "edit:generating");
    const edited = await editLyrics(
      // The handler prefers `audioBuffer` over `audioUrl`, so we pass an
      // empty string here — `resolveAudio` never runs because the buffer is
      // present.
      "",
      data.originalLyrics,
      data.newLyrics,
      data.prompt,
      {
        audioBuffer: Buffer.from(song.audioData),
        audioFormat: data.audioFormat || song.audioFormat || "mp3",
      },
    );
    publishProgress(jobId, 70, "edit:done", {
      bytes: edited.buffer.length,
      format: edited.format,
    });

    // ── Stage 3: Persist — overwrite the existing song row (100%) ────────
    publishProgress(jobId, 80, "persist:uploading");
    const audioKey = `edit/${data.userId}/${data.songId}_${jobId}.${edited.format}`;
    const s3AudioUrl = await uploadToS3(
      edited.buffer,
      audioKey,
      edited.contentType,
    );

    publishProgress(jobId, 92, "persist:db");
    await prisma.song.update({
      where: { id: data.songId },
      data: {
        // Replace lyrics with the new ones the user wrote.
        lyrics: data.newLyrics,
        // Replace the audio bytes with the re-rendered track.
        audioData: edited.buffer as Uint8Array<ArrayBuffer>,
        audioFormat: edited.format,
        // Duration is best-effort: keep the original unless the worker can
        // detect otherwise. The ACE-Step `/edit` endpoint preserves the
        // source duration, so we leave durationMs untouched.
      },
    });

    publishProgress(jobId, 100, "complete", {
      songId: data.songId,
      s3AudioUrl,
    });
    console.log(`[edit:${jobId}] complete — songId=${data.songId}`);
    return { songId: data.songId, s3AudioUrl };
  },
  workerOptions,
);

// ─── Worker event wiring (logging only) ────────────────────────────────────

function wireWorker(name: string, w: Worker): void {
  w.on("completed", (job) => {
    console.log(`[${name}:${job.id}] completed ✓`);
  });
  w.on("failed", (job, err) => {
    console.error(`[${name}:${job?.id ?? "?"}] failed ✗ — ${err.message}`);
  });
  w.on("error", (err) => {
    console.error(`[${name}] worker error — ${err.message}`);
  });
}

wireWorker("generate", generateWorker);
wireWorker("remix", remixWorker);
wireWorker("edit", editWorker);

// ─── Boot + graceful shutdown ──────────────────────────────────────────────

console.log(
  `[worker] booting — redis=${REDIS_URL} ` +
    `aceStep=${ACE_STEP_CONFIG.configured ? ACE_STEP_CONFIG.base : "(not configured)"} ` +
    `s3=${S3_CONFIGURED ? S3_BUCKET : "(not configured)"}`,
);
console.log(
  `[worker] listening on queues: generate, remix, edit ` +
    `(concurrency=${QUEUE_CONCURRENCY}, rate=${RATE_MAX}/${RATE_DURATION_MS}ms per queue)`,
);

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}, shutting down…`);
  await Promise.allSettled([
    generateWorker.close(),
    remixWorker.close(),
    editWorker.close(),
  ]);
  await prisma.$disconnect();
  publisher.disconnect();
  connection.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
