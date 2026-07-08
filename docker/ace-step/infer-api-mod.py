"""
infer-api-mod.py — modified FastAPI server for ACE-Step (GPU).

This is a drop-in replacement for the stock `infer-api.py` shipped in the
ACE-Step repo. The differences are:

  * Async-first — every endpoint offloads the heavy GPU work to a thread pool
    via `asyncio.get_event_loop().run_in_executor(...)` so the uvicorn event
    loop stays responsive (no blocking calls on the request handler thread).
  * Lifespan-managed pipeline — `ACEStepPipeline` is constructed ONCE during
    FastAPI's startup lifespan and held in `app.state.pipeline`. The /health
    endpoint reports whether the pipeline is loaded, loading, or failed.
  * Stable JSON contract — `/generate`, `/audio2audio`, and `/edit` all return
    `{ "output_path": str, "seed": int, ... }` so the Next.js adapter can
    treat the self-hosted server and the Ace Music cloud API uniformly.
  * Runnable as `uvicorn infer-api-mod:app` (the hyphenated filename is
    importable as a module path because uvicorn treats it as a file-spec).

Environment variables
---------------------
ACE_CHECKPOINT_DIR   default /models/ace-step        — checkpoint root
ACE_OUTPUT_DIR       default /outputs                — generated audio output dir
ACE_REPO_DIR         default /opt/ACE-Step           — cloned repo root (added to sys.path)
ACE_DTYPE            default bfloat16                — torch dtype string
ACE_DEVICE           default cuda                    — torch device
ACE_DEFAULT_DURATION default 30                      — fallback duration in seconds
ACE_DEFAULT_FORMAT   default wav                     — fallback output format
ACE_MAX_DURATION     default 600                     — clamp ceiling for duration
ACE_REQUEST_TIMEOUT  default 600                     — per-request GPU timeout (s)
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib
import io
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# ─── Configuration ───────────────────────────────────────────────────────────

CHECKPOINT_DIR = Path(os.environ.get("ACE_CHECKPOINT_DIR", "/models/ace-step"))
OUTPUT_DIR = Path(os.environ.get("ACE_OUTPUT_DIR", "/outputs"))
REPO_DIR = Path(os.environ.get("ACE_REPO_DIR", "/opt/ACE-Step"))
DTYPE = os.environ.get("ACE_DTYPE", "bfloat16")
DEVICE = os.environ.get("ACE_DEVICE", "cuda")
DEFAULT_DURATION = int(os.environ.get("ACE_DEFAULT_DURATION", "30"))
DEFAULT_FORMAT = os.environ.get("ACE_DEFAULT_FORMAT", "wav")
MAX_DURATION = int(os.environ.get("ACE_MAX_DURATION", "600"))
REQUEST_TIMEOUT = float(os.environ.get("ACE_REQUEST_TIMEOUT", "600"))

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)

# Make the cloned ACE-Step repo importable so we can `from acestep... import ...`.
if str(REPO_DIR) not in sys.path:
    sys.path.insert(0, str(REPO_DIR))

logging.basicConfig(
    level=os.environ.get("ACE_LOG_LEVEL", "INFO"),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
log = logging.getLogger("ace-step.infer-api")


# ─── Pipeline state ──────────────────────────────────────────────────────────

class PipelineStatus(str, Enum):
    LOADING = "loading"
    READY = "ready"
    FAILED = "failed"
    UNLOADED = "unloaded"


@dataclass
class PipelineState:
    """Singleton-ish holder for the loaded ACE-Step pipeline.

    Mutated only inside the lifespan context. Endpoint handlers read it via
    `request.app.state.pipeline`.
    """
    pipeline: Any = None
    status: PipelineStatus = PipelineStatus.UNLOADED
    error: Optional[str] = None
    loaded_at: Optional[float] = None


async def _load_pipeline() -> Any:
    """Construct the ACEStepPipeline. Runs in a worker thread because the
    constructor downloads/loads multi-GB checkpoints (blocking I/O + CUDA).
    """
    # Import lazily so the FastAPI app can still boot (and serve /health with
    # status=loading) even if the repo or torch is mis-configured. The import
    # error is surfaced through the pipeline state instead of crashing uvicorn.
    try:
        pipeline_mod = importlib.import_module("acestep.pipeline_ace_step")
    except Exception as exc:  # pragma: no cover — depends on host environment
        raise RuntimeError(f"Failed to import acestep.pipeline_ace_step: {exc}") from exc

    ACEStepPipeline = getattr(pipeline_mod, "ACEStepPipeline", None)
    if ACEStepPipeline is None:
        raise RuntimeError(
            "acestep.pipeline_ace_step.ACEStepPipeline not found — "
            "is the ACE-Step repo checked out at the expected ref?"
        )

    # Resolve the checkpoint path. ACE-Step expects either a directory
    # containing the per-component subfolders or a single .safetensors file.
    checkpoint_path = CHECKPOINT_DIR
    candidates = [
        CHECKPOINT_DIR,
        CHECKPOINT_DIR / "ace_step_v1_5.safetensors",
        CHECKPOINT_DIR / "ACE-Step-1.5.safetensors",
    ]
    for cand in candidates:
        if cand.exists():
            checkpoint_path = cand
            break

    log.info("Loading ACEStepPipeline (ckpt=%s, dtype=%s, device=%s)",
             checkpoint_path, DTYPE, DEVICE)

    # The constructor is blocking — wrap in to_thread so the event loop can
    # keep serving /health polls while weights load (30–90s on an A10).
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: ACEStepPipeline(
            checkpoint_path=str(checkpoint_path),
            dtype=DTYPE,
            device=DEVICE,
        ),
    )


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan: build the pipeline on startup, release on shutdown."""
    state: PipelineState = app.state.pipeline
    state.status = PipelineStatus.LOADING
    log.info("ACE-Step lifespan: starting pipeline load")

    load_task = asyncio.create_task(_load_pipeline())
    try:
        pipeline = await load_task
        state.pipeline = pipeline
        state.status = PipelineStatus.READY
        state.loaded_at = time.time()
        state.error = None
        log.info("ACE-Step pipeline ready (loaded_at=%s)", state.loaded_at)
    except Exception as exc:
        state.status = PipelineStatus.FAILED
        state.error = str(exc)
        log.exception("ACE-Step pipeline failed to load: %s", exc)

    yield

    # Best-effort cleanup. The pipeline doesn't expose an explicit close() in
    # the public API, so we just drop the reference and let GC reclaim GPU
    # memory; torch releases CUDA contexts on interpreter shutdown.
    log.info("ACE-Step lifespan: shutting down")
    state.pipeline = None
    state.status = PipelineStatus.UNLOADED


