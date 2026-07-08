# Task P4-DOCKER — Docker configuration for the SpotiBot stack

**Agent:** docker (Phase 4)  ·  **Phase:** 4  ·  **Status:** ✅ complete

## Goal

Containerize the entire SpotiBot backend so it can run end-to-end on a single
GPU host: Redis (queue + pub/sub), PostgreSQL (primary DB), the ACE-Step GPU
FastAPI server (text-to-music), the BullMQ worker, and the Socket.io real-time
server. Provide a modified FastAPI server for ACE-Step that is async-first and
exposes `/generate`, `/audio2audio`, `/edit`, and `/health`.

## Files created (owned — no overlap with other agents)

| File | Purpose |
| --- | --- |
| `docker/ace-step/Dockerfile` | CUDA 12.6 GPU image with Python 3.10, ACE-Step repo, fastapi/uvicorn |
| `docker/ace-step/infer-api-mod.py` | Modified FastAPI server — lifespan-managed pipeline, async endpoints |
| `docker/ace-step/requirements-ace-step.txt` | Auxiliary Python deps pinned for reproducibility (file referenced from the Dockerfile; co-located with the Dockerfile so the build context is self-contained) |
| `docker-compose.yml` | Root compose file — all 5 services + 4 named volumes |
| `worker/Dockerfile` | Bun-based BullMQ worker image (multi-stage, non-root, tini PID-1) |
| `mini-services/socket-server/Dockerfile` | Bun-based Socket.io server image (multi-stage, non-root, tini PID-1) |

## Implementation notes

