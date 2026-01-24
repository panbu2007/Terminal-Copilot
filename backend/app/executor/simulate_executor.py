from __future__ import annotations

from .base import ExecResult, Executor


class SimulateExecutor(Executor):
    name = "simulate"

    def run(
        self,
        command: str,
        *,
        confirmed: bool,
        cwd: str | None = None,
        session_id: str | None = None,
    ) -> ExecResult:
        cmd = command.strip()

        # Simple canned outputs for demos.
        if cmd == "sudo systemctl daemon-reload":
            return ExecResult(0, "systemd reloaded\n", "")
        if cmd == "sudo systemctl restart docker":
            if not confirmed:
                return ExecResult(2, "", "confirmation_required")
            return ExecResult(0, "docker restarted\n", "")
        if cmd == "docker info":
            return ExecResult(
                0,
                "Registry Mirrors:\n https://mirror.example.com\n\nServer Version: 25.x\n",
                "",
            )
        if cmd.startswith("git chekcout"):
            return ExecResult(1, "", "git: 'chekcout' is not a git command.\n")
        if cmd.startswith("git checkout"):
            return ExecResult(0, "Switched to branch 'main'\n", "")
        if cmd.startswith("netstat") or cmd.startswith("ss ") or cmd.startswith("lsof "):
            return ExecResult(0, "(sample) LISTEN 0.0.0.0:8000 pid=1234\n", "")

        # Default
        return ExecResult(0, f"(simulate) ok: {cmd}\n", "")

    def interrupt(self, session_id: str) -> bool:
        return False
