/**
 * src/app/api/remix/route.ts
 *
 * POST /api/remix — queue an audio2audio (Remix) job.
 *
 * Pipeline contract (Phase P3):
 *   1. Client uploads a source audio file (multipart/form-data) plus a free-text
 *      `prompt` describing the desired remix style and an optional `duration`.
 *   2. This route persists the source audio to object storage (S3 when configured,
 *      local disk fallback for dev) so the worker can fetch it later by URL.
 *   3. The route enqueues a job onto the BullMQ `remix` queue (see
 *      `src/lib/queue.ts`) carrying the audio URL + prompt + userId.
 *   4. The standalone worker (`worker/index.ts`) picks the job up, calls the
 *      self-hosted ACE-Step `/audio2audio` endpoint, downloads the remixed
 *      audio, persists it (S3 or DB), and publishes progress over Redis
 *      pub/sub.
 *
 * Auth: REQUIRED (every remix is scoped to the signed-in user). The job payload
 * includes `userId` and the worker stamps the resulting Song row with that
 * `ownerId` — the API surface here never trusts a client-supplied owner.
 *
 * Request:
 *   multipart/form-data
 *     - file       : audio blob (required, ≤ 30 MB)
 *     - prompt     : string, 3..500 chars (required)
 *     - duration   : optional seconds (10..300), coerced from string
 *
 * Responses:
 *   202 — { jobId: string, status: "queued" }
 *   400 — { error: string }  (missing/invalid file / prompt / duration)
 *   401 — { error: "Unauthorized" }
 *   413 — { error: string }  (file too large)
 *   500 — { error: string }  (upload or enqueue failure)
 *   503 — { error: string }  (Redis not configured — worker pipeline offline)
 *
 * Server-only. Imported by Next.js App Router.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCurrentUserId } from "@/lib/session";
import { remixQueue, isQueueAvailable } from "@/lib/queue";

// ─── Storage configuration ────────────────────────────────────────────────
// When `S3_BUCKET` is set, source audio + generated remixes are uploaded to
// S3 (compatible with R2 / MinIO / etc. via `S3_ENDPOINT`). When unset, the
// route falls back to writing files to `UPLOAD_DIR` (default /tmp) — the
// worker reads them back via `file://` URLs.

const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const S3_ENDPOINT = process.env.S3_ENDPOINT;
/**
 * Public base URL used to construct fetch-able audio URLs from S3 object keys.
 * When unset we emit `s3://bucket/key` which the worker knows how to resolve
 * via the AWS SDK (the public URL is only needed if the worker downloads over
 * HTTP rather than the SDK).
 */
const S3_PUBLIC_BASE = process.env.S3_PUBLIC_BASE;
const UPLOAD_DIR = process.env.UPLOAD_DIR || "/tmp/spotibot-uploads";

/** Max accepted source-audio size (bytes). Generous to allow 5–10 min stems. */
const MAX_FILE_BYTES = 30 * 1024 * 1024; // 30 MB

/** Known audio MIME types we accept on the upload side. */
const ACCEPTED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
  // `application/octet-stream` is accepted because some browsers/clients
  // fall back to it when the audio type isn't recognised.
  "application/octet-stream",
]);

// ─── AWS S3 client (lazily created, cached on globalThis) ──────────────────
// We dynamically import the SDK so the route module can still load in
// environments where S3 isn't installed (e.g. tests). The import is cached on
// globalThis to avoid re-evaluating the module on every request under HMR.

interface CachedS3 {
  client: import("@aws-sdk/client-s3").S3Client;
  PutObjectCommand: typeof import("@aws-sdk/client-s3").PutObjectCommand;
}

