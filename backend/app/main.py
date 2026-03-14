from __future__ import annotations

import logging
import os
import time
import hashlib
import platform as _platform
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import shlex
import threading

import asyncio
import json
from queue import Empty, Queue
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request, WebSocket
from pydantic import BaseModel
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .executor import get_executor, get_executor_mode, set_executor_mode
from .executor.base import ExecResult
from .models import (
    CommandSuggestion,
    ExecutionPlan,
    ExecuteRequest,
    ExecuteResponse,
    ExecutorModeRequest,
    ExecutorStatusResponse,
    EventsResponse,
    ExportResponse,
    InterruptRequest,
    InterruptResponse,
    LlmConfigRequest,
    LlmStatusResponse,
    LlmTestRequest,
    LlmTestResponse,
    LlmTokenRequest,
    PlanGenerateRequest,
    PlanGenerateResponse,
    RiskLevel,
    RunbookListResponse,
    RunbookUpsertRequest,
    SessionResponse,
    SuggestRequest,
    SuggestResponse,
)
from .llm.modelscope_client import PROVIDERS, normalize_provider, resolve_llm_config
from .local_secrets import (
    write_llm_base_url,
    write_llm_model,
    write_llm_provider,
    write_llm_token,
)
from .plan_executor import (
    approve_node,
    cancel_plan,
    get_plan_state,
    skip_node,
    start_plan_execution,
)
from .planner import build_execution_plan, suggest
from .policy import evaluate
from .pty_manager import PTY_IDLE_TIMEOUT_SECONDS, cleanup_idle_sessions, pty_supported
from .rag import refresh_docs_cache
from .rag_v2 import refresh_vector_cache
from .store import STORE
from .verifier import maybe_verify
from .ws_terminal import handle_terminal_ws


APP_ROOT = Path(__file__).resolve().parent
REPO_ROOT = APP_ROOT.parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
FRONTEND_STATIC_DIR = FRONTEND_DIR / "static"


def _runtime_platform() -> str:
    """Return platform of the machine running this backend.

    Suggestions should match the executor environment (backend host), not the browser OS.
    """

    s = (_platform.system() or "").strip().lower()
    if "windows" in s:
        return "windows"
    if s in {"darwin", "mac", "macos"}:
        return "mac"
    return "linux"


app = FastAPI(title="Terminal Copilot", version="0.1.0")

logger = logging.getLogger("terminal_copilot")

_PLAN_STORE: dict[str, ExecutionPlan] = {}
RUNBOOK_DIR = REPO_ROOT / "docs" / "runbook"
CUSTOM_RUNBOOK_DIR = RUNBOOK_DIR / "custom"
_ENHANCE_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="suggest-enhance")

_STARTED_AT_TS = time.time()


