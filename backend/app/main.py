from __future__ import annotations

import os
from pathlib import Path
import shlex

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .executor import get_executor, get_executor_mode, set_executor_mode
from .executor.base import ExecResult
from .models import (
    ExecuteRequest,
    ExecuteResponse,
    ExecutorModeRequest,
    ExecutorStatusResponse,
    EventsResponse,
    ExportResponse,
    LlmConfigRequest,
    LlmStatusResponse,
    LlmTestRequest,
    LlmTestResponse,
    LlmTokenRequest,
    RiskLevel,
    SessionResponse,
    SuggestRequest,
    SuggestResponse,
)
from .local_secrets import has_modelscope_token, read_modelscope_model, write_modelscope_model, write_modelscope_token
from .planner import suggest
from .policy import evaluate
from .store import STORE
from .verifier import maybe_verify


APP_ROOT = Path(__file__).resolve().parent
REPO_ROOT = APP_ROOT.parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
FRONTEND_STATIC_DIR = FRONTEND_DIR / "static"

app = FastAPI(title="Terminal Copilot", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, str]:
    ex = get_executor()
    return {"status": "ok", "executor": ex.name}


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
    return SessionResponse(
        session_id=session.id,
        created_at=session.created_at.isoformat(),
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
        steps=STORE.to_dict_steps(session),
        events=STORE.to_dict_events(session),
    )


@app.post("/api/suggest", response_model=SuggestResponse)
def api_suggest(req: SuggestRequest) -> SuggestResponse:
    session = STORE.get_or_create(req.session_id)
    suggestions = suggest(req)

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

    # Apply policy hints to suggestions (consistent with execute-time guard)
    for s in suggestions:
        if not s.command or s.command == "(auto)":
            continue
        d = evaluate(s.command)
        if d.level == "block":
            s.risk_level = RiskLevel.block
            s.requires_confirmation = False
            s.explanation = f"{s.explanation}\n安全提示：{d.reason}"
        elif d.level == "warn":
            s.risk_level = RiskLevel.warn
            s.requires_confirmation = True
            s.explanation = f"{s.explanation}\n安全提示：{d.reason}"
    STORE.add_event(
        session,
        kind="suggest",
        payload={
            "last_command": req.last_command,
            "count": str(len(suggestions)),
        },
    )
    STORE.add_planned_steps(
        session,
        items=[(s.title, s.command) for s in suggestions if s.command and s.command != "(auto)"],
    )
    return SuggestResponse(
        session_id=session.id,
        suggestions=suggestions,
        steps=STORE.to_dict_steps(session),
    )


@app.get("/api/llm/status", response_model=LlmStatusResponse)
def api_llm_status() -> LlmStatusResponse:
    import os

    enabled_flag = os.getenv("TERMINAL_COPILOT_LLM_ENABLED", "auto").strip().lower()
    enabled = enabled_flag in {"1", "true", "yes", "on"}
    token_ok = has_modelscope_token() or bool(os.getenv("MODELSCOPE_ACCESS_TOKEN")) or bool(
        os.getenv("TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN")
    )
    if enabled_flag == "auto":
        enabled = token_ok

    base_url = os.getenv("TERMINAL_COPILOT_MODELSCOPE_BASE_URL", "https://api-inference.modelscope.cn/v1/")
    model = os.getenv("TERMINAL_COPILOT_MODELSCOPE_MODEL") or read_modelscope_model() or "Qwen/Qwen2.5-Coder-32B-Instruct"
    return LlmStatusResponse(
        enabled=enabled,
        has_token=token_ok,
        provider="modelscope",
        base_url=base_url,
        model=model,
    )


@app.post("/api/llm/token")
def api_llm_set_token(req: LlmTokenRequest) -> dict[str, str]:
    token = (req.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="empty_token")
    write_modelscope_token(token)
    return {"status": "ok"}


@app.post("/api/llm/config")
def api_llm_set_config(req: LlmConfigRequest) -> dict[str, str]:
    token = (req.token or "").strip() if req.token is not None else ""
    model = (req.model or "").strip() if req.model is not None else ""

    if req.token is None and req.model is None:
        raise HTTPException(status_code=400, detail="empty_config")

    if req.token is not None:
        if not token:
            raise HTTPException(status_code=400, detail="empty_token")
        write_modelscope_token(token)

    if req.model is not None:
        if not model:
            raise HTTPException(status_code=400, detail="empty_model")
        write_modelscope_model(model)

    return {"status": "ok"}


@app.post("/api/llm/test", response_model=LlmTestResponse)
def api_llm_test(req: LlmTestRequest) -> LlmTestResponse:
    import time
    import json
    import urllib.error
    import urllib.request

    provider = "modelscope"
    base_url = os.getenv("TERMINAL_COPILOT_MODELSCOPE_BASE_URL", "https://api-inference.modelscope.cn/v1/")
    if not base_url.endswith("/"):
        base_url += "/"

    token = (req.token or "").strip() if req.token is not None else ""
    if not token:
        token = os.getenv("TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN") or os.getenv("MODELSCOPE_ACCESS_TOKEN") or ""
    if not token:
        from .local_secrets import read_modelscope_token

        token = read_modelscope_token() or ""

    model = (req.model or "").strip() if req.model is not None else ""
    if not model:
        model = os.getenv("TERMINAL_COPILOT_MODELSCOPE_MODEL") or read_modelscope_model() or "Qwen/Qwen2.5-Coder-32B-Instruct"

    prompt = (req.prompt or "").strip() if req.prompt is not None else ""
    if not prompt:
        prompt = "请只回复一个词：OK"

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
            with urllib.request.urlopen(http_req, timeout=20.0) as resp:
                body = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else ""
            raise RuntimeError(f"modelscope_http_{getattr(e, 'code', 'error')}: {detail[:400]}") from e
        except urllib.error.URLError as e:
            raise RuntimeError(f"modelscope_network_error: {e}") from e

        data = json.loads(body)
        text = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        latency_ms = int((time.perf_counter() - start) * 1000)
        preview = (text or "").strip().replace("\n", " ")
        if len(preview) > 120:
            preview = preview[:120] + "…"
        return LlmTestResponse(
            ok=True,
            provider=provider,
            base_url=base_url,
            model=model,
            latency_ms=latency_ms,
            message="ok",
            preview=preview,
        )
    except Exception as e:
        latency_ms = int((time.perf_counter() - start) * 1000)
        msg = str(e)[:240]
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
    session = STORE.get_or_create(req.session_id)

    # Maintain a per-session working directory for local execution.
    # Default to repo root; optionally restrict cd within TERMINAL_COPILOT_LOCAL_ROOT.
    local_root = Path(os.getenv("TERMINAL_COPILOT_LOCAL_ROOT", str(REPO_ROOT))).resolve()
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
        if not (s.lower() == "cd" or s.lower().startswith("cd ") or s.lower().startswith("cd\t")):
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
            target = (cwd_path / target)
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

    STORE.add_event(session, kind="execute_request", payload={"command": req.command, "confirmed": str(req.confirmed)})

    decision = evaluate(req.command)
    if decision.level == "block":
        STORE.add_verification_step(
            session,
            title="安全拦截",
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
        result = executor.run(req.command, confirmed=req.confirmed, cwd=session.cwd)

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
    return ExecuteResponse(
        session_id=session.id,
        command=req.command,
        exit_code=result.exit_code,
        stdout=result.stdout,
        stderr=result.stderr,
        executor=executor.name,
        steps=STORE.to_dict_steps(session),
    )


# Static frontend hosting
if FRONTEND_STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_STATIC_DIR)), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(str(FRONTEND_DIR / "index.html"))
