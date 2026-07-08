# ─────────────────────────────────────────────────────────────────────────────
# SpotiBot Worker — BullMQ consumer (Bun)
# ─────────────────────────────────────────────────────────────────────────────
# Consumes music-generation jobs from the BullMQ queue in Redis, calls the
# ACE-Step FastAPI server (/generate, /audio2audio, /edit), and persists the
# resulting audio + metadata back to Postgres via Prisma.
#
# Base image: oven/bun:1.1 (Debian bookworm-slim underneath). Bun is preferred
# over node:20-slim because:
#   - Native TypeScript execution → no `tsc` build step needed in the image.
#   - Faster cold start than node.
#   - Built-in fetch / WebCrypto → fewer polyfills.
#
# A multi-stage build keeps the final image lean: stage 1 (`deps`) installs
# production deps into a clean node_modules; stage 2 (`runner`) copies just
# the resolved node_modules + source.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependency resolution ──────────────────────────────────────────
FROM oven/bun:1.1-slim AS deps

WORKDIR /app

# Copy lockfile + manifest first to maximize layer caching. Either lockfile
# form is supported (bun.lock is the new text-based lockfile, bun.lockb is the
# legacy binary one).
COPY package.json* bun.lock* bun.lockb* ./

# Install production deps only. --frozen-lockfile ensures CI-grade
# reproducibility (the build fails if package.json drifted from the lockfile).
RUN if [ -f package.json ]; then \
        bun install --frozen-lockfile --production; \
    else \
        echo "WARNING: no package.json found — creating a stub so the image builds." \
        && echo '{"name":"spotibot-worker","version":"0.0.0","private":true,"scripts":{"start":"bun index.ts"}}' > package.json \
        && bun install --production; \
    fi

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM oven/bun:1.1-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    BUN_ENV=production \
    # Bun writes cache to /tmp by default — keep it on a writable tmpfs.
    BUN_INSTALL_CACHE_DIR=/tmp/.bun-cache

# Install runtime system deps that the Prisma engine + any native deps need.
# `openssl` + `ca-certificates` are required by Prisma's query engine on
# Debian slim; `tini` gives us PID-1 signal forwarding so SIGTERM reliably
# stops the worker (important for graceful BullMQ shutdown).
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        openssl \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for the runtime. The worker doesn't need root.
RUN groupadd --system --gid 1001 spotibot \
    && useradd --system --uid 1001 --gid spotibot --create-home --shell /usr/sbin/nologin spotibot

# Copy the resolved node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy the worker source. The build context is `./worker`, so this picks up
# index.ts (and any other .ts files) at the root. We also copy package.json
# so `bun start` resolves the `start` script if defined.
COPY --chown=spotibot:spotibot package.json* ./
COPY --chown=spotibot:spotibot *.ts *.json ./

# If a tsconfig.json was copied above, leave it in place; otherwise create a
# minimal one so Bun's TS loader is happy.
RUN if [ ! -f tsconfig.json ]; then \
        echo '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","types":["bun-types"],"strict":true,"esModuleInterop":true,"skipLibCheck":true}}' > tsconfig.json; \
    fi

# Output directory shared with the ace-step container (read-only here — the
# worker only reads generated audio, never writes to it).
RUN mkdir -p /outputs && chown -R spotibot:spotibot /app /outputs

USER spotibot

# tini as PID 1 ensures SIGTERM → graceful BullMQ worker.close() flow.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command: run the worker entrypoint. Override via docker-compose if a
# different entry (e.g. index.ts at a non-root path) is needed.
CMD ["bun", "run", "start"]

# If package.json has no `start` script, fall back to `bun index.ts`:
# (the comment below is for humans / docker-compose authors — Docker doesn't
#  support shell-fallback in CMD, so we rely on the start script being defined
#  OR on the operator overriding the command in docker-compose.yml)
#   command: ["bun", "index.ts"]
