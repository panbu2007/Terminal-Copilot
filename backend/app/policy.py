from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class PolicyDecision:
    level: str  # safe | warn | block
    reason: str = ""


def evaluate(command: str) -> PolicyDecision:
    cmd = (command or "").strip()
    low = cmd.lower()

    # Blocklist: catastrophic / clearly destructive
    block_patterns = [
        r"\brm\s+-rf\s+/\b",
        r"\bmkfs\b",
        r"\bformat\b",
        r"\bdel\b\s+/s\b",
        r"\bshutdown\b",
        r"\breboot\b",
        r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:",
    ]
    for p in block_patterns:
        if re.search(p, low):
            return PolicyDecision(level="block", reason="命令疑似高危/破坏性操作，已拦截。")

    # Warnlist: potentially disruptive
    warn_patterns = [
        r"\bsystemctl\s+restart\b",
        r"\bdocker\s+system\s+prune\b",
        r"\bgit\s+reset\s+--hard\b",
        r"\bkill\s+-9\b",
    ]
    for p in warn_patterns:
        if re.search(p, low):
            return PolicyDecision(level="warn", reason="命令可能影响系统/数据，建议二次确认。")

    return PolicyDecision(level="safe")