def _setup_logging() -> None:
    """Initialize app logger level from env.

    Keep formatting/config delegated to uvicorn handlers; only tune levels here.
    """
    level_name = (os.getenv("TERMINAL_COPILOT_LOG_LEVEL", "INFO") or "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logger.setLevel(level)
    # Keep sibling loggers aligned for richer agent/debug output.
    for name in (
        "terminal_copilot.agent",
        "terminal_copilot.tools",
        "terminal_copilot.orchestrator",
        "terminal_copilot.executor_agent",
        "terminal_copilot.llm",
    ):
        logging.getLogger(name).setLevel(level)


_setup_logging()


def _safe_read_git_head(repo_root: Path) -> str:
    """Best-effort: return a short git sha if .git is available (dev), else empty."""
    try:
        head = repo_root / ".git" / "HEAD"
        if not head.exists():
            return ""
        ref = head.read_text(encoding="utf-8", errors="ignore").strip()
        if ref.startswith("ref:"):
            ref_path = ref.split(":", 1)[1].strip()
            p = repo_root / ".git" / ref_path
            if p.exists():
                return p.read_text(encoding="utf-8", errors="ignore").strip()[:12]
            return ""
        # detached HEAD
        return ref[:12]
    except Exception:
        return ""


def _file_fingerprint(p: Path) -> str:
    """Stable-ish fingerprint for logs: sha256(whole file)[:12] + size + mtime."""
    try:
        if not p.exists() or not p.is_file():
            return "missing"
        data = p.read_bytes()
        h = hashlib.sha256(data).hexdigest()[:12]
        st = p.stat()
        return f"sha256={h} size={st.st_size} mtime={int(st.st_mtime)}"
    except Exception as e:
        return f"error:{type(e).__name__}"


def _runtime_build_id() -> str:
    # Prefer an explicit build id if the platform injects it.
    b = (os.getenv("TERMINAL_COPILOT_BUILD_ID") or os.getenv("GIT_SHA") or "").strip()
    if b:
        return b[:20]
    sha = _safe_read_git_head(REPO_ROOT)
    if sha:
        return sha
    # Fall back to asset fingerprints (works in Docker images without .git).
    return (
        _file_fingerprint(FRONTEND_STATIC_DIR / "app.js")
        .split(" ", 1)[0]
        .replace("sha256=", "")
    )


def _llm_token_configured() -> bool:
    return resolve_llm_config(require_token=True) is not None


def _llm_enabled() -> bool:
    enabled_flag = os.getenv("TERMINAL_COPILOT_LLM_ENABLED", "auto").strip().lower()
    if enabled_flag == "auto":
        return _llm_token_configured()
    return enabled_flag in {"1", "true", "yes", "on"}


def _clip_for_log(text: str, limit: int = 200) -> str:
    s = (text or "").replace("\n", "\\n").replace("\r", "\\r").strip()
    if len(s) <= limit:
        return s
    return s[:limit] + "...(truncated)"


def _apply_policy_hints(suggestions: list[CommandSuggestion]) -> None:
    for suggestion in suggestions:
        if not suggestion.command or suggestion.command == "(auto)":
            continue
        decision = evaluate(suggestion.command)
        if decision.level == "block":
            suggestion.risk_level = RiskLevel.block
            suggestion.requires_confirmation = False
            suggestion.explanation = (
                f"{suggestion.explanation}\nSafety notice: {decision.reason}"
            ).strip()
        elif decision.level == "warn":
            suggestion.risk_level = RiskLevel.warn
            suggestion.requires_confirmation = True
            suggestion.explanation = (
                f"{suggestion.explanation}\nSafety notice: {decision.reason}"
            ).strip()


def _run_suggestion_enhancement(
    intent: str,
    suggestions: list[CommandSuggestion],
    event_queue: Queue,
) -> None:
    from .agents.rag_agent import RAGAgent
    from .grounding import async_alignment_check

    rag_agent = RAGAgent()
    updated = [item.model_copy(deep=True) for item in suggestions]
    event_queue.put(
        {
            "type": "agent_progress",
            "agent": "rag",
            "status": "start",
            "message": "Enhancing citations for rule suggestions...",
        }
    )
    event_queue.put(
        {
            "type": "agent_progress",
            "agent": "safety",
            "status": "start",
            "message": "Checking semantic alignment...",
        }
    )

    pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="suggest-augment")
    rag_future = pool.submit(rag_agent.retrieve, intent, 3)
    align_future = pool.submit(async_alignment_check, intent, updated)
    try:
        try:
            citations = list(rag_future.result(timeout=10) or [])
            event_queue.put(
                {
                    "type": "agent_progress",
                    "agent": "rag",
                    "status": "done",
                    "message": f"Retrieved {len(citations)} extra citation(s).",
                }
            )
        except Exception:
            citations = []
            event_queue.put(
                {
                    "type": "agent_progress",
                    "agent": "rag",
                    "status": "error",
                    "message": "Citation enhancement unavailable.",
                }
            )

        try:
            updated = list(align_future.result(timeout=10) or updated)
            matched = sum(1 for item in updated if item.alignment)
            event_queue.put(
                {
                    "type": "agent_progress",
                    "agent": "safety",
                    "status": "done",
                    "message": f"Alignment checked for {matched} suggestion(s).",
                }
            )
        except Exception:
            event_queue.put(
                {
                    "type": "agent_progress",
                    "agent": "safety",
                    "status": "error",
                    "message": "Alignment check unavailable.",
                }
            )
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    for suggestion in updated:
        if not suggestion.alignment:
            continue
        event_queue.put(
            {
                "type": "alignment_update",
                "suggestion_id": suggestion.id,
                "alignment": suggestion.alignment,
                "alignment_reason": suggestion.alignment_reason,
            }
        )

    for suggestion in suggestions:
        existing = {
            (citation.title, citation.snippet, citation.source)
            for citation in (suggestion.citations or [])
        }
        extra = []
        for citation in citations:
            key = (
                getattr(citation, "title", ""),
                getattr(citation, "snippet", ""),
                getattr(citation, "source", ""),
            )
            if key in existing:
                continue
            existing.add(key)
            extra.append(citation)
            if len(extra) >= 2:
                break
        if not extra:
            continue
        event_queue.put(
            {
                "type": "agent_enhancement",
                "suggestion_id": suggestion.id,
                "citations": [citation.model_dump() for citation in extra],
                "confidence": suggestion.confidence,
                "confidence_label": suggestion.confidence_label,
            }
        )


def _refresh_knowledge_caches() -> None:
    refresh_docs_cache()
    refresh_vector_cache()


def _safe_runbook_name(filename: str) -> str:
    name = Path(str(filename or "").strip()).name
    if not name:
        raise HTTPException(status_code=400, detail="empty_filename")
    if not name.lower().endswith(".md"):
        raise HTTPException(status_code=400, detail="runbook_must_be_markdown")
    if any(ch in name for ch in '<>:"/\\|?*'):
        raise HTTPException(status_code=400, detail="invalid_filename")
    return name


def _extract_markdown_title(text: str, fallback: str) -> str:
    for raw in (text or "").splitlines():
        line = raw.strip()
        if line.startswith("#"):
            return line.lstrip("#").strip() or fallback
    return fallback