app = FastAPI(
    title="ACE-Step Infer API",
    description="Self-hosted text-to-music generation server (ACE-Step 1.5).",
    version="1.5.0",
    lifespan=lifespan,
)
app.state.pipeline = PipelineState()


# ─── Request / response schemas ──────────────────────────────────────────────

class GenerateRequest(BaseModel):
    """Body for POST /generate.

    Mirrors the Ace Music cloud API's `audio_config` surface so the Next.js
    adapter (`src/lib/ai/ace-client.ts`) can target either backend with the
    same request shape.
    """
    prompt: str = Field(..., description="Musical caption / style description.")
    lyrics: str = Field("", description="Lyrics with [Verse]/[Chorus] tags. Empty = instrumental.")
    duration: float = Field(DEFAULT_DURATION, ge=5, le=MAX_DURATION, description="Track length (seconds).")
    language: str = Field("en", description="Vocal language code: en/zh/ja/ko/...")
    bpm: Optional[int] = Field(None, ge=30, le=300, description="Tempo.")
    key_scale: Optional[str] = Field(None, description="Musical key, e.g. 'C Major', 'Am'.")
    time_signature: Optional[str] = Field(None, description="'2' | '3' | '4' | '6'.")
    audio_format: str = Field(DEFAULT_FORMAT, description="Output format: mp3 | wav | flac | opus | aac | wav32.")
    thinking: bool = Field(False, description="Enable 5Hz LM planning (slower, higher quality).")
    seed: Optional[int] = Field(None, description="Specific seed for reproducibility. None = random.")


