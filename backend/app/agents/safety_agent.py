from __future__ import annotations

import json

from .base import AgentMessage, BaseAgent


class SafetyAgent(BaseAgent):
    """安全审查 Agent：对命令建议进行风险评估，增强 policy.py 的静态规则"""

    name = "safety"
    system_prompt = ""  # 主要依赖静态规则，LLM 作为辅助

    def think(self, messages: list[AgentMessage]) -> AgentMessage:
        """审查命令列表，返回带风险标注的建议"""
        content = next((m.content for m in reversed(messages) if m.role in {"executor", "orchestrator"}), "[]")
        try:
            suggestions = json.loads(content) if isinstance(content, str) else content
        except Exception:
            suggestions = []

        audited = [self._audit_one(s) for s in suggestions]
        return AgentMessage(
            role=self.name,
            content=json.dumps(audited, ensure_ascii=False),
            metadata={"agent": self.name, "total": len(audited)},
        )

    def audit(self, suggestions: list[dict]) -> list[dict]:
        """便捷接口：批量审查命令建议，返回带 risk_level 的建议列表"""
        return [self._audit_one(s) for s in suggestions]

    def _audit_one(self, suggestion: dict) -> dict:
        """对单条建议进行安全审查"""
        from ..policy import evaluate

        command = suggestion.get("command", "")
        decision = evaluate(command)
        return {
            **suggestion,
            "risk_level": decision.level,
            "requires_confirmation": decision.level in {"warn", "block"},
            "safety_reason": decision.reason,
        }
