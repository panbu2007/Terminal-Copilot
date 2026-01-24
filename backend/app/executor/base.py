from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExecResult:
    exit_code: int
    stdout: str
    stderr: str


class Executor:
    name: str

    def run(
        self,
        command: str,
        *,
        confirmed: bool,
        cwd: str | None = None,
        session_id: str | None = None,
    ) -> ExecResult:  # pragma: no cover
        raise NotImplementedError

    def interrupt(self, session_id: str) -> bool:  # pragma: no cover
        """Best-effort interrupt for a running command.

        Returns True if an interrupt signal was sent, False if no running process is tracked.
        """

        return False