@app.middleware("http")
async def _request_log_middleware(request: Request, call_next):
    # Focus on API observability; static file chatter is less useful for backend debugging.
    should_log = request.url.path.startswith("/api/")
    req_id = f"{int(time.time() * 1000) % 1000000:06d}"
    start = time.perf_counter()

    if should_log:
        logger.info(
            "[req:%s] --> %s %s from=%s ua=%s",
            req_id,
            request.method,
            request.url.path,
            getattr(request.client, "host", "-"),
            _clip_for_log(request.headers.get("user-agent", ""), 120),
        )

    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.exception(
            "[req:%s] !! %s %s failed in %sms",
            req_id,
            request.method,
            request.url.path,
            elapsed_ms,
        )
        raise

    if should_log:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.info(
            "[req:%s] <-- %s %s status=%s cost=%sms",
            req_id,
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
    return response


@app.on_event("startup")
def _startup_llm_guide() -> None:
    # Startup fingerprint: helps verify the actual running version in hosted logs.
    try:
        build_id = _runtime_build_id()
        logger.warning(
            "Terminal Copilot startup: build_id=%s started_at=%s pid=%s port=%s",
            build_id,
            time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(_STARTED_AT_TS)),
            os.getpid(),
            os.getenv("PORT", ""),
        )
        logger.warning(
            "Frontend assets: index.html=%s app.js=%s styles.css=%s",
            _file_fingerprint(FRONTEND_DIR / "index.html"),
            _file_fingerprint(FRONTEND_STATIC_DIR / "app.js"),
            _file_fingerprint(FRONTEND_STATIC_DIR / "styles.css"),
        )
    except Exception:
        # Never block startup due to logging.
        pass

    if _llm_token_configured():
        return
    logger.warning(
        "LLM token not configured. Configure provider+token in LLM settings, "
        "or set TERMINAL_COPILOT_LLM_PROVIDER / TERMINAL_COPILOT_LLM_ACCESS_TOKEN."
    )
    logger.warning("local secret path: .secrets/llm_access_token.txt (gitignored)")


@app.on_event("startup")
def _startup_pty_cleanup() -> None:
    def _loop() -> None:
        while True:
            time.sleep(300)
            try:
                cleanup_idle_sessions(PTY_IDLE_TIMEOUT_SECONDS)
            except Exception:
                logger.exception("pty cleanup loop failed")

    threading.Thread(target=_loop, daemon=True, name="pty-cleanup").start()


def _is_running_in_container() -> bool:
    """Best-effort container detection (for hosted Spaces behavior)."""
    try:
        if Path("/.dockerenv").exists():
            return True
    except Exception:
        pass

    try:
        p = Path("/proc/1/cgroup")
        if p.exists():
            t = p.read_text(encoding="utf-8", errors="ignore")
            if any(k in t for k in ("docker", "kubepods", "containerd", "podman")):
                return True
    except Exception:
        pass

    return False


def _persist_client_state() -> bool:
    """Whether the frontend should persist token/session across refresh.

    Default:
      - Local/dev: True
      - Container/Spaces: False (avoid cross-run interference in public demos)

    Override with env: TERMINAL_COPILOT_PERSIST_CLIENT_STATE=1/0
    """

    # Default:
    # - Local/dev: persist (1)
    # - Container/Spaces: do not persist (0)
    # Override with env: TERMINAL_COPILOT_PERSIST_CLIENT_STATE=1/0
    flag = os.getenv("TERMINAL_COPILOT_PERSIST_CLIENT_STATE", "auto").strip().lower()
    if flag in {"1", "true", "yes", "on"}:
        return True
    if flag in {"0", "false", "no", "off"}:
        return False
    return not _is_running_in_container()


@app.get("/api/health")
def health() -> dict[str, str]:
    ex = get_executor()
    local_root = Path(os.getenv("TERMINAL_COPILOT_LOCAL_ROOT", str(REPO_ROOT))).resolve()
    demo_workspace = local_root / "workspace"
    return {
        "status": "ok",
        "executor": ex.name,
        "persist_client_state": "1" if _persist_client_state() else "0",
        "pty_supported": "1" if pty_supported() else "0",
        "local_root": str(local_root),
        "demo_workspace_available": "1" if demo_workspace.is_dir() else "0",
    }


@app.websocket("/ws/terminal/{session_id}")
async def ws_terminal(session_id: str, ws: WebSocket) -> None:
    if session_id == "new":
        session = STORE.get_or_create(None)
    else:
        try:
            session = STORE.get_or_create(UUID(session_id))
        except ValueError:
            await ws.close(code=1008, reason="invalid_session_id")
            return

    local_root = Path(os.getenv("TERMINAL_COPILOT_LOCAL_ROOT", str(REPO_ROOT))).resolve()
    cwd = session.cwd or str(local_root)
    await handle_terminal_ws(ws, str(session.id), cwd)


@app.get("/api/executor/status", response_model=ExecutorStatusResponse)
def api_executor_status() -> ExecutorStatusResponse:
    mode = get_executor_mode()
    if mode not in {"simulate", "local"}:
        mode = "local"

    return ExecutorStatusResponse(
        mode=mode,  # type: ignore[arg-type]
        available=["simulate", "local"],
        allow_local=True,
    )


@app.post("/api/executor/mode", response_model=ExecutorStatusResponse)
def api_executor_set_mode(req: ExecutorModeRequest) -> ExecutorStatusResponse:
    mode = (req.mode or "simulate").lower().strip()
    if mode not in {"simulate", "local"}:
        raise HTTPException(status_code=400, detail="invalid_executor_mode")

    set_executor_mode(mode)
    # Return updated status
    return api_executor_status()


@app.post("/api/sessions/new", response_model=SessionResponse)
def api_new_session() -> SessionResponse:
    session = STORE.get_or_create(None)
    # Initialize cwd early so the frontend can show it in the prompt.
    local_root = Path(
        os.getenv("TERMINAL_COPILOT_LOCAL_ROOT", str(REPO_ROOT))
    ).resolve()
    if not session.cwd:
        session.cwd = str(local_root)
    return SessionResponse(
        session_id=session.id,
        created_at=session.created_at.isoformat(),
        cwd=session.cwd,
        steps=STORE.to_dict_steps(session),
    )


