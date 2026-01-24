# Minimal runtime image for Terminal Copilot (FastAPI serves static frontend)
# Use ModelScope registry base image for faster/more reliable builds in Spaces.
FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.10

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /work

# System deps (kept minimal). ca-certificates helps HTTPS for ModelScope.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY backend/requirements.txt /work/backend/requirements.txt
RUN pip install --no-cache-dir -r /work/backend/requirements.txt

# Copy only what the server needs
COPY backend /work/backend
COPY frontend /work/frontend
COPY app.py /work/app.py
COPY README.md /work/README.md

# Default: run real commands inside the container.
# UI can still switch back to simulate via /api/executor/mode.
ENV TERMINAL_COPILOT_EXECUTOR=local \
    TERMINAL_COPILOT_ALLOW_LOCAL=1 \
    TERMINAL_COPILOT_LOCAL_ROOT=/work

# ModelScope Spaces commonly use PORT=7860; keep compatible.
EXPOSE 7860

# app.py binds to 0.0.0.0:${PORT:-7860}
CMD ["python", "-u", "app.py"]
