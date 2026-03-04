from __future__ import annotations

import json
import logging
import re

from .base import AgentMessage, BaseAgent
from .tools import TOOLS

logger = logging.getLogger("terminal_copilot.executor_agent")

_JSON_ARRAY_RE = re.compile(r"\[[\s\S]*\]", re.MULTILINE)

# ExecutorAgent 使用的工具子集（搜索知识库 + 生成命令建议）
_EXECUTOR_TOOLS = [t for t in TOOLS if t["function"]["name"] in {"search_runbook", "execute_command"}]

_SYSTEM_PROMPT_FC = (
    "你是终端命令专家。根据用户意图、错误诊断和知识库参考，给出最佳可执行命令建议。\n"
    "你可以先调用 search_runbook 查阅知识库，再调用 execute_command 逐条给出建议。\n"
    "最终必须以严格 JSON 数组形式返回所有建议（不要代码块/不要多余文字）：\n"
    '[{"title":"...","command":"...","explanation":"...","why":"...","risk":"...","rollback":"...","verify":"..."}]\n'
    "要求：命令尽量最小安全可逆；最多 5 条；explanation/why/risk/rollback/verify 用中文。"
)

_SYSTEM_PROMPT_PLAIN = (
    "你是终端命令专家。根据用户意图、错误诊断和知识库参考，给出最佳可执行命令建议。\n"
    "只返回严格 JSON 数组（不要代码块/不要多余文字），每个元素：\n"
    '{"title": "...", "command": "...", "explanation": "...", "why": "...", "risk": "...", "rollback": "...", "verify": "..."}\n'
    "要求：命令尽量最小、安全、可逆；最多 5 条；explanation/why/risk/rollback/verify 用中文。"
)


class ExecutorAgent(BaseAgent):
    """执行计划 Agent：综合意图、诊断、知识库，生成可执行命令建议。

    优先使用 Function Calling（ReAct 循环），失败时退回直接 JSON prompt。
    """

    name = "executor"
    system_prompt = _SYSTEM_PROMPT_FC

    def think(self, messages: list[AgentMessage]) -> AgentMessage:
        """生成命令建议"""
        context = " ".join(m.content for m in messages if m.role in {"user", "orchestrator", "diag", "rag"})
        raw = self._generate_plain(context)
        return AgentMessage(
            role=self.name,
            content=raw,
            metadata={"agent": self.name},
        )

    def generate(
        self,
        *,
        user_intent: str,
        platform: str | None,
        diag: dict | None = None,
        citations: list | None = None,
        last_stdout: str = "",
        last_stderr: str = "",
        event_queue=None,
    ) -> list[dict]:
        """便捷接口：生成建议列表。优先 Function Calling，降级到直接 JSON。"""
        user_content = json.dumps(
            {
                "intent": user_intent,
                "platform": platform or "linux",
                "diagnosis": diag or {},
                "rag_citations": [
                    {
                        "title": c.title if hasattr(c, "title") else c.get("title", ""),
                        "snippet": (c.snippet if hasattr(c, "snippet") else c.get("snippet", ""))[:200],
                    }
                    for c in (citations or [])
                ][:3],
                "last_stdout": (last_stdout or "")[:400],
                "last_stderr": (last_stderr or "")[:400],
            },
            ensure_ascii=False,
        )

        # 尝试 Function Calling（ReAct 循环）
        try:
            return self._generate_with_tools(user_content, event_queue=event_queue)
        except Exception as e:
            logger.warning("Function calling 失败，降级到直接 JSON: %s", e)

        # 降级：直接 JSON prompt
        self.system_prompt = _SYSTEM_PROMPT_PLAIN
        raw = self._generate_plain(user_content)
        self.system_prompt = _SYSTEM_PROMPT_FC
        return self._parse(raw)

    def _generate_with_tools(self, user_content: str, event_queue=None) -> list[dict]:
        """使用 Function Calling ReAct 循环生成建议"""
        final_content, tool_records = self._react_loop(
            user_content,
            tools=_EXECUTOR_TOOLS,
            max_tokens=800,
            temperature=0.2,
            max_iterations=3,
        )
        logger.info("ExecutorAgent tool_records: %s", [r["name"] for r in tool_records])

        # 向 SSE 队列发送工具调用事件
        if event_queue is not None and tool_records:
            for rec in tool_records:
                event_queue.put({
                    "type": "tool_call",
                    "agent": "executor",
                    "tool": rec["name"],
                    "args": rec.get("args", {}),
                })

        # 优先解析 final_content 里的 JSON（模型可能在最后汇总了完整列表）
        if final_content:
            parsed = self._parse(final_content)
            if parsed:
                return parsed

        # 降级：从 execute_command 工具调用记录中提取建议
        cmd_records = [r for r in tool_records if r["name"] == "execute_command"]
        if cmd_records:
            return self._extract_from_tool_records(cmd_records, tool_records)

        return []

    def _extract_from_tool_records(self, cmd_records: list[dict], all_records: list[dict]) -> list[dict]:
        """从 execute_command 工具调用记录中提取建议列表"""
        # 先尝试 final_content 里的 JSON（模型可能在最后整理了完整列表）
        suggestions = []
        # Build from tool records as fallback
        for rec in cmd_records[:5]:
            args = rec.get("args", {})
            command = str(args.get("command", "")).strip()
            if not command:
                continue
            suggestions.append({
                "title": str(args.get("reason", command))[:60],
                "command": command,
                "explanation": str(args.get("reason", "")),
                "why": str(args.get("reason", "")),
                "risk": "需确认" if args.get("requires_confirm") else "",
                "rollback": "",
                "verify": "",
            })
        return suggestions

    def _generate_plain(self, user_content: str) -> str:
        return self._llm(user_content, max_tokens=600, temperature=0.2)

    def _parse(self, text: str) -> list[dict]:
        m = _JSON_ARRAY_RE.search(text)
        if m:
            text = m.group(0)
        try:
            data = json.loads(text)
        except Exception:
            return []
        if not isinstance(data, list):
            return []
        out = []
        for item in data[:5]:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "")).strip()
            command = str(item.get("command", "")).strip()
            if not title or not command:
                continue
            out.append({
                "title": title,
                "command": command,
                "explanation": str(item.get("explanation", "")).strip(),
                "why": str(item.get("why", "")).strip(),
                "risk": str(item.get("risk", "")).strip(),
                "rollback": str(item.get("rollback", "")).strip(),
                "verify": str(item.get("verify", "")).strip(),
            })
        return out
