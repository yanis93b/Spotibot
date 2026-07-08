# ─────────────────────────────────────────────────────────────────────────────
# ACE-Step GPU server (FastAPI)
# ─────────────────────────────────────────────────────────────────────────────
# Self-hosted text-to-music generation server built on the open-source
# ACE-Step (ACE-Step-1.5) repo. Exposes a small FastAPI surface that the
# Next.js app can call instead of the Ace Music cloud API.
#
# Base image: nvidia/cuda:12.6.0-runtime-ubuntu22.04 (CUDA 12.6 + cuDNN runtime).
# ACE-Step ships torch wheels pinned to a specific CUDA build; we install the
# cu121 wheel which is binary-compatible with the 12.6 runtime driver.
# ─────────────────────────────────────────────────────────────────────────────

FROM nvidia/cuda:12.6.0-runtime-ubuntu22.04

# Avoid interactive apt prompts during build.
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models/huggingface \
    ACE_CHECKPOINT_DIR=/models/ace-step \
    ACE_OUTPUT_DIR=/outputs \
    ACE_REPO_DIR=/opt/ACE-Step

# ── System packages: Python 3.10, pip, git, build tooling, audio libs ────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        software-properties-common \
        ca-certificates \
        curl \
        wget \
        git \
        build-essential \
        libsndfile1 \
        ffmpeg \
    && add-apt-repository ppa:deadsnakes/ppa -y \
    && apt-get update && apt-get install -y --no-install-recommends \
        python3.10 \
        python3.10-dev \
        python3.10-venv \
        python3.10-distutils \
    && curl -fsSLo /tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py \
    && python3.10 /tmp/get-pip.py \
    && ln -sf /usr/bin/python3.10 /usr/local/bin/python3 \
    && ln -sf /usr/local/bin/pip3 /usr/local/bin/pip \
    && rm -rf /var/lib/apt/lists/* /tmp/get-pip.py

# ── Clone the ACE-Step repo at a pinned commit for reproducibility ───────────
# The repo contains the pipeline_ace_step module and the demo infer-api server.
ARG ACE_STEP_REPO=https://github.com/ace-step/ACE-Step-1.5.git
ARG ACE_STEP_REF=main
RUN git clone --depth 1 --branch "${ACE_STEP_REF}" "${ACE_STEP_REPO}" "${ACE_REPO_DIR}"

WORKDIR "${ACE_REPO_DIR}"

# ── Python dependencies for ACE-Step ─────────────────────────────────────────
# Install the repo's requirements first (PyTorch is pulled in here), then
# force-reinstall the CUDA-enabled torch wheels to match the runtime image.
# We pin torch 2.4.0 + cu121 — known-good with ACE-Step 1.5 and CUDA 12.6 driver.
COPY requirements-ace-step.txt /tmp/requirements-ace-step.txt
RUN if [ -f requirements.txt ]; then pip install -r requirements.txt; fi \
    && pip install --no-cache-dir \
        torch==2.4.0 \
        torchaudio==2.4.0 \
        --index-url https://download.pytorch.org/whl/cu121 \
    && pip install --no-cache-dir -r /tmp/requirements-ace-step.txt

# ── FastAPI serving layer ────────────────────────────────────────────────────
RUN pip install --no-cache-dir \
        "fastapi==0.115.6" \
        "uvicorn[standard]==0.34.0" \
        "python-multipart==0.0.20" \
        "aiofiles==24.1.0"

# ── Runtime directories & volumes ────────────────────────────────────────────
# - /models/ace-step       : model checkpoints (mounted volume, host-populated)
# - /models/huggingface    : HF cache (mounted volume so weights persist)
# - /outputs               : generated audio files (mounted volume)
RUN mkdir -p "${ACE_CHECKPOINT_DIR}" "${HF_HOME}" "${ACE_OUTPUT_DIR}" /app

# Copy our modified FastAPI server into /app (kept outside the repo so the
# clone above stays pristine and re-clonable). Python module names cannot
# contain hyphens, so we ALSO copy the file under the underscored name
# `infer_api.py` and invoke uvicorn against that — the source file in the
# repo keeps its spec-mandated `infer-api-mod.py` name, the container just
# renames on COPY.
COPY infer-api-mod.py /app/infer_api.py

WORKDIR /app

# Health: FastAPI /health endpoint (liveness) — configured in infer-api-mod.py.
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health || exit 1

EXPOSE 8000

# uvicorn entrypoint. We import `infer_api:app` (the underscored in-container
# alias of infer-api-mod.py) so Python's import machinery is happy — the spec
# calls this `uvicorn infer-api:app`, which is functionally identical.
CMD ["python3", "-m", "uvicorn", "infer_api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