@app.get("/api/sessions/new", response_model=SessionResponse)
def api_new_session_get() -> SessionResponse:
    return api_new_session()


@app.get("/api/sessions/{session_id}", response_model=SessionResponse)
def api_get_session(session_id: str) -> SessionResponse:
    from uuid import UUID

    try:
        sid = UUID(session_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="invalid_session_id") from e

    session = STORE.get(sid)
    if session is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    return SessionResponse(
        session_id=session.id,
        created_at=session.created_at.isoformat(),
        cwd=session.cwd,
        steps=STORE.to_dict_steps(session),
    )


@app.get("/api/sessions/{session_id}/events", response_model=EventsResponse)
def api_get_events(session_id: str) -> EventsResponse:
    from uuid import UUID

    try:
        sid = UUID(session_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="invalid_session_id") from e

    session = STORE.get(sid)
    if session is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    return EventsResponse(session_id=session.id, events=STORE.to_dict_events(session))


@app.get("/api/sessions/{session_id}/export", response_model=ExportResponse)
def api_export(session_id: str) -> ExportResponse:
    from uuid import UUID

    try:
        sid = UUID(session_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="invalid_session_id") from e

    session = STORE.get(sid)
    if session is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    return ExportResponse(
        session_id=session.id,
        created_at=session.created_at.isoformat(),
        cwd=session.cwd,
        steps=STORE.to_dict_steps(session),
        events=STORE.to_dict_events(session),
    )


@app.post("/api/suggest", response_model=SuggestResponse)
def api_suggest(req: SuggestRequest) -> SuggestResponse:
    t0 = time.perf_counter()
    logger.info(
        "api_suggest start session=%s platform=%s exit_code=%s last=%s",
        req.session_id,
        req.platform,
        req.last_exit_code,
        _clip_for_log(req.last_command or "", 160),
    )
    session = STORE.get_or_create(req.session_id)

    server_platform = _runtime_platform()
    if req.platform != server_platform:
        try:
            req.extra = dict(req.extra or {})
            if req.platform:
                req.extra.setdefault("client_platform", req.platform)
            req.extra.setdefault("server_platform", server_platform)
        except Exception:
            pass
        req.platform = server_platform  # type: ignore[assignment]

    suggestions = suggest(req)
    _apply_policy_hints(suggestions)

    # Observability: record whether LLM suggestions are present / error fallback happened
    if any(("llm" in (s.tags or [])) for s in suggestions):
        STORE.add_event(
            session,
            kind="llm_suggest",
            payload={
                "has_error": str(any(("error" in (s.tags or [])) for s in suggestions)),
                "count": str(sum(1 for s in suggestions if "llm" in (s.tags or []))),
            },
        )

    STORE.add_event(
        session,
        kind="suggest",
        payload={
            "last_command": req.last_command,
            "platform": str(req.platform or ""),
            "count": str(len(suggestions)),
        },
    )
    STORE.add_planned_steps(
        session,
        items=[
            (s.title, s.command)
            for s in suggestions
            if s.command and s.command != "(auto)"
        ],
    )
    res = SuggestResponse(
        session_id=session.id,
        suggestions=suggestions,
        steps=STORE.to_dict_steps(session),
    )
    logger.info(
        "api_suggest done session=%s suggestions=%s cost=%sms",
        session.id,
        len(suggestions),
        int((time.perf_counter() - t0) * 1000),
    )
    return res


@app.post("/api/plan/generate", response_model=PlanGenerateResponse)
def api_plan_generate(req: PlanGenerateRequest) -> PlanGenerateResponse:
    session = STORE.get_or_create(req.session_id)

    server_platform = _runtime_platform()
    if req.platform != server_platform:
        req.platform = server_platform  # type: ignore[assignment]

    from .agents.executor_agent import ExecutorAgent
    from .agents.safety_agent import SafetyAgent

    executor_agent = ExecutorAgent()
    safety_agent = SafetyAgent()

    if req.suggestions:
        plan = build_execution_plan(intent=req.intent, suggestions=req.suggestions)
    elif req.intent and _llm_enabled():
        plan = executor_agent.generate_dag(req.intent, platform=req.platform)
        if plan is None:
            plan = build_execution_plan(intent=req.intent, suggestions=[])
    else:
        plan = build_execution_plan(intent=req.intent, suggestions=[])

    plan.pre_audit = safety_agent.pre_audit(plan, timeout=8.0)
    _PLAN_STORE[plan.id] = plan
    STORE.add_event(
        session,
        kind="plan_generate",
        payload={
            "intent": req.intent[:200],
            "nodes": str(len(plan.nodes)),
            "edges": str(len(plan.edges)),
        },
    )
    return PlanGenerateResponse(session_id=session.id, plan=plan)


