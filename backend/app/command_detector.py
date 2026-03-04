from __future__ import annotations

import re
from dataclasses import dataclass, field


_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


@dataclass
class CommandDetector:
    current_input: str = ""
    pending_command: str = ""
    output_buffer: str = ""
    collecting: bool = False
    _prompt_re: re.Pattern = field(
        default_factory=lambda: re.compile(
            r"(?:^|\n)(?:\([^)]+\)\s*)?(?:[\w.@-]+(?::|@))?[\w~/.: -]*[$#%>]\s*$",
            re.MULTILINE,
        )
    )

    def feed_input(self, data: str) -> list[dict]:
        events: list[dict] = []
        for ch in str(data or ""):
            if ch in {"\r", "\n"}:
                submitted = self.current_input.strip()
                self.current_input = ""
                if submitted:
                    self.pending_command = submitted
                    self.output_buffer = ""
                    self.collecting = True
            elif ch == "\x7f":
                self.current_input = self.current_input[:-1]
            elif ch >= " ":
                self.current_input += ch
        return events

    def feed_output(self, text: str) -> list[dict]:
        if not self.collecting:
            return []

        self.output_buffer += str(text or "")
        if len(self.output_buffer) > 30000:
            self.output_buffer = self.output_buffer[-24000:]

        cleaned = _ANSI_RE.sub("", self.output_buffer).replace("\r", "")
        if not self._prompt_re.search(cleaned):
            return []

        lines = cleaned.split("\n")
        while lines and self._looks_like_prompt(lines[-1]):
            lines.pop()

        if lines and lines[0].strip() == self.pending_command:
            lines = lines[1:]

        event = {
            "type": "command_complete",
            "command": self.pending_command,
            "output": "\n".join(lines).strip(),
        }
        self.pending_command = ""
        self.output_buffer = ""
        self.collecting = False
        return [event]

    def _looks_like_prompt(self, line: str) -> bool:
        value = str(line or "").strip()
        if not value:
            return False
        return bool(self._prompt_re.fullmatch(value))

