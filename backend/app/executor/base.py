from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExecResult:
    exit_code: int
    stdout: str
    stderr: str


class Executor:
    name: str

    def run(self, command: str, *, confirmed: bool, cwd: str | None = None) -> ExecResult:  # pragma: no cover
        raise NotImplementedError