@app.post("/api/suggest/stream")
async def api_suggest_stream(req: SuggestRequest) -> StreamingResponse:
    """SSE 娴佸紡绔偣锛氬疄鏃舵帹閫?Multi-Agent 鍗忎綔杩涘害锛岀劧鍚庡彂閫佹渶缁堝缓璁€?

    浜嬩欢鏍煎紡锛堟瘡琛?"data: <json>\\n\\n"锛夛細
    - {"type": "agent_progress", "agent": "...", "status": "start|done|error", "message": "..."}
    - {"type": "tool_call", "agent": "executor", "tool": "search_runbook|execute_command", "args": {...}}
    - {"type": "suggestions", "session_id": "...", "suggestions": [...], "steps": [...]}
    - {"type": "done"}
    """
    logger.info(
        "api_suggest_stream start session=%s platform=%s exit_code=%s last=%s",
        req.session_id,
        req.platform,
        req.last_exit_code,
        _clip_for_log(req.last_command or "", 160),
    )
    server_platform = _runtime_platform()
    if req.platform != server_platform:
        try:
            req.extra = dict(req.extra or {})
            if req.platform:
                req.extra.setdefault("client_platform", req.platform)
        except Exception:
            pass
        req.platform = server_platform  # type: ignore[assignment]

    session = STORE.get_or_create(req.session_id)
    q: Queue = Queue()
    loop = asyncio.get_event_loop()
    llm_enabled = _llm_enabled()

    def _run_orchestrator() -> None:
        """鍦ㄧ嚎绋嬩腑杩愯 Multi-Agent锛屼簨浠舵帹閫佸埌闃熷垪"""
        try:
            rule_suggestions = suggest(req, allow_orchestrator=False)
            _apply_policy_hints(rule_suggestions)

            if rule_suggestions:
                q.put(
                    {
                        "type": "agent_progress",
                        "agent": "orchestrator",
                        "status": "done",
                        "message": "Rule suggestions returned immediately.",
                    }
                )
                q.put(
                    {
                        "type": "suggestions",
                        "session_id": str(session.id),
                        "suggestions": [s.model_dump() for s in rule_suggestions],
                        "steps": STORE.to_dict_steps(session),
                    }
                )
                if llm_enabled:
                    future = _ENHANCE_POOL.submit(
                        _run_suggestion_enhancement,
                        req.last_command,
                        [s.model_copy(deep=True) for s in rule_suggestions],
                        q,
                    )
                    try:
                        future.result(timeout=22.0)
                    except Exception:
                        pass
                return

            if llm_enabled:
                from .agents import OrchestratorAgent

                orchestrator = OrchestratorAgent()
                final = orchestrator.process(
                    user_intent=req.last_command,
                    platform=req.platform,
                    last_stdout=req.last_stdout,
                    last_stderr=req.last_stderr,
                    last_exit_code=req.last_exit_code,
                    event_queue=q,
                    conversation_messages=req.conversation_messages,
                )
                _apply_policy_hints(final)
            else:
                q.put(
                    {
                        "type": "agent_progress",
                        "agent": "orchestrator",
                        "status": "done",
                        "message": "No rule suggestions and LLM is unavailable.",
                    }
                )
                final = []

            q.put(
                {
                    "type": "suggestions",
                    "session_id": str(session.id),
                    "suggestions": [s.model_dump() for s in final],
                    "steps": STORE.to_dict_steps(session),
                }
            )
            return
        except Exception as e:
            q.put({"type": "error", "message": str(e)[:200]})
        finally:
            q.put(None)  # 缁撴潫鍝ㄥ叺

    async def generate():
        yield f"data: {json.dumps({'type': 'start'}, ensure_ascii=False)}\n\n"
        future = loop.run_in_executor(None, _run_orchestrator)
        while True:
            try:
                event = await asyncio.wait_for(
                    loop.run_in_executor(None, q.get, True, 1.0),
                    timeout=35.0,
                )
                if event is None:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            except (asyncio.TimeoutError, Empty):
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
        await future
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/llm/status", response_model=LlmStatusResponse)
def api_llm_status() -> LlmStatusResponse:
    enabled_flag = os.getenv("TERMINAL_COPILOT_LLM_ENABLED", "auto").strip().lower()
    cfg = resolve_llm_config(require_token=False)
    token_ok = bool(cfg and cfg.access_token)
    enabled = enabled_flag in {"1", "true", "yes", "on"}
    if enabled_flag == "auto":
        enabled = token_ok

    provider = cfg.provider if cfg else "modelscope"
    base_url = cfg.base_url if cfg else PROVIDERS["modelscope"].default_base_url
    model = cfg.model if cfg else PROVIDERS["modelscope"].default_model
    res = LlmStatusResponse(
        enabled=enabled,
        has_token=token_ok,
        provider=provider,
        base_url=base_url,
        model=model,
    )
    logger.debug(
        "api_llm_status enabled=%s has_token=%s provider=%s model=%s base_url=%s",
        res.enabled,
        res.has_token,
        res.provider,
        res.model,
        res.base_url,
    )
    return res


@app.post("/api/llm/token")
def api_llm_set_token(req: LlmTokenRequest) -> dict[str, str]:
    token = (req.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="empty_token")
    cfg = resolve_llm_config(require_token=False)
    base_url = cfg.base_url if cfg else ""
    if not base_url:
        raise HTTPException(status_code=400, detail="empty_base_url")
    write_llm_token(base_url, token)
    logger.info(
        "api_llm_set_token saved token_len=%s base_url=%s",
        len(token),
        _clip_for_log(base_url, 120),
    )
    return {"status": "ok"}


