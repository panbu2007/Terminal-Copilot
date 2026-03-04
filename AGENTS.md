# AGENTS.md

This file provides repository-specific instructions for coding agents working in `C:\pb\programs\terminal_copilot`.

## Scope

- Apply these instructions to the whole repository unless a deeper `AGENTS.md` overrides them.
- This project is a FastAPI-served web terminal assistant. The backend serves both API endpoints and the static frontend.

## Project Snapshot

- Backend framework: FastAPI with Pydantic v2.
- Frontend: plain static files with no build step.
- Primary backend entry: `backend/app/main.py`.
- Production entry for hosted environments: `app.py`.
- Frontend entry: `frontend/index.html`.
- Main frontend logic lives in `frontend/static/app.js` and is large (about 2.5k lines), so prefer targeted edits.
- Styles live in `frontend/static/styles.css`.
- Dependencies are minimal and Python-only: `fastapi`, `uvicorn[standard]`, `pydantic`.
- There is no Node.js toolchain in the repo.
- There are currently no automated tests in the project.
- Current UI already includes:
  - execution plan graph rendering with D3 + dagre
  - live SSE plan streaming
  - multi-agent collaboration panel
  - audit report panel with export
  - suggestion confidence badges
  - onboarding demo buttons
  - runbook management modal

## Run And Verify

- Local dev server:
  - `python -m uvicorn backend.app.main:app --reload --port 8000`
- Hosted-style startup:
  - `python app.py`
- Health check:
  - `GET /api/health`

When making changes, prefer the smallest verification that proves the modified path still works:

- Backend-only changes: start uvicorn if needed and hit the relevant API or at minimum `/api/health`.
- Frontend-only changes: verify the page still loads from FastAPI and the edited interaction still works.
- API contract changes: inspect corresponding Pydantic models in `backend/app/models.py` and confirm frontend call sites in `frontend/static/app.js`.

## Deployment Notes

- Current Linux deployment target:
  - host: `root@47.100.65.191`
  - app dir: `/opt/terminal_copilot`
  - service: `terminal-copilot`
  - venv: `/opt/terminal_copilot/.venv`
  - bind: `0.0.0.0:8000`
- Server runtime should use Python `3.11+`. The stock system `python3` may be too old for Pydantic v2.
- Production health check:
  - local on server: `curl http://127.0.0.1:8000/api/health`
  - expected PTY-capable Linux result includes `"pty_supported":"1"`
- Preferred server operations:
  - status: `systemctl status terminal-copilot --no-pager`
  - logs: `journalctl -u terminal-copilot -n 200 --no-pager`
  - restart: `systemctl restart terminal-copilot`
  - deploy update from Windows dev machine: `powershell -ExecutionPolicy Bypass -File scripts/deploy_server.ps1`
  - deploy update from Linux/macOS shell: `bash scripts/deploy_server.sh`
- Keep server-side secrets under `/opt/terminal_copilot/.secrets/`. Never commit `.secrets/` contents.
- If you update deployment-critical code, verify both:
  - HTTP health endpoint
  - PTY WebSocket path `/ws/terminal/{session_id}` on Linux

## Architecture Facts

### Backend

- `backend/app/main.py` is the operational center:
  - serves static files
  - exposes suggestion, execution, plan, session, runbook, and LLM config endpoints
  - owns `_PLAN_STORE`
  - handles `cd` semantics in-process rather than by subprocess
- `backend/app/planner.py` is still rule-first. Add explicit rules there before reaching for broader refactors.
- `backend/app/policy.py` classifies command risk into `safe`, `warn`, or `block`.
- `backend/app/verifier.py` performs post-execution verification for specific scenarios.
- `backend/app/store.py` is an in-memory session/event store.
- `backend/app/plan_executor.py` manages DAG plan execution and active plan state in memory.
- `backend/app/plan_executor.py` also emits SSE events for node lifecycle, stdout chunks, approval waits, and final audit reports.
- `backend/app/rag.py` indexes `docs/runbook/*.md` with cached loading.
- `backend/app/rag_v2.py` exists for vector retrieval support, but do not assume every request path uses it directly.
- `backend/app/local_secrets.py` persists local token/config state under `.secrets/`.

