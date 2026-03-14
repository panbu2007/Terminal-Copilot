# Minimal runtime image for Terminal Copilot (FastAPI serves static frontend)
# Use ModelScope registry base image for faster/more reliable builds in Spaces.
FROM modelscope-registry.cn-beijing.cr.aliyuncs.com/modelscope-repo/python:3.10

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /work

# System deps (kept minimal). ca-certificates helps HTTPS for ModelScope.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates procps net-tools iproute2 curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY backend/requirements.txt /work/backend/requirements.txt
RUN pip install --no-cache-dir -r /work/backend/requirements.txt

# Copy only what the server needs
COPY backend /work/backend
COPY frontend /work/frontend
COPY app.py /work/app.py
COPY README.md /work/README.md
COPY docs /work/docs

# ── /home/ops: simulated ops workstation ──────────────────────────────────
RUN mkdir -p /home/ops/workspace /home/ops/logs /home/ops/configs \
    && mkdir -p /work/docs/runbook/custom \
    && ln -s /work/docs/runbook /home/ops/runbooks \
    && echo '{"registry-mirrors":["https://mirror.ccs.tencentyun.com","https://docker.m.daocloud.io"]}' \
       > /home/ops/configs/daemon.json \
    && printf '%s\n' \
       'server {' \
       '    listen 80;' \
       '    server_name localhost;' \
       '    location / {' \
       '        proxy_pass http://127.0.0.1:7860;' \
       '    }' \
       '}' \
       > /home/ops/configs/nginx.conf \
    && printf '%s\n' \
       "$(date '+%Y-%m-%d %H:%M:%S') [INFO] terminal-copilot service started" \
       "$(date '+%Y-%m-%d %H:%M:%S') [INFO] health check OK" \
       "$(date '+%Y-%m-%d %H:%M:%S') [WARN] LLM token not configured, rule-based fallback enabled" \
       > /home/ops/logs/app.log \
    && printf 'from fastapi import FastAPI\n\napp = FastAPI(title="demo-service")\n\n@app.get("/")\ndef root():\n    return {"status": "running", "service": "demo"}\n\n@app.get("/health")\ndef health():\n    return {"status": "ok"}\n' \
       > /home/ops/workspace/app.py \
    && printf '%s\n' 'fastapi>=0.110' 'uvicorn>=0.27' > /home/ops/workspace/requirements.txt

# Default: run real commands inside the container.
# UI can still switch back to simulate via /api/executor/mode.
# LOCAL_ROOT = /home/ops (ops workstation, not the project source)
ENV TERMINAL_COPILOT_EXECUTOR=local \
    TERMINAL_COPILOT_ALLOW_LOCAL=1 \
    TERMINAL_COPILOT_LOCAL_ROOT=/home/ops

# ModelScope Spaces commonly use PORT=7860; keep compatible.
EXPOSE 7860

# app.py binds to 0.0.0.0:${PORT:-7860}
CMD ["python", "-u", "app.py"]