@app.post("/api/llm/config")
def api_llm_set_config(req: LlmConfigRequest) -> dict[str, str]:
    provider = normalize_provider(req.provider) if req.provider is not None else ""
    token = (req.token or "").strip() if req.token is not None else ""
    model = (req.model or "").strip() if req.model is not None else ""
    base_url = (req.base_url or "").strip() if req.base_url is not None else ""

    if (
        req.provider is None
        and req.token is None
        and req.model is None
        and req.base_url is None
    ):
        raise HTTPException(status_code=400, detail="empty_config")

    if req.provider is not None:
        write_llm_provider(provider)
        logger.info("api_llm_set_config updated provider=%s", provider)

    if req.token is not None:
        if not token:
            raise HTTPException(status_code=400, detail="empty_token")
        resolved_base_url = resolve_llm_config(
            provider_override=provider or None,
            base_url_override=base_url or None,
            require_token=False,
        )
        target_base_url = resolved_base_url.base_url if resolved_base_url else ""
        if not target_base_url:
            raise HTTPException(status_code=400, detail="empty_base_url")
        write_llm_token(target_base_url, token)
        logger.info(
            "api_llm_set_config updated token token_len=%s base_url=%s",
            len(token),
            _clip_for_log(target_base_url, 120),
        )

    if req.model is not None:
        if not model:
            raise HTTPException(status_code=400, detail="empty_model")
        write_llm_model(model)
        logger.info("api_llm_set_config updated model=%s", model)

    if req.base_url is not None:
        if not base_url:
            raise HTTPException(status_code=400, detail="empty_base_url")
        write_llm_base_url(base_url)
        logger.info(
            "api_llm_set_config updated base_url=%s", _clip_for_log(base_url, 120)
        )

    return {"status": "ok"}