### Agents

- Multi-agent orchestration exists under `backend/app/agents/`.
- `backend/app/agents/orchestrator.py` coordinates:
  - `diag_agent.py`
  - `rag_agent.py`
  - `executor_agent.py`
  - `safety_agent.py`
- `POST /api/suggest/stream` can invoke the orchestrator path when rule suggestions are insufficient.
- Do not describe the project as "single-agent only"; the repository now contains both rule-based and orchestrated agent flows.

### Frontend

- `frontend/static/app.js` is a large vanilla JS file containing terminal UX, suggestion rendering, timeline behavior, plan graph rendering, agent progress streaming, audit rendering, and runbook management.
- There is no frontend build step, bundler, or component framework. Edit source files directly.
- Keep browser-side changes incremental and avoid large rewrites unless explicitly requested.
- `frontend/index.html` already loads D3 and dagre from CDN. Do not add a second graph stack unless explicitly needed.

### Knowledge Base

- Runbook documents live in `docs/runbook/` and are part of runtime retrieval.
- The repo currently has about 52 runbook markdown files.
- `rag.py` uses caching; runbook content changes may require a server restart to take effect.

## Editing Rules

- Prefer surgical changes over broad cleanup.
- Preserve the current architecture unless the task explicitly asks for structural refactoring.
- Keep platform behavior correct. Suggestions should match the backend runtime environment, not the browser OS.
- Be careful with in-memory state assumptions:
  - sessions are not durable across restart
  - plan state is not durable across restart
- When changing execution behavior, review interactions across:
  - `main.py`
  - `planner.py`
  - `policy.py`
  - `verifier.py`
  - `backend/app/executor/*`
- When changing plan-generation or streaming behavior, also inspect the frontend plan graph, node popover, audit panel, and agent/timeline handling in `frontend/static/app.js`.
- When changing models or endpoint payloads, update both backend models and frontend request/response handling in the same task.
- Avoid introducing new dependencies unless the task clearly requires them.
- Avoid adding a frontend build system, framework migration, or large state-management layer unless explicitly requested.

## Common Task Guidance

### Adding A New Suggestion Scenario

- Start in `backend/app/planner.py`.
- Add or refine rule branches first.
- Attach RAG citations only where they improve grounding.
- Check whether `verifier.py` needs a matching verification rule.
- Check whether `policy.py` should classify any new command patterns differently.

### Changing Execution Behavior

- Inspect the selected executor in `backend/app/executor/`.
- Confirm interrupt behavior still makes sense.
- Verify risk gating still happens before execution.

### Changing Agent Orchestration

- Keep emitted progress events compatible with the frontend stream consumer.
- Preserve fallback behavior when LLM/token-dependent paths are unavailable.
- Do not assume the orchestrator is always used; rule-based suggestions still matter.

### Changing Plan Execution UX

- Keep `/api/plan/{id}/stream` events compatible with `PlanStreamClient`.
- Preserve node detail behavior:
  - approval
  - skip
  - live stdout display
- If you add new event types, update both backend emitters and frontend consumers in the same change.

### Editing Runbook Content

- Put new knowledge under `docs/runbook/`.
- Keep filenames stable and markdown-based.
- Remember that retrieval caches may need a restart.

## Deliverable Boundaries

- Repository-contained deliverables are documented in `docs/2026-03-04-final-iteration-deliverables.md`.
- Non-repository competition assets such as final video, poster export, and external article submission content should be treated as separate deliverables, not assumed to exist in code.

## Environment And Secrets

- LLM/provider configuration may come from environment variables or `.secrets/`.
- Never commit secrets from `.secrets/`.
- Be careful when editing token/config flows in `backend/app/local_secrets.py` and the related API endpoints.

## What To Mention In Final Responses

- Summarize the user-visible effect of the change.
- Mention the main files touched.
- State what you verified locally.
- If you could not run verification, say that explicitly.
