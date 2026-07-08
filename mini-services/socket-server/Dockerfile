# ─────────────────────────────────────────────────────────────────────────────
# SpotiBot Socket.io Server — Bun
# ─────────────────────────────────────────────────────────────────────────────
# Real-time event server for SpotiBot. Relays:
#   - playback state changes (play/pause/seek) across a user's devices
#   - queue mutations (add/remove/reorder) pushed from the worker
#   - generation progress events published by the worker to Redis pub/sub
#
# Build context: ./mini-services/socket-server (must contain package.json
# and index.ts at the root).
#
# Entry: `bun index.ts` — the server reads SOCKET_PORT (default 3001) and
# SOCKET_PATH (default "/") from env. The path MUST stay "/" so the host's
# Caddy gateway can route `/?XTransformPort=3001` to this service.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependency resolution ──────────────────────────────────────────
FROM oven/bun:1.1-slim AS deps

WORKDIR /app

# Copy manifests first so dep resolution is cached independently of source.
COPY package.json* bun.lock* bun.lockb* ./

# Install production deps (frozen lockfile for reproducibility). If no
# package.json exists yet (other agents haven't added it), create a minimal
# stub so the image still builds.
RUN if [ -f package.json ]; then \
        bun install --frozen-lockfile --production; \
    else \
        echo "WARNING: no package.json found — creating a stub with socket.io." \
        && echo '{"name":"spotibot-socket-server","version":"0.0.0","private":true,"dependencies":{"socket.io":"^4.7.5"}}' > package.json \
        && bun install --production; \
    fi

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM oven/bun:1.1-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    BUN_ENV=production \
    SOCKET_PORT=3001 \
    SOCKET_PATH=/ \
    BUN_INSTALL_CACHE_DIR=/tmp/.bun-cache

# tini → PID-1 signal forwarding (so SIGTERM reaches the socket.io server and
# gracefully closes active connections). ca-certificates → https upstream calls.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Non-root runtime user.
RUN groupadd --system --gid 1001 spotibot \
    && useradd --system --uid 1001 --gid spotibot --create-home --shell /usr/sbin/nologin spotibot

# Copy resolved node_modules.
COPY --from=deps /app/node_modules ./node_modules

# Copy the source. Build context is `./mini-services/socket-server`, so this
# picks up index.ts + package.json at the root.
COPY --chown=spotibot:spotibot package.json* ./
COPY --chown=spotibot:spotibot *.ts *.json ./

# Minimal tsconfig if the source didn't ship one.
RUN if [ ! -f tsconfig.json ]; then \
        echo '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","types":["bun-types"],"strict":true,"esModuleInterop":true,"skipLibCheck":true}}' > tsconfig.json; \
    fi

RUN chown -R spotibot:spotibot /app

USER spotibot

EXPOSE 3001

# tini → PID-1, ensures clean SIGTERM handling.
ENTRYPOINT ["/usr/bin/tini", "--"]

# The server reads SOCKET_PORT/SOCKET_PATH from env at boot.
CMD ["bun", "index.ts"]
