# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Terminal Copilot is a Web terminal AI assistant ("智能副驾") — a FastAPI backend that serves both the REST API and the static frontend (xterm.js). Users type commands or natural-language intents into the terminal; the system returns structured suggestions (command / why / risk / rollback / verify) with RAG citations from a local runbook, and optionally executes them.

## Running the Project

**Development (hot-reload, port 8000) — 通过 Windows cmd.exe + conda:**
```cmd
conda activate base && cd /d C:\pb\programs\terminal_copilot && python -m uvicorn backend.app.main:app --reload --port 8000
```

从 WSL 启动（调用 cmd.exe）：
```bash
cmd.exe /c "conda activate base && cd /d C:\\pb\\programs\\terminal_copilot && python -m uvicorn backend.app.main:app --reload --port 8000"
```

**Production / ModelScope Spaces (port 7860):**
```bash
python app.py
```

**Docker:**
```bash
docker build -t terminal-copilot .
docker run --rm -p 7860:7860 terminal-copilot
```

**Install dependencies** (no Node.js needed — frontend is plain static):
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt   # fastapi, uvicorn[standard], pydantic
```

**Health check:** `GET /api/health`

There are no automated tests in this project.

## Architecture

```
Browser (pure static, no build step)
  frontend/index.html      — entry point served by FastAPI
  frontend/static/app.js   — ~2900-line vanilla JS: xterm.js terminal + suggestion cards + timeline
                              + PlanGraphRenderer (D3.js/dagre DAG viz) + PlanStreamClient (SSE)
  frontend/static/styles.css

FastAPI (backend/app/main.py)
  POST /api/suggest        → planner.suggest() + rag.retrieve() + policy.evaluate()
  POST /api/suggest/stream → SSE streaming variant of /api/suggest
  POST /api/plan/generate  → planner.build_execution_plan() → ExecutionPlan JSON
  POST /api/plan/{id}/execute        → plan_executor.start_plan_execution() (BFS DAG, background thread)
  GET  /api/plan/{id}/stream         → SSE stream of node_start/node_done/need_approval/plan_done events
  POST /api/plan/{id}/node/{n}/approve → unblock a node awaiting human approval
  POST /api/plan/{id}/cancel         → cancel a running plan
  POST /api/execute        → policy.evaluate() + executor.run() + verifier.maybe_verify()
  POST /api/interrupt      → executor.interrupt()
  GET  /api/sessions/*     → STORE (in-memory session/step/event log)
  GET  /api/llm/status     → LLM config introspection
  POST /api/llm/token|config|test  → token management + connectivity test
  POST /api/executor/mode  → switch simulate ↔ local at runtime
```

### Key Backend Modules

| File | Role |
|------|------|
| `backend/app/planner.py` | Rule engine (hardcoded if/else for ~3 demo scenarios) with LLM fallback when rules produce no suggestions |
| `backend/app/rag.py` | TF keyword retrieval over `docs/runbook/*.md`; uses `lru_cache` to load docs once; no embeddings |
| `backend/app/policy.py` | Regex-based command risk classification → `block` / `warn` / `safe` |
| `backend/app/verifier.py` | Pattern-matching post-execution verification (covers ~3 scenarios) |
| `backend/app/store.py` | In-memory `STORE`: sessions, steps (planned/executed/verified), events |
| `backend/app/models.py` | Pydantic v2 models for all request/response types |
| `backend/app/local_secrets.py` | Read/write token to `.secrets/modelscope_access_token.txt` (gitignored) |
| `backend/app/executor/local_executor.py` | Real subprocess execution; tracks PID per session for interrupt |
| `backend/app/executor/simulate_executor.py` | Canned outputs for safe demo mode |
| `backend/app/llm/modelscope_client.py` | ModelScope OpenAI-compatible API (single-turn prompt → JSON parse) |
| `backend/app/plan_executor.py` | BFS DAG execution engine; `_ACTIVE_PLANS` dict; SSE event queue per plan |
| `backend/app/grounding.py` | Anti-hallucination: rules-based confidence scoring (high / medium / low) |
| `backend/app/rag_v2.py` | Hybrid vector + keyword RAG using ModelScope BAAI/bge-small-zh-v1.5 embeddings |
| `backend/app/agents/orchestrator.py` | Multi-agent orchestrator; coordinates rag_agent, diag_agent, safety_agent |
| `backend/app/agents/rag_agent.py` | Agent wrapper around RAG retrieval with progress events |
| `backend/app/agents/diag_agent.py` | Diagnosis agent: identifies error type from terminal context |
| `backend/app/agents/safety_agent.py` | Pre-audits execution plans; produces AuditReport |
| `backend/app/agents/executor_agent.py` | Wraps plan_executor for agent-driven execution |
| `backend/app/agents/base.py` / `tools.py` | Base agent class + function-calling tool definitions |

### Platform Handling

`/api/suggest` receives the client's detected OS but **overrides it** with the backend's actual OS (`_runtime_platform()`). This ensures suggestions match the executor environment, not the browser's OS. The original client platform is preserved in `req.extra["client_platform"]`.

### RAG Knowledge Base

`docs/runbook/` contains ~52 curated Markdown files indexed by `rag.py`. Adding or editing files there immediately affects citations (docs are loaded once via `lru_cache`; restart required to pick up changes). Files can declare a `关键词:` section for higher-weight keyword matching.

## Key Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MODELSCOPE_ACCESS_TOKEN` | — | LLM token (highest priority) |
| `TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN` | — | LLM token (fallback) |
| `TERMINAL_COPILOT_MODELSCOPE_MODEL` | `moonshotai/Kimi-K2.5` | LLM model |
| `TERMINAL_COPILOT_LLM_ENABLED` | `auto` | `auto`=token presence, `true`/`false` to force |
| `TERMINAL_COPILOT_EXECUTOR` | `local` | `local` or `simulate` |
| `TERMINAL_COPILOT_LOCAL_ROOT` | repo root | Restricts `cd` and execution to this directory |
| `TERMINAL_COPILOT_RAG_TOPK` | `10` | Candidate docs before rerank |
| `TERMINAL_COPILOT_MAX_SUGGESTIONS` | `6` | Max suggestions returned per request |
| `TERMINAL_COPILOT_PERSIST_CLIENT_STATE` | `auto` | `auto` persists locally, not in containers |
| `PORT` | `7860` | Listened to by `app.py` (ModelScope Spaces) |
| `TERMINAL_COPILOT_BUILD_ID` | — | Version fingerprint in startup logs |

## Important Conventions

- **Frontend has no build step** — edit `frontend/static/app.js` and `styles.css` directly.
- **Planner is rule-first, LLM-fallback**: LLM is only called when no rule matched. Adding new scenarios means adding `if/elif` blocks in `planner.py:suggest()`.
- **`cd` is handled in-process** by `main.py:_handle_cd()`, not via subprocess, to maintain per-session `cwd`.
- **Session state is in-memory only** — restarting the server clears all sessions.
- **Token is written to `.secrets/modelscope_access_token.txt`** when set via the UI; this path is gitignored.
- **Caching in rag.py**: `_load_docs()` is `lru_cache`-decorated — changes to `docs/runbook/` files require a server restart.
- The `(auto)` sentinel command in a `CommandSuggestion` means the card is informational only and cannot be executed.
- **Two separate in-memory stores**: `STORE` (store.py) holds sessions/steps/events. `_PLAN_STORE` (main.py module-level) maps `plan_id → ExecutionPlan`; `_ACTIVE_PLANS` (plan_executor.py) maps `plan_id → PlanExecutionState`. All three are cleared on server restart.