async function getS3(): Promise<CachedS3> {
  const g = globalThis as unknown as { __spotibotS3?: CachedS3 };
  if (g.__spotibotS3) return g.__spotibotS3;
  const mod = await import("@aws-sdk/client-s3");
  const client = new mod.S3Client({
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
  g.__spotibotS3 = { client, PutObjectCommand: mod.PutObjectCommand };
  return g.__spotibotS3;
}

/**
 * Persist a source-audio buffer and return a URL the worker can fetch it from.
 * - S3 when configured: returns either `${S3_PUBLIC_BASE}/${key}` (when a
 *   public base is set) or `s3://${bucket}/${key}` (resolved via the SDK in
 *   the worker).
 * - Local fallback: writes to `UPLOAD_DIR` and returns `file:///abs/path`.
 */
async function persistSourceAudio(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string> {
  if (S3_BUCKET) {
    const { client, PutObjectCommand } = await getS3();
    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return S3_PUBLIC_BASE
      ? `${S3_PUBLIC_BASE.replace(/\/+$/, "")}/${key}`
      : `s3://${S3_BUCKET}/${key}`;
  }
  await mkdir(UPLOAD_DIR, { recursive: true });
  const filePath = join(UPLOAD_DIR, key.replace(/\//g, "_"));
  await writeFile(filePath, buffer);
  return `file://${filePath}`;
}

// ─── Request validation ────────────────────────────────────────────────────

const promptSchema = z
  .string()
  .trim()
  .min(3, "Prompt must be at least 3 characters")
  .max(500, "Prompt must be at most 500 characters");

const durationSchema = z.coerce
  .number()
  .int("Duration must be a whole number")
  .min(10, "Duration must be at least 10 seconds")
  .max(300, "Duration must be at most 300 seconds")
  .optional();

/** Sniff an extension from the upload's filename, falling back to its MIME. */
function deriveExtension(filename: string, contentType: string): string {
  const fromName = filename.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const map: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/aac": "aac",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/webm": "webm",
  };
  return map[contentType] ?? "bin";
}

// ─── Route handler ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Auth — every remix must be owned by a signed-in user.
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Feature gate — the worker pipeline requires Redis. If REDIS_URL isn't
  //    set the queue is a no-op proxy and we can't accept the job.
  if (!isQueueAvailable) {
    return NextResponse.json(
      {
        error:
          "Remix pipeline is offline — set REDIS_URL and start the worker to enable it.",
      },
      { status: 503 },
    );
  }

  // 3. Parse multipart/form-data.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  const promptRaw = formData.get("prompt");
  const durationRaw = formData.get("duration");

  // 4. Validate the file payload.
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing 'file' (audio blob)." },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: "Uploaded file is empty." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 30 MB)." },
      { status: 413 },
    );
  }
  const contentType = file.type || "application/octet-stream";
  if (!ACCEPTED_AUDIO_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: `Unsupported audio type: ${contentType}` },
      { status: 400 },
    );
  }

  // 5. Validate prompt + optional duration.
  const promptParsed = promptSchema.safeParse(String(promptRaw ?? ""));
  if (!promptParsed.success) {
    const msg =
      promptParsed.error.issues[0]?.message ?? "Prompt must be 3..500 characters.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  let duration: number | undefined;
  if (durationRaw != null && String(durationRaw).trim() !== "") {
    const d = durationSchema.safeParse(durationRaw);
    if (!d.success) {
      const msg = d.error.issues[0]?.message ?? "Duration must be 10..300 seconds.";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    duration = d.data;
  }

  // 6. Persist the source audio to S3 / local disk.
  const ext = deriveExtension(file.name || "source.mp3", contentType);
  const key = `remix/${userId}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  let audioUrl: string;
  try {
    audioUrl = await persistSourceAudio(buffer, key, contentType);
  } catch (err) {
    console.error("remix: failed to persist source audio", err);
    return NextResponse.json(
      { error: "Failed to upload source audio. Please try again." },
      { status: 500 },
    );
  }

  // 7. Enqueue the remix job. The worker picks up the audioUrl + prompt and
  //    performs the actual audio2audio synthesis off the request path.
  try {
    const job = await remixQueue.add(
      "remix",
      {
        userId,
        prompt: promptParsed.data,
        duration,
        audioUrl,
        sourceFileName: file.name || `source.${ext}`,
        sourceContentType: contentType,
        sourceSizeBytes: file.size,
        createdAt: new Date().toISOString(),
      },
      // Job ID is auto-generated by BullMQ; we surface it back so the client
      // can subscribe to progress over Redis pub/sub.
    );

    return NextResponse.json(
      { jobId: job.id, status: "queued" },
      { status: 202 },
    );
  } catch (err) {
    console.error("remix: failed to enqueue job", err);
    return NextResponse.json(
      { error: "Failed to queue remix job. Please try again." },
      { status: 500 },
    );
  }
}