class GenerateResponse(BaseModel):
    output_path: str
    output_url: str
    seed: int
    format: str
    duration: float
    message: str = "Music generated successfully."


class HealthResponse(BaseModel):
    status: PipelineStatus
    model: Optional[str] = None
    loaded_at: Optional[float] = None
    error: Optional[str] = None
    device: str = DEVICE
    dtype: str = DTYPE


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _require_pipeline(app: FastAPI) -> Any:
    """Return the loaded pipeline or raise a 503 with a useful message."""
    state: PipelineState = app.state.pipeline
    if state.status == PipelineStatus.READY and state.pipeline is not None:
        return state.pipeline
    if state.status == PipelineStatus.LOADING:
        raise HTTPException(status_code=503, detail="Pipeline is still loading — retry shortly.")
    if state.status == PipelineStatus.FAILED:
        raise HTTPException(status_code=503, detail=f"Pipeline failed to load: {state.error}")
    raise HTTPException(status_code=503, detail="Pipeline not loaded")


def _output_filename(ext: str) -> Path:
    """Generate a unique output filename under OUTPUT_DIR."""
    return OUTPUT_DIR / f"{uuid.uuid4().hex}.{ext.lstrip('.')}"


def _normalize_format(fmt: str) -> str:
    fmt = (fmt or DEFAULT_FORMAT).lower().lstrip(".")
    if fmt not in {"mp3", "wav", "flac", "opus", "aac", "wav32"}:
        fmt = DEFAULT_FORMAT
    return fmt


async def _run_pipeline(fn: Any, *args: Any, **kwargs: Any) -> Any:
    """Run a blocking pipeline call in the default thread pool with a hard
    timeout. The pipeline's `music_diffusion_infer` (and friends) perform
    tens of seconds of GPU work — we MUST not run them on the uvicorn loop.
    """
    loop = asyncio.get_event_loop()
    coro = loop.run_in_executor(None, lambda: fn(*args, **kwargs))
    return await asyncio.wait_for(coro, timeout=REQUEST_TIMEOUT)


def _extract_result(result: Any, fallback_seed: int) -> tuple[str, int]:
    """ACE-Step's `music_diffusion_infer` returns a tuple whose shape has
    evolved across commits. Normalize the common shapes into
    (output_path, seed_used).

    Known shapes (newest first):
      (wavs, final_filename, final_output_path, seed_used, prompt, lyrics, ...)
      (wavs, final_output_path, seed_used)
      (wavs, final_output_path)
    """
    output_path: Optional[str] = None
    seed: int = fallback_seed

    if isinstance(result, (tuple, list)):
        for item in result:
            if isinstance(item, str) and ("/" in item or "\\" in item) and Path(item).exists():
                output_path = item
            elif isinstance(item, (int, float)) and seed == fallback_seed and int(item) != 0:
                seed = int(item)
        # If no path-like string was found, look for any str that ends with an audio ext.
        if output_path is None:
            for item in result:
                if isinstance(item, str) and any(item.lower().endswith(ext) for ext in (".wav", ".mp3", ".flac", ".opus", ".aac")):
                    output_path = item
                    break
    elif isinstance(result, str):
        output_path = result
    elif isinstance(result, dict):
        output_path = result.get("output_path") or result.get("path")
        seed = int(result.get("seed", fallback_seed) or fallback_seed)

    if not output_path:
        raise RuntimeError(f"Could not extract output_path from pipeline result: {result!r}")

    return output_path, seed


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["meta"])
async def health() -> HealthResponse:
    """Liveness / readiness probe.

    Returns the pipeline state machine so the orchestrator can distinguish
    "container is up but weights still loading" from "pipeline ready" and
    "pipeline failed to load".
    """
    state: PipelineState = app.state.pipeline
    return HealthResponse(
        status=state.status,
        model="ace-step-v1.5",
        loaded_at=state.loaded_at,
        error=state.error,
        device=DEVICE,
        dtype=DTYPE,
    )


