from __future__ import annotations

import json
import re

from .base import AgentMessage, BaseAgent

_JSON_RE = re.compile(r"\{[\s\S]*\}", re.MULTILINE)


class DiagAgent(BaseAgent):
    """错误诊断 Agent：分析 stderr / exit_code，给出结构化诊断结论"""

    name = "diag"
    system_prompt = (
        "你是终端错误诊断专家。分析命令执行结果，给出简短诊断结论。\n"
        "只返回严格 JSON 对象（不要代码块/不要多余文字），格式：\n"
        '{"error_type": "...", "diagnosis": "...", "hint": "..."}\n'
        "- error_type: 错误类型简称（如 EADDRINUSE, permission_denied, command_not_found）\n"
        "- diagnosis: 中文诊断说明（1-2句）\n"
        "- hint: 建议方向（1句）\n"
        "如果没有错误（exit_code==0），返回 {\"error_type\": null, \"diagnosis\": \"命令成功\", \"hint\": \"\"}"
    )

    def think(self, messages: list[AgentMessage]) -> AgentMessage:
        """分析错误输出，返回诊断结论"""
        # 从最后一条用户消息提取上下文
        context = next((m.content for m in reversed(messages) if m.role in {"user", "orchestrator"}), "")

        try:
            result = self._llm(context, max_tokens=256)
            m = _JSON_RE.search(result)
            data = json.loads(m.group(0)) if m else {"error_type": None, "diagnosis": result[:200], "hint": ""}
        except Exception as e:
            data = {"error_type": "unknown", "diagnosis": f"诊断失败: {e}", "hint": ""}

        return AgentMessage(
            role=self.name,
            content=json.dumps(data, ensure_ascii=False),
            metadata={"agent": self.name, "confidence": "medium" if data.get("error_type") else "low"},
        )

    def diagnose(self, command: str, stderr: str, exit_code: int | None) -> dict:
        """便捷调用接口，返回诊断字典"""
        if not stderr and (exit_code is None or exit_code == 0):
            return {"error_type": None, "diagnosis": "命令成功", "hint": ""}

        user_content = json.dumps(
            {
                "command": command,
                "stderr": stderr[:600],
                "exit_code": exit_code,
            },
            ensure_ascii=False,
        )
        msg = self.think([AgentMessage(role="user", content=user_content)])
        try:
            return json.loads(msg.content)
        except Exception:
            return {"error_type": "parse_error", "diagnosis": msg.content[:200], "hint": ""}
