from __future__ import annotations

import os

from .base import Executor
from .local_executor import LocalExecutor
from .simulate_executor import SimulateExecutor


_OVERRIDE_MODE: str | None = None


def get_executor_mode() -> str:
    if _OVERRIDE_MODE:
        return _OVERRIDE_MODE
    return os.getenv("TERMINAL_COPILOT_EXECUTOR", "local").lower().strip()


def set_executor_mode(mode: str) -> None:
    global _OVERRIDE_MODE
    _OVERRIDE_MODE = (mode or "").lower().strip() or None


def get_executor() -> Executor:
    mode = get_executor_mode()
    if mode == "local":
        return LocalExecutor()
    return SimulateExecutor()
