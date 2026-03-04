from __future__ import annotations

import json
from typing import Any

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

    def summarize_execution_audit(self, report: dict[str, Any]) -> dict[str, Any]:
        nodes = list(report.get("nodes") or [])
        failed = [node for node in nodes if node.get("status") == "failed"]
        skipped = [node for node in nodes if node.get("status") == "skipped"]
        warned = [
            node
            for node in nodes
            if str(node.get("risk_level") or "").lower() in {"warn", "block"}
        ]
        ungrounded = [node for node in nodes if not node.get("grounded", False)]

        severity = "pass"
        if failed:
            severity = "fail"
        elif skipped or warned or ungrounded:
            severity = "warn"

        findings: list[dict[str, str]] = []
        if failed:
            findings.append({
                "severity": "fail",
                "title": "执行失败节点",
                "message": f"{len(failed)} 个节点执行失败，需要人工复核输出和回滚路径。",
            })
        if skipped:
            findings.append({
                "severity": "warn",
                "title": "存在跳过节点",
                "message": f"{len(skipped)} 个节点被跳过，可能意味着审批超时、人工拒绝或条件未满足。",
            })
        if warned:
            findings.append({
                "severity": "warn",
                "title": "高风险节点已参与流程",
                "message": f"{len(warned)} 个节点属于 warn/block 风险级别，应重点检查执行依据和输出。",
            })
        if ungrounded:
            findings.append({
                "severity": "info",
                "title": "部分节点缺少知识库依据",
                "message": f"{len(ungrounded)} 个节点未标记 grounded，建议补充 Runbook 或人工确认。",
            })
        if not findings:
            findings.append({
                "severity": "info",
                "title": "审计通过",
                "message": "未发现失败、跳过或明显高风险异常，流程整体可追溯。",
            })

        recommendations: list[str] = []
        if failed:
            recommendations.append("优先处理失败节点，并根据 stderr/stdout 决定是否执行回滚。")
        if skipped:
            recommendations.append("复核被跳过节点是否必须补执行，尤其是 verify 或 rollback 类型节点。")
        if ungrounded:
            recommendations.append("为缺少依据的节点补充或上传对应 Runbook，提升 grounded 覆盖率。")
        if not recommendations:
            recommendations.append("保留本次审计报告，作为后续 SOP 和复盘样本。")

        return {
            "severity": severity,
            "summary": findings[0]["message"],
            "findings": findings,
            "recommendations": recommendations,
        }

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