@app.post("/api/llm/test", response_model=LlmTestResponse)
def api_llm_test(req: LlmTestRequest) -> LlmTestResponse:
    import json
    import urllib.error
    import urllib.request

    provider_override = (
        normalize_provider(req.provider) if req.provider is not None else None
    )
    cfg = resolve_llm_config(
        provider_override=provider_override,
        access_token_override=req.token,
        model_override=req.model,
        base_url_override=req.base_url,
        require_token=False,
    )
    if cfg is None:
        cfg = resolve_llm_config(require_token=False)

    logger.info(
        "api_llm_test start provider=%s model=%s token_provided=%s prompt_len=%s",
        cfg.provider if cfg else "modelscope",
        _clip_for_log((req.model or (cfg.model if cfg else "")), 120),
        bool((req.token or "").strip()) or bool(cfg and cfg.access_token),
        len((req.prompt or "").strip()),
    )

    provider = cfg.provider if cfg else "modelscope"
    base_url = cfg.base_url if cfg else PROVIDERS["modelscope"].default_base_url
    token = cfg.access_token if cfg else ""
    model = cfg.model if cfg else PROVIDERS["modelscope"].default_model

    prompt = (req.prompt or "").strip() if req.prompt is not None else ""
    if not prompt:
        prompt = "Please only reply with one word: OK"

    if not token:
        return LlmTestResponse(
            ok=False,
            provider=provider,
            base_url=base_url,
            model=model,
            latency_ms=0,
            message="token_missing",
            preview="",
        )

    start = time.perf_counter()
    try:
        url = base_url + "chat/completions"
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.0,
            "max_tokens": 16,
            "stream": False,
        }

        http_req = urllib.request.Request(
            url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(
                http_req, timeout=(cfg.timeout_seconds if cfg else 20.0)
            ) as resp:
                body = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            detail = (
                e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else ""
            )
            raise RuntimeError(
                f"{provider}_http_{getattr(e, 'code', 'error')}: {detail[:400]}"
            ) from e
        except urllib.error.URLError as e:
            raise RuntimeError(f"{provider}_network_error: {e}") from e

        data = json.loads(body)
        text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        latency_ms = int((time.perf_counter() - start) * 1000)
        preview = (text or "").strip().replace("\n", " ")
        if len(preview) > 120:
            preview = preview[:120] + "..."
        res = LlmTestResponse(
            ok=True,
            provider=provider,
            base_url=base_url,
            model=model,
            latency_ms=latency_ms,
            message="ok",
            preview=preview,
        )
        logger.info(
            "api_llm_test ok provider=%s model=%s latency_ms=%s preview=%s",
            provider,
            model,
            latency_ms,
            _clip_for_log(preview, 120),
        )
        return res
    except Exception as e:
        latency_ms = int((time.perf_counter() - start) * 1000)
        msg = str(e)[:240]
        logger.warning(
            "api_llm_test failed provider=%s model=%s latency_ms=%s err=%s",
            provider,
            model,
            latency_ms,
            _clip_for_log(msg, 200),
        )
        return LlmTestResponse(
            ok=False,
            provider=provider,
            base_url=base_url,
            model=model,
            latency_ms=latency_ms,
            message=msg,
            preview="",
        )


@app.post("/api/execute", response_model=ExecuteResponse)
def api_execute(req: ExecuteRequest) -> ExecuteResponse:
    t0 = time.perf_counter()
    logger.info(
        "api_execute start session=%s confirmed=%s cmd=%s",
        req.session_id,
        req.confirmed,
        _clip_for_log(req.command or "", 220),
    )
    session = STORE.get_or_create(req.session_id)

    # Maintain a per-session working directory for local execution.
    # Default to repo root; optionally restrict cd within TERMINAL_COPILOT_LOCAL_ROOT.
    local_root = Path(
        os.getenv("TERMINAL_COPILOT_LOCAL_ROOT", str(REPO_ROOT))
    ).resolve()
    if not session.cwd:
        session.cwd = str(local_root)

    def _is_within_root(target: Path) -> bool:
        try:
            return os.path.commonpath([str(local_root), str(target)]) == str(local_root)
        except Exception:
            return False

    def _handle_cd(cmd: str) -> ExecResult | None:
        s = cmd.strip()
        if not s:
            return None
        if not (
            s.lower() == "cd"
            or s.lower().startswith("cd ")
            or s.lower().startswith("cd\t")
        ):
            return None

        # Best-effort parse for: cd <path> | cd /d <path>
        parts = shlex.split(s, posix=False)
        # parts like ["cd"]
        if len(parts) == 1:
            return ExecResult(0, f"{session.cwd}\n", "")

        idx = 1
        if len(parts) >= 3 and parts[1].lower() in {"/d"}:
            idx = 2
        raw_target = " ".join(parts[idx:]).strip()
        if not raw_target:
            return ExecResult(0, f"{session.cwd}\n", "")

        cwd_path = Path(session.cwd).resolve()
        target = Path(raw_target)
        if not target.is_absolute():
            target = cwd_path / target
        try:
            target = target.resolve()
        except Exception:
            target = Path(os.path.abspath(str(target)))

        if not _is_within_root(target):
            return ExecResult(1, "", f"cd_denied_outside_root: {local_root}")
        if not target.exists() or not target.is_dir():
            return ExecResult(1, "", f"cd_not_found: {raw_target}")

        session.cwd = str(target)
        return ExecResult(0, "", "")

    STORE.add_event(
        session,
        kind="execute_request",
        payload={"command": req.command, "confirmed": str(req.confirmed)},
    )

    decision = evaluate(req.command)
    if decision.level == "block":
        logger.warning(
            "api_execute blocked_by_policy session=%s reason=%s cmd=%s",
            session.id,
            decision.reason,
            _clip_for_log(req.command or "", 180),
        )
        STORE.add_verification_step(
            session,
            title="瀹夊叏鎷︽埅",
            command=req.command,
            ok=False,
            detail=decision.reason,
        )
        return ExecuteResponse(
            session_id=session.id,
            command=req.command,
            exit_code=126,
            stdout="",
            stderr="blocked_by_policy",
            executor="policy",
            steps=STORE.to_dict_steps(session),
        )

    if decision.level == "warn" and not req.confirmed:
        logger.info(
            "api_execute confirmation_required session=%s reason=%s cmd=%s",
            session.id,
            decision.reason,
            _clip_for_log(req.command or "", 180),
        )
        STORE.add_verification_step(
            session,
            title="需要确认",
            command=req.command,
            ok=False,
            detail=decision.reason,
        )
        return ExecuteResponse(
            session_id=session.id,
            command=req.command,
            exit_code=2,
            stdout="",
            stderr="confirmation_required",
            executor="policy",
            steps=STORE.to_dict_steps(session),
        )

    # Built-in: cd (keep cwd without spawning a subprocess)
    cd_res = _handle_cd(req.command)
    if cd_res is not None:
        result = cd_res
        executor = get_executor()
    else:
        executor = get_executor()
        result = executor.run(
            req.command,
            confirmed=req.confirmed,
            cwd=session.cwd,
            session_id=str(session.id),
        )

    STORE.add_event(
        session,
        kind="execute_result",
        payload={
            "command": req.command,
            "exit_code": str(result.exit_code),
            "executor": executor.name,
        },
    )
    STORE.add_execution_step(session, command=req.command, exit_code=result.exit_code)

    v = maybe_verify(
        command=req.command,
        exit_code=result.exit_code,
        stdout=result.stdout,
        stderr=result.stderr,
    )
    if v is not None:
        STORE.add_event(
            session,
            kind="verify",
            payload={"title": v.title, "ok": str(v.ok), "detail": v.detail[:200]},
        )
        STORE.add_verification_step(
            session,
            title=v.title,
            command=req.command,
            ok=v.ok,
            detail=v.detail,
        )
    res = ExecuteResponse(
        session_id=session.id,
        command=req.command,
        exit_code=result.exit_code,
        stdout=result.stdout,
        stderr=result.stderr,
        executor=executor.name,
        cwd=session.cwd,
        steps=STORE.to_dict_steps(session),
    )
    logger.info(
        "api_execute done session=%s executor=%s exit=%s stdout_len=%s stderr_len=%s cwd=%s cost=%sms",
        session.id,
        executor.name,
        result.exit_code,
        len(result.stdout or ""),
        len(result.stderr or ""),
        session.cwd,
        int((time.perf_counter() - t0) * 1000),
    )
    return res


@app.post("/api/interrupt", response_model=InterruptResponse)
def api_interrupt(req: InterruptRequest) -> InterruptResponse:
    session = STORE.get(req.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session_not_found")

    ex = get_executor()
    ok = False
    try:
        ok = bool(ex.interrupt(str(req.session_id)))
    except Exception:
        ok = False

    STORE.add_event(
        session,
        kind="interrupt",
        payload={"ok": str(ok), "executor": ex.name},
    )
    logger.info(
        "api_interrupt session=%s ok=%s executor=%s", req.session_id, ok, ex.name
    )
    return InterruptResponse(
        ok=ok, message="interrupted" if ok else "no_running_process"
    )


class PlanExecuteRequest(BaseModel):
    session_id: str | None = None


@app.post("/api/plan/{plan_id}/execute")
def api_plan_execute(plan_id: str, req: PlanExecuteRequest) -> dict:
    plan = _PLAN_STORE.get(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="plan_not_found")
    from uuid import UUID

    sid = req.session_id
    try:
        session_uuid = UUID(sid) if sid else None
    except ValueError:
        session_uuid = None
    session = STORE.get_or_create(session_uuid)
    if not session.cwd:
        local_root = Path(
            os.getenv("TERMINAL_COPILOT_LOCAL_ROOT", str(REPO_ROOT))
        ).resolve()
        session.cwd = str(local_root)
    start_plan_execution(plan, session_id=str(session.id), cwd=session.cwd)
    return {"ok": True, "plan_id": plan.id}


@app.get("/api/plan/{plan_id}/stream")
async def api_plan_stream(
    plan_id: str, session_id: str | None = None
) -> StreamingResponse:
    state = get_plan_state(plan_id)
    if state is None:
        raise HTTPException(status_code=404, detail="plan_state_not_found")

    async def generate():
        loop = asyncio.get_event_loop()
        while True:
            try:
                event = await asyncio.wait_for(
                    loop.run_in_executor(None, state.event_queue.get, True, 1.0),
                    timeout=35.0,
                )
                if event is None:
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            except (asyncio.TimeoutError, Empty):
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/plan/{plan_id}/node/{node_id}/approve")
def api_plan_node_approve(plan_id: str, node_id: str) -> dict:
    ok = approve_node(plan_id, node_id)
    return {"ok": ok}


@app.post("/api/plan/{plan_id}/node/{node_id}/skip")
def api_plan_node_skip(plan_id: str, node_id: str) -> dict:
    ok = skip_node(plan_id, node_id)
    return {"ok": ok}


@app.post("/api/plan/{plan_id}/cancel")
def api_plan_cancel(plan_id: str) -> dict:
    ok = cancel_plan(plan_id)
    return {"ok": ok}


@app.get("/api/runbooks", response_model=RunbookListResponse)
def api_runbooks_list() -> RunbookListResponse:
    items = []
    for path in sorted(RUNBOOK_DIR.rglob("*.md")) if RUNBOOK_DIR.exists() else []:
        try:
            text = path.read_text(encoding="utf-8")
            stat = path.stat()
            rel = path.resolve().relative_to(REPO_ROOT).as_posix()
            items.append(
                {
                    "name": path.name,
                    "title": _extract_markdown_title(text, path.stem),
                    "source": rel,
                    "size": stat.st_size,
                    "updated_at": datetime.fromtimestamp(
                        stat.st_mtime, timezone.utc
                    ).isoformat(),
                    "editable": CUSTOM_RUNBOOK_DIR in path.resolve().parents,
                }
            )
        except Exception:
            continue
    return RunbookListResponse(items=items)


@app.post("/api/runbooks")
def api_runbooks_upsert(req: RunbookUpsertRequest) -> dict[str, str | bool]:
    name = _safe_runbook_name(req.filename)
    content = str(req.content or "")
    if not content.strip():
        raise HTTPException(status_code=400, detail="empty_content")
    CUSTOM_RUNBOOK_DIR.mkdir(parents=True, exist_ok=True)
    path = CUSTOM_RUNBOOK_DIR / name
    path.write_text(content, encoding="utf-8")
    _refresh_knowledge_caches()
    logger.info("runbook upserted path=%s size=%s", path, len(content))
    return {"ok": True, "source": path.resolve().relative_to(REPO_ROOT).as_posix()}


@app.delete("/api/runbooks/{filename}")
def api_runbooks_delete(filename: str) -> dict[str, bool]:
    name = _safe_runbook_name(filename)
    path = (CUSTOM_RUNBOOK_DIR / name).resolve()
    if CUSTOM_RUNBOOK_DIR.resolve() not in path.parents:
        raise HTTPException(status_code=400, detail="invalid_runbook_path")
    if not path.exists():
        raise HTTPException(status_code=404, detail="runbook_not_found")
    path.unlink()
    _refresh_knowledge_caches()
    logger.info("runbook deleted path=%s", path)
    return {"ok": True}


# Static frontend hosting
class _NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):  # type: ignore[override]
        resp = await super().get_response(path, scope)
        # Hosted environments (e.g. ModelScope Spaces) can cache aggressively.
        # Disable caching so new deployments immediately reflect frontend updates.
        resp.headers.setdefault("Cache-Control", "no-store")
        resp.headers.setdefault("Pragma", "no-cache")
        return resp


if FRONTEND_STATIC_DIR.exists():
    app.mount(
        "/static",
        _NoCacheStaticFiles(directory=str(FRONTEND_STATIC_DIR)),
        name="static",
    )


@app.get("/")
def index() -> FileResponse:
    return FileResponse(
        str(FRONTEND_DIR / "index.html"),
        headers={
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
        },
    )


@app.get("/favicon.ico")
def favicon() -> Response:
    return Response(status_code=204)
