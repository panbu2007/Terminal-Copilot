from __future__ import annotations

import subprocess

from .base import ExecResult, Executor


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

    def run(self, command: str, *, confirmed: bool, cwd: str | None = None) -> ExecResult:
        try:
            completed = subprocess.run(
                command,
                shell=True,
                cwd=cwd or None,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
            return ExecResult(
                exit_code=int(completed.returncode),
                stdout=completed.stdout or "",
                stderr=completed.stderr or "",
            )
        except subprocess.TimeoutExpired:
            return ExecResult(124, "", "command_timeout")
        except Exception as e:  # noqa: BLE001
            return ExecResult(1, "", f"local_executor_error: {e}")
