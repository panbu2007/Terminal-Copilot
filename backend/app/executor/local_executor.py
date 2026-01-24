from __future__ import annotations

import os
import signal
import subprocess
import threading

from .base import ExecResult, Executor


_RUNNING: dict[str, subprocess.Popen[str]] = {}
_LOCK = threading.Lock()


class LocalExecutor(Executor):
    """Execute commands on the host machine (one-shot).

    Notes:
    - This is NOT a full PTY-backed interactive terminal.
    - Commands that require interactive input may hang; we apply a timeout.
    - Use policy guards in API layer to block risky commands.
    """

    name = "local"

    def __init__(self, timeout_seconds: float = 30.0) -> None:
        self.timeout_seconds = timeout_seconds

    def run(
        self,
        command: str,
        *,
        confirmed: bool,
        cwd: str | None = None,
        session_id: str | None = None,
    ) -> ExecResult:
        try:
            creationflags = 0
            start_new_session = False
            if os.name == "nt":
                # Allow sending CTRL_BREAK_EVENT to the process group.
                creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            else:
                # Put subprocess in its own process group for SIGINT delivery.
                start_new_session = True

            proc = subprocess.Popen(
                command,
                shell=True,
                cwd=cwd or None,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                creationflags=creationflags,
                start_new_session=start_new_session,
            )

            if session_id:
                with _LOCK:
                    _RUNNING[session_id] = proc

            try:
                out, err = proc.communicate(timeout=self.timeout_seconds)
            except subprocess.TimeoutExpired:
                try:
                    proc.kill()
                except Exception:
                    pass
                out, err = proc.communicate()
                return ExecResult(124, out or "", (err or "") + ("\n" if err else "") + "command_timeout")
            finally:
                if session_id:
                    with _LOCK:
                        # Only delete if it's the same proc.
                        cur = _RUNNING.get(session_id)
                        if cur is proc:
                            _RUNNING.pop(session_id, None)

            return ExecResult(
                exit_code=int(proc.returncode or 0),
                stdout=out or "",
                stderr=err or "",
            )
        except subprocess.TimeoutExpired:
            return ExecResult(124, "", "command_timeout")
        except Exception as e:  # noqa: BLE001
            return ExecResult(1, "", f"local_executor_error: {e}")

    def interrupt(self, session_id: str) -> bool:
        with _LOCK:
            proc = _RUNNING.get(session_id)
        if proc is None:
            return False

        # Best-effort: signal first, then terminate.
        try:
            if os.name == "nt":
                proc.send_signal(getattr(signal, "CTRL_BREAK_EVENT", signal.SIGTERM))
            else:
                proc.send_signal(signal.SIGINT)
            return True
        except Exception:
            try:
                proc.terminate()
                return True
            except Exception:
                return False