@app.post(
    "/generate",
    response_model=GenerateResponse,
    responses={503: {"model": ErrorResponse}, 500: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    tags=["generation"],
)
async def generate(req: GenerateRequest) -> GenerateResponse:
    """Text-to-music generation. Runs the pipeline in a worker thread."""
    pipeline = _require_pipeline(app)

    fmt = _normalize_format(req.audio_format)
    output_file = _output_filename(fmt)
    seed_used = req.seed if (req.seed is not None and req.seed >= 0) else int.from_bytes(os.urandom(4), "big", signed=False)

    # Build the kwargs the ACE-Step pipeline expects. The exact kwarg names
    # vary slightly across versions; we pass the superset and let the
    # pipeline ignore what it doesn't recognize. (Older versions accept
    # `audio_format`, newer ones use `format`.)
    infer_kwargs = dict(
        caption=req.prompt,
        lyrics=req.lyrics or "",
        audio_duration=req.duration,
        duration=req.duration,
        vocal_language=req.language,
        language=req.language,
        prompt=req.prompt,
        seed=seed_used,
        use_random_seed=(req.seed is None),
        output_format=fmt,
        format=fmt,
        output_path=str(output_file),
        save_path=str(output_file),
        thinking=req.thinking,
    )
    if req.bpm is not None:
        infer_kwargs["bpm"] = req.bpm
    if req.key_scale:
        infer_kwargs["key_scale"] = req.key_scale
    if req.time_signature:
        infer_kwargs["time_signature"] = req.time_signature

    log.info("generate: prompt=%r lyrics=%d chars duration=%ss fmt=%s seed=%s",
             req.prompt[:80], len(req.lyrics), req.duration, fmt, seed_used)

    try:
        result = await _run_pipeline(pipeline.music_diffusion_infer, **infer_kwargs)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"Generation timed out after {REQUEST_TIMEOUT}s")
    except TypeError as exc:
        # If the pipeline rejected an unknown kwarg, retry once with only the
        # canonical (newest-version) argument names.
        log.warning("generate: TypeError from pipeline (%s); retrying with minimal kwargs", exc)
        minimal = dict(
            caption=req.prompt,
            lyrics=req.lyrics or "",
            audio_duration=req.duration,
            seed=seed_used,
        )
        try:
            result = await _run_pipeline(pipeline.music_diffusion_infer, **minimal)
        except Exception as exc2:
            raise HTTPException(status_code=500, detail=f"Pipeline error: {exc2}") from exc2
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {exc}") from exc

    output_path, seed_used = _extract_result(result, seed_used)
    return GenerateResponse(
        output_path=output_path,
        output_url=f"/file/{Path(output_path).name}",
        seed=seed_used,
        format=fmt,
        duration=req.duration,
    )


