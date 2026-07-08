/**
 * SpotiBot — Socket.io mini-service (port 3001)
 *
 * Real-time generation progress relay.
 *
 * Flow:
 *   1. Generator (Phase 2, future agent) publishes JSON progress payloads to
 *      the Redis pub/sub channel `job:{jobId}`.
 *   2. This service holds one Redis subscriber connection, subscribes to each
 *      `job:{jobId}` channel on demand, and relays every published message to
 *      the matching socket.io room as a `progress` event.
 *   3. Browser clients connect via the Caddy gateway using
 *      `io("/?XTransformPort=3001", { query: { jobId } })` and receive the
 *      `progress` events for their job.
 *
 * Redis is optional at runtime — if no Redis is reachable, the socket server
 * still accepts connections and joins rooms; downstream `progress` events
 * simply won't fire until Redis comes back. This keeps the service robust in
 * dev sandboxes where Redis may not be running.
 */

import { createServer } from "http";
import { Server, Socket } from "socket.io";
import Redis from "ioredis";

const PORT = 3001;
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const ALLOWED_ORIGIN = process.env.SOCKET_CORS_ORIGIN || "http://localhost:3000";

const httpServer = createServer();
const io = new Server(httpServer, {
  // Path MUST be "/" — Caddy uses it to forward ?XTransformPort=3001 traffic.
  path: "/",
  cors: {
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ---------------------------------------------------------------------------
// Redis subscriber — one shared connection for ALL job channels.
// ---------------------------------------------------------------------------
let subscriber: Redis | null = null;

function initSubscriber(): Redis | null {
  try {
    const client = new Redis(REDIS_URL, {
      retryStrategy: (times: number) => Math.min(times * 500, 5000),
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      lazyConnect: false,
    });

    client.on("connect", () => {
      console.log(`[socket-server] Connected to Redis at ${REDIS_URL}`);
    });
    client.on("reconnecting", (delay: number) => {
      console.log(`[socket-server] Redis reconnecting in ${delay}ms…`);
    });
    client.on("end", () => {
      console.warn("[socket-server] Redis connection closed.");
    });
    client.on("error", (err: Error) => {
      // Non-fatal — keep serving sockets; relay will resume when Redis returns.
      console.warn(`[socket-server] Redis error: ${err.message}`);
    });

    // Relay every published message to the matching socket room.
    client.on("message", (channel: string, message: string) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message);
      } catch {
        // Allow non-JSON publishers — forward as a raw string under `message`.
        payload = { raw: message };
      }
      io.to(channel).emit("progress", payload);
    });

    return client;
  } catch (err) {
    console.warn(
      `[socket-server] Failed to initialize Redis subscriber: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

subscriber = initSubscriber();

// Track which Redis channels we've already subscribed to (one subscription
// per channel, shared across every client in that room).
const subscribedChannels = new Set<string>();

function ensureSubscribed(room: string): void {
  const sub = subscriber;
  if (!sub || subscribedChannels.has(room)) return;
  subscribedChannels.add(room);
  // Promise-based overload — the callback overload is typed as
  // `Callback<unknown>` which loses the `count` number, so we use the promise
  // form and log on resolution.
  sub.subscribe(room).then(
    (count: unknown) => {
      console.log(
        `[socket-server] Subscribed to Redis channel "${room}" (${String(
          count,
        )} total).`,
      );
    },
    (err: Error) => {
      subscribedChannels.delete(room);
      console.warn(
        `[socket-server] subscribe("${room}") failed: ${err.message}`,
      );
    },
  );
}

// ---------------------------------------------------------------------------
// Connection handler — join job room, ensure Redis subscription.
// ---------------------------------------------------------------------------
io.on("connection", (socket: Socket) => {
  const jobId = (socket.handshake.query as { jobId?: string }).jobId;

  if (!jobId || typeof jobId !== "string") {
    console.warn(
      `[socket-server] Rejecting ${socket.id} — missing jobId in handshake query.`,
    );
    socket.emit("error", { message: "Missing jobId in connection query." });
    socket.disconnect(true);
    return;
  }

  const room = `job:${jobId}`;
  void socket.join(room);
  ensureSubscribed(room);

  console.log(
    `[socket-server] Client ${socket.id} joined room "${room}" (room size: ${
      io.sockets.adapter.rooms.get(room)?.size ?? 0
    }).`,
  );

  // Acknowledge the join so the client knows the relay is wired up.
  socket.emit("joined", { jobId, room, ts: Date.now() });

  socket.on("disconnect", (reason: string) => {
    const remaining = io.sockets.adapter.rooms.get(room)?.size ?? 0;
    console.log(
      `[socket-server] Client ${socket.id} left "${room}" (${reason}); ${remaining} remaining.`,
    );
    // We deliberately do NOT unsubscribe from Redis here — another client may
    // join the same job later, and re-subscribing is cheap. Channel lifecycle
    // is bounded by job lifetime, not by socket lifetime.
  });

  socket.on("error", (err: Error) => {
    console.error(`[socket-server] Socket error (${socket.id}): ${err.message}`);
  });
});

// ---------------------------------------------------------------------------
// Boot + graceful shutdown.
// ---------------------------------------------------------------------------
httpServer.listen(PORT, () => {
  console.log(`[socket-server] Socket.io listening on port ${PORT}`);
  console.log(
    `[socket-server] CORS origin: ${ALLOWED_ORIGIN} · Redis: ${REDIS_URL}`,
  );
});

function shutdown(signal: string): void {
  console.log(`[socket-server] Received ${signal}, shutting down…`);
  if (subscriber) {
    void subscriber.quit().catch(() => {});
  }
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Diagnose unexpected exits — log every signal we receive so we can tell
// whether the sandbox is killing us vs. an internal crash.
process.on("SIGHUP", () => {
  console.warn("[socket-server] Received SIGHUP — ignoring (detached).");
});
process.on("SIGUSR1", () => console.warn("[socket-server] SIGUSR1"));
process.on("SIGUSR2", () => console.warn("[socket-server] SIGUSR2"));

// Swallow uncaught errors so a flaky upstream (Redis, socket, etc.) can't
// bring the whole relay down. Each is logged so it stays debuggable.
process.on("uncaughtException", (err: Error) => {
  console.error(`[socket-server] uncaughtException: ${err?.stack ?? err}`);
});
process.on("unhandledRejection", (reason: unknown) => {
  console.error(`[socket-server] unhandledRejection: ${String(reason)}`);
});

process.on("exit", (code: number) => {
  console.log(`[socket-server] Process exiting with code ${code}.`);
});
