from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class ConversationTurn:
    role: str
    content: str
    timestamp: float = field(default_factory=time.time)


class ConversationHistory:
    def __init__(self, max_chars: int = 12000) -> None:
        self.turns: list[ConversationTurn] = []
        self.max_chars = max_chars

    def add_command(self, command: str) -> None:
        value = str(command or "").strip()
        if value:
            self.turns.append(ConversationTurn(role="command", content=value))
            self._trim()

    def add_output(self, output: str) -> None:
        value = str(output or "").strip()
        if not value:
            return
        if len(value) > 2000:
            value = value[:1000] + "\n... (truncated) ...\n" + value[-800:]
        self.turns.append(ConversationTurn(role="output", content=value))
        self._trim()

    def add_intent(self, intent: str) -> None:
        value = str(intent or "").strip()
        if value:
            self.turns.append(ConversationTurn(role="intent", content=value))
            self._trim()

    def to_llm_messages(self, limit: int = 12) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = []
        for turn in self.turns[-limit:]:
            if turn.role == "command":
                messages.append({"role": "user", "content": f"[command] $ {turn.content}"})
            elif turn.role == "output":
                messages.append({"role": "user", "content": f"[terminal output]\n{turn.content}"})
            elif turn.role == "intent":
                messages.append({"role": "user", "content": f"[user intent] {turn.content}"})
        return messages

    def to_summary(self, limit: int = 10) -> str:
        lines: list[str] = []
        for turn in self.turns[-limit:]:
            if turn.role == "command":
                lines.append(f"$ {turn.content}")
            elif turn.role == "output":
                lines.append(turn.content[:240])
            elif turn.role == "intent":
                lines.append(f"? {turn.content}")
        return "\n".join(lines)

    def _trim(self) -> None:
        while self._total_chars() > self.max_chars and len(self.turns) > 2:
            self.turns.pop(0)

    def _total_chars(self) -> int:
        return sum(len(turn.content) for turn in self.turns)