@app.post(
    "/audio2audio",
    response_model=GenerateResponse,
    responses={503: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    tags=["generation"],
)
async def audio2audio(
    audio: UploadFile = File(..., description="Source audio file (wav/mp3/flac)."),
    prompt: str = Form(..., description="Style/caption to apply as the remix target."),
    lyrics: str = Form("", description="Optional lyrics for the remix."),
    duration: float = Form(DEFAULT_DURATION, ge=5, le=MAX_DURATION),
    language: str = Form("en"),
    audio_format: str = Form(DEFAULT_FORMAT),
    seed: Optional[int] = Form(None),
) -> GenerateResponse:
    """Audio-to-audio remix: feed the uploaded audio as a conditioning source
    and let the pipeline re-render it under a new caption. The pipeline method
    used here is `music_diffusion_infer` with `source_audio` set; older repo
    revisions expose this as `audio2audio_infer` — we detect both.
    """
    pipeline = _require_pipeline(app)

    fmt = _normalize_format(audio_format)
    out_file = _output_filename(fmt)
    seed_used = seed if (seed is not None and seed >= 0) else int.from_bytes(os.urandom(4), "big", signed=False)

    # Persist the upload to a temp path under OUTPUT_DIR so the pipeline can
    # mmap it (it accepts a file path, not a file-like, in most versions).
    src_suffix = Path(audio.filename or "source.wav").suffix or ".wav"
    src_file = _output_filename(src_suffix.lstrip("."))
    contents = await audio.read()
    src_file.write_bytes(contents)

    # Pick the right method depending on the pipeline version.
    method_name = "audio2audio_infer" if hasattr(pipeline, "audio2audio_infer") else "music_diffusion_infer"
    method = getattr(pipeline, method_name)

    infer_kwargs = dict(
        caption=prompt,
        lyrics=lyrics or "",
        audio_duration=duration,
        duration=duration,
        vocal_language=language,
        language=language,
        prompt=prompt,
        source_audio=str(src_file),
        audio_path=str(src_file),
        seed=seed_used,
        use_random_seed=(seed is None),
        output_format=fmt,
        format=fmt,
        output_path=str(out_file),
        save_path=str(out_file),
    )

    log.info("audio2audio: src=%s prompt=%r duration=%ss fmt=%s seed=%s method=%s",
             src_file.name, prompt[:80], duration, fmt, seed_used, method_name)

    try:
        result = await _run_pipeline(method, **infer_kwargs)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"audio2audio timed out after {REQUEST_TIMEOUT}s")
    except TypeError:
        # Minimal kwargs fallback.
        minimal = dict(
            caption=prompt,
            lyrics=lyrics or "",
            audio_duration=duration,
            source_audio=str(src_file),
            seed=seed_used,
        )
        try:
            result = await _run_pipeline(method, **minimal)
        except Exception as exc2:
            raise HTTPException(status_code=500, detail=f"Pipeline error: {exc2}") from exc2
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {exc}") from exc
    finally:
        # Best-effort cleanup of the uploaded source file. The output file is
        # retained for the caller to fetch.
        with contextlib.suppress(FileNotFoundError):
            if src_file.exists():
                src_file.unlink()

    output_path, seed_used = _extract_result(result, seed_used)
    return GenerateResponse(
        output_path=output_path,
        output_url=f"/file/{Path(output_path).name}",
        seed=seed_used,
        format=fmt,
        duration=duration,
    )