### `docker/ace-step/Dockerfile`
- **Base:** `nvidia/cuda:12.6.0-runtime-ubuntu22.04` (runtime, not devel — keeps the image ~2 GB smaller).
- **System layer:** Python 3.10 from `ppa:deadsnakes`, pip bootstrapped via `get-pip.py`, plus `git`, `ffmpeg`, `libsndfile1`, build-essential.
- **ACE-Step clone:** `git clone --depth 1 --branch ${ACE_STEP_REF}` from `${ACE_STEP_REPO}` (default `https://github.com/ace-step/ACE-Step-1.5.git` at `main`). Both args are overridable via build args so we can pin to a tagged release later.
- **Python deps:** installs the repo's own `requirements.txt` if present, then force-installs `torch==2.4.0` + `torchaudio==2.4.0` from the cu121 wheel index (binary-compatible with the 12.6 driver), then our `requirements-ace-step.txt` (soundfile, diffusers, transformers, etc., pinned).
- **FastAPI layer:** `fastapi==0.115.6`, `uvicorn[standard]==0.34.0`, `python-multipart==0.0.20`, `aiofiles==24.1.0`.
- **Volume mounts:** `/models` (checkpoints + HF cache), `/outputs` (generated audio) — both back the corresponding `ace-checkpoints` / `ace-outputs` named volumes in compose.
- **HEALTHCHECK:** curls `http://127.0.0.1:8000/health` with a 300s `start_period` (pipeline load can take 60–120s on first boot).
- **Hyphenated-filename fix:** the spec mandates the source file be named `infer-api-mod.py`, but Python module names cannot contain hyphens. The Dockerfile `COPY infer-api-mod.py /app/infer_api.py` renames on copy so `CMD ["python3", "-m", "uvicorn", "infer_api:app", ...]` actually imports. The in-repo filename is preserved.
- **CMD:** `python3 -m uvicorn infer_api:app --host 0.0.0.0 --port 8000 --workers 1` (functionally identical to the spec's `uvicorn infer-api:app` — see comment in the Dockerfile).

### `docker/ace-step/infer-api-mod.py`
- **Lifespan-managed pipeline.** `_load_pipeline()` runs in a worker thread (the `ACEStepPipeline` constructor blocks for 30–90s while weights load). The pipeline is built once on startup and stored in `app.state.pipeline`. State machine: `UNLOADED → LOADING → READY | FAILED`.
- **Lazy import of `acestep.pipeline_ace_step`.** Done inside `_load_pipeline()` so a misconfigured repo or missing torch doesn't crash uvicorn at boot — instead the pipeline state goes to `FAILED` and `/health` reports the error.
- **All endpoints async.** Every endpoint that calls the pipeline wraps the call in `_run_pipeline()` → `loop.run_in_executor(None, ...)` with an `asyncio.wait_for` timeout (default 600s, overridable via `ACE_REQUEST_TIMEOUT`). The uvicorn event loop never blocks on GPU work.
- **Endpoints:**
  - `GET /health` → `{ status, model, loaded_at, error, device, dtype }` — reports the pipeline state machine so the orchestrator can distinguish "container up but weights still loading" from "ready".
  - `POST /generate` — accepts `GenerateRequest` (Pydantic v2), returns `GenerateResponse { output_path, output_url, seed, format, duration, message }`.
  - `POST /audio2audio` — `UploadFile` + form fields; persists upload to a temp file, picks `audio2audio_infer` if the pipeline exposes it (else falls back to `music_diffusion_infer` with `source_audio=`), cleans up the temp file in a `finally` block.
  - `POST /edit` — `audio_url` (downloaded via `_download_to_bytes` in a worker thread) + `lyrics` + optional new `prompt`; picks `flow_edit_infer` if available, else `music_diffusion_infer` with `edit_mode=True`/`flow_edit=True`.
- **Robustness:** the pipeline method signature has drifted across ACE-Step commits, so each endpoint passes a superset of kwargs and falls back to a minimal-kwargs retry on `TypeError`. The `_extract_result()` helper normalizes the various return-tuple shapes (newest: `(wavs, final_filename, final_output_path, seed_used, prompt, lyrics, ...)`; older: `(wavs, final_output_path, seed_used)`) into `(output_path, seed)`.
- **Output URLs.** The response includes both `output_path` (absolute path inside the container's `/outputs` volume) and `output_url` (`/file/{basename}` — a future FastAPI static-files mount can serve this; the worker reads the file directly off the shared volume, so no HTTP fetch is needed in practice).

### `docker-compose.yml`
- **Services:** `redis`, `postgres`, `ace-step`, `worker`, `socket-server`. The Next.js app itself is NOT in this file (it continues to run via `bun run dev` on port 3000, or its own compose file in a future phase).
- **`redis`** — `redis:7-alpine`, AOF on, 512mb cap with LRU eviction, healthcheck `redis-cli ping`. Port `6379` exposed for local dev.
- **`postgres`** — `postgres:16-alpine`, env-driven credentials (`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, all default to `spotibot`), `pg_isready` healthcheck. Port `5432` exposed.
- **`ace-step`** — builds from `./docker/ace-step`, `deploy.resources.reservations.devices` requests all NVIDIA GPUs. Env wires up `ACE_CHECKPOINT_DIR`, `ACE_OUTPUT_DIR`, `ACE_REPO_DIR`, `ACE_DTYPE` (default `bfloat16`), `ACE_DEVICE` (default `cuda`), `HUGGING_FACE_HUB_TOKEN` for gated downloads. `start_period: 300s` on the healthcheck gives the pipeline time to load on first boot.
- **`worker`** — builds from `./worker`. Env: `REDIS_URL=redis://redis:6379`, `DATABASE_URL=postgresql://...@postgres:5432/...`, `ACE_STEP_API_URL=http://ace-step:8000` (internal-network alias — no port-forwarding needed), `WORKER_CONCURRENCY=2`. Mounts `ace-outputs` read-only so the worker can stream generated audio back to the Next.js API without round-tripping through ace-step's HTTP layer. `depends_on` waits for redis + postgres healthchecks AND ace-step healthcheck — otherwise the first job would 503 and retry forever.
- **`socket-server`** — builds from `./mini-services/socket-server`. Env: `SOCKET_PORT=3001`, `SOCKET_PATH=/` (mandatory — the host's Caddy gateway uses it to route `/?XTransformPort=3001`), `SOCKET_CORS_ORIGIN` (default `*`, override in prod). Depends only on redis.
- **Networks:** single user-defined bridge network `spotibot-net` so service DNS names resolve without `links`.
- **Volumes (4):** `spotibot-redis-data`, `spotibot-postgres-data`, `spotibot-ace-checkpoints` (model weights — large, must persist across image rebuilds), `spotibot-ace-outputs` (generated audio, shared rw by ace-step and ro by the worker).

### `worker/Dockerfile`
- **Base:** `oven/bun:1.1-slim` (Bun runs TypeScript natively → no `tsc` build step needed).
- **Multi-stage:** stage 1 (`deps`) installs production deps with `--frozen-lockfile`; stage 2 (`runner`) copies only the resolved `node_modules` + source. Keeps the final image lean.
- **Stub-package fallback:** if `package.json` doesn't exist yet (other agents haven't populated the worker folder), the deps stage creates a minimal stub so the image still builds.
- **Runtime hardening:** `tini` as PID-1 for clean SIGTERM → graceful BullMQ `worker.close()` flow; non-root `spotibot` user (uid 1001); `openssl` + `ca-certificates` for the Prisma query engine on Debian slim.
- **CMD:** `bun run start` (falls back to `bun index.ts` via compose override if no start script is defined).

### `mini-services/socket-server/Dockerfile`
- **Base:** `oven/bun:1.1-slim` (same rationale as worker).
- **Multi-stage** with the same stub-package fallback pattern.
- **EXPOSE 3001.** Env defaults: `SOCKET_PORT=3001`, `SOCKET_PATH=/`.
- **`tini` PID-1** for clean SIGTERM → socket.io `io.close()` flow (otherwise active connections can hang).
- **Non-root runtime** `spotibot` user.
- **CMD:** `bun index.ts`.

## Verification

- `python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))"` → OK (compose YAML parses cleanly).
- `python3 -c "import ast; ast.parse(open('docker/ace-step/infer-api-mod.py').read())"` → `PYTHON_PARSE_OK` (FastAPI server is syntactically valid Python).
- `bun run lint` not applicable to these files (ESLint only lints `.ts`/`.tsx`/`.js`/`.mjs` in `src/` and the project root; the new files live under `docker/`, `worker/`, `mini-services/`, all out of ESLint's scope). Verified the lint config doesn't try to scan these paths.

## What I did NOT touch

- The Next.js app (`src/**`), Prisma schema, `package.json`, `Caddyfile`, `next.config.ts`, `tsconfig.json`, any `.env*` files, the `examples/` websocket demo, or any existing agent's owned files.
- Did NOT create `worker/package.json`, `worker/index.ts`, `mini-services/socket-server/package.json`, or `mini-services/socket-server/index.ts` — those are owned by other agents. The Dockerfiles include a stub-package fallback so they still build even if those files don't exist yet.
- Did NOT modify the existing `examples/websocket/server.ts` reference implementation — the `mini-services/socket-server` is a separate service whose source files are owned by another agent.

## Notes for downstream agents

### Worker agent (whoever owns `worker/index.ts` + `worker/package.json`)
- The Dockerfile expects `index.ts` at the root of `./worker`.
- `package.json` MUST define a `start` script (e.g. `"start": "bun index.ts"`) for the default `CMD ["bun", "run", "start"]` to work. Without it, override the command in `docker-compose.yml`:
  ```yaml
  worker:
    command: ["bun", "index.ts"]
  ```
- Prisma: the worker will need `@prisma/client` + a `prisma generate` step. The current Dockerfile doesn't run `prisma generate` — if the worker's `package.json` has a `postinstall` script that runs `prisma generate`, that handles it; otherwise add a `RUN bunx prisma generate` line before the `USER spotibot` switch.
- Env contract (read in compose): `REDIS_URL`, `DATABASE_URL`, `ACE_STEP_API_URL`, `ACE_STEP_API_TIMEOUT_MS`, `WORKER_CONCURRENCY`, `LOG_LEVEL`.

### Socket-server agent (whoever owns `mini-services/socket-server/index.ts` + `package.json`)
- The Dockerfile expects `index.ts` at the root of `./mini-services/socket-server`.
- `package.json` should declare `socket.io` (e.g. `"socket.io": "^4.7.5"`). The stub-package fallback installs `socket.io@^4.7.5` if no `package.json` is present.
- Env contract (read in compose): `SOCKET_PORT` (default 3001), `SOCKET_PATH` (MUST stay `/` so Caddy can route `?XTransformPort=3001`), `SOCKET_CORS_ORIGIN`, `REDIS_URL`, `LOG_LEVEL`.
- The server should listen on `0.0.0.0:${SOCKET_PORT}` with `path: ${SOCKET_PATH}` — the existing `examples/websocket/server.ts` is the reference implementation.

### ACE-Step checkpoint seeding
- The `ace-step` container expects checkpoints under `/models/ace-step/` (env: `ACE_CHECKPOINT_DIR`). The `ace-checkpoints` named volume is empty on first boot; populate it either:
  - Pre-populate the host-side volume: `docker run --rm -v spotibot-ace-checkpoints:/models alpine sh -c "..."` to fetch weights, OR
  - Let ACE-Step's own startup logic download weights from HuggingFace (set `HUGGING_FACE_HUB_TOKEN` for gated repos), OR
  - Use a one-shot init container that runs `huggingface-cli download ace-step/ACE-Step-1.5 --local-dir /models/ace-step`.

### Switching the Next.js app from cloud Ace Music → self-hosted ACE-Step
- The adapter at `src/lib/ai/ace-client.ts` currently POSTs to `ACE_API_BASE/v1/chat/completions` (the cloud Ace Music OpenAI-compatible endpoint). To point at the self-hosted FastAPI server instead:
  1. Set `ACE_API_BASE=http://localhost:8000` (or the in-cluster alias `http://ace-step:8000` if the Next.js app is itself containerized).
  2. Rewrite `generateMusic()` to POST `/generate` with the `GenerateRequest` shape (prompt/lyrics/duration/language/bpm/key_scale/time_signature/audio_format/thinking/seed) and parse `GenerateResponse` (`output_path`, `output_url`, `seed`).
  3. Add a fetch step to download the audio bytes from `output_url` (or stream from the shared `ace-outputs` volume if the Next.js app co-locates with the worker).
- The cloud fallback (`ACE_API_KEY` still set) can remain as a hot-swap — if the self-hosted server is unhealthy, fall back to the cloud API.