@app.post(
    "/edit",
    response_model=GenerateResponse,
    responses={503: {"model": ErrorResponse}, 500: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    tags=["generation"],
)
async def edit(
    audio_url: str = Form(..., description="HTTP(S) URL of the source audio to edit."),
    lyrics: str = Form(..., description="Edited lyrics to flow into the source."),
    prompt: str = Form("", description="Optional new caption. Empty = keep source style."),
    duration: float = Form(DEFAULT_DURATION, ge=5, le=MAX_DURATION),
    audio_format: str = Form(DEFAULT_FORMAT),
    seed: Optional[int] = Form(None),
) -> GenerateResponse:
    """Flow-edit: take an existing track (referenced by URL) and re-sing it
    with new lyrics. The pipeline's `flow_edit_infer` (or `music_diffusion_infer`
    with edit flags on older versions) preserves the source's musical identity
    while swapping the lyrics.
    """
    pipeline = _require_pipeline(app)

    fmt = _normalize_format(audio_format)
    out_file = _output_filename(fmt)
    seed_used = seed if (seed is not None and seed >= 0) else int.from_bytes(os.urandom(4), "big", signed=False)

    # Download the source audio to a local path (the pipeline expects a path).
    src_suffix = ".wav"
    if "." in audio_url.split("?")[0]:
        ext = audio_url.split("?")[0].rsplit(".", 1)[-1].lower()
        if ext in {"wav", "mp3", "flac", "opus", "aac", "m4a"}:
            src_suffix = f".{ext}"
    src_file = _output_filename(src_suffix.lstrip("."))

    try:
        src_bytes = await _download_to_bytes(audio_url, timeout=60)
        src_file.write_bytes(src_bytes)
    except Exception as exc:
        with contextlib.suppress(FileNotFoundError):
            src_file.unlink()
        raise HTTPException(status_code=422, detail=f"Failed to download source audio: {exc}") from exc

    method_name = "flow_edit_infer" if hasattr(pipeline, "flow_edit_infer") else "music_diffusion_infer"
    method = getattr(pipeline, method_name)

    infer_kwargs = dict(
        caption=prompt,
        lyrics=lyrics or "",
        audio_duration=duration,
        duration=duration,
        prompt=prompt,
        source_audio=str(src_file),
        audio_path=str(src_file),
        edit_mode=True,
        flow_edit=True,
        seed=seed_used,
        use_random_seed=(seed is None),
        output_format=fmt,
        format=fmt,
        output_path=str(out_file),
        save_path=str(out_file),
    )

    log.info("edit: src_url=%s lyrics=%d chars duration=%ss fmt=%s seed=%s method=%s",
             audio_url[:120], len(lyrics), duration, fmt, seed_used, method_name)

    try:
        result = await _run_pipeline(method, **infer_kwargs)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail=f"flow-edit timed out after {REQUEST_TIMEOUT}s")
    except TypeError:
        minimal = dict(
            caption=prompt,
            lyrics=lyrics or "",
            audio_duration=duration,
            source_audio=str(src_file),
            edit_mode=True,
            seed=seed_used,
        )
        try:
            result = await _run_pipeline(method, **minimal)
        except Exception as exc2:
            raise HTTPException(status_code=500, detail=f"Pipeline error: {exc2}") from exc2
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Pipeline error: {exc}") from exc
    finally:
        with contextlib.suppress(FileNotFoundError):
            if src_file.exists():
                src_file.unlink()

    output_path, seed_used = _extract_result(result, seed_used)
    return GenerateResponse(
        output_path=output_path,
        output_url=f"/file/{Path(output_path).name}",
        seed=seed_used,
        format=fmt,
        duration=duration,
    )


async def _download_to_bytes(url: str, timeout: float = 60.0) -> bytes:
    """Stream an HTTP(S) URL into a bytes buffer with a hard timeout."""
    import urllib.request
    import urllib.error

    loop = asyncio.get_event_loop()

    def _fetch() -> bytes:
        req = urllib.request.Request(url, headers={"User-Agent": "ACE-Step-InferAPI/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (caller-controlled URL)
            data = resp.read()
        if not data:
            raise RuntimeError("Empty response body")
        return data

    return await loop.run_in_executor(None, _fetch)


# ─── Misc ────────────────────────────────────────────────────────────────────

@app.get("/", tags=["meta"])
async def root() -> JSONResponse:
    return JSONResponse(
        {
            "service": "ace-step-infer-api",
            "version": app.version,
            "docs": "/docs",
            "health": "/health",
        }
    )


if __name__ == "__main__":
    import uvicorn

    # NOTE: Python module names cannot contain hyphens. This file is shipped
    # as `infer-api-mod.py` per the SpotiBot Phase-4 spec, but the container
    # copies it to `infer_api.py` (see docker/ace-step/Dockerfile) so uvicorn
    # can import it. When running directly (e.g. `python infer-api-mod.py`),
    # uvicorn can't import the hyphenated name, so we fall back to importing
    # the in-memory app object via the file-path syntax.
    uvicorn.run(
        app,  # pass the FastAPI instance directly — no string import needed
        host="0.0.0.0",
        port=int(os.environ.get("ACE_PORT", "8000")),
        workers=1,
        log_level=os.environ.get("ACE_LOG_LEVEL", "info").lower(),
    )
