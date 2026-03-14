from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

logger = logging.getLogger("terminal_copilot.agent")


@dataclass
class AgentMessage:
    """消息协议：Agent 间通信的标准格式"""

    role: str  # "orchestrator" | "diag" | "rag" | "safety" | "executor" | "user"
    content: str  # 自然语言内容或结构化 JSON 字符串
    tool_calls: list = field(default_factory=list)  # 工具调用记录
    metadata: dict = field(default_factory=dict)  # 置信度、来源等附加数据


class BaseAgent:
    """所有 Agent 的基类，定义统一接口"""

    name: str = "base"
    system_prompt: str = ""

    def think(self, messages: list[AgentMessage]) -> AgentMessage:
        """处理输入消息，返回 Agent 的响应。

        子类需覆盖此方法实现具体逻辑。
        """
        raise NotImplementedError(f"{self.__class__.__name__}.think() 未实现")

    def _llm(self, user_content: str, *, max_tokens: int = 512, temperature: float = 0.2) -> str:
        """调用 ModelScope LLM（统一入口）"""
        from ..llm.modelscope_client import modelscope_chat_completion

        return modelscope_chat_completion(
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": user_content},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )

    def _react_loop(
        self,
        user_content: str,
        *,
        tools: list[dict],
        max_tokens: int = 800,
        temperature: float = 0.2,
        max_iterations: int = 3,
    ) -> tuple[str, list[dict]]:
        """ReAct 循环：LLM 可多轮调用工具，直到给出最终答案。

        Returns (final_content, all_tool_call_records)
        """
        from ..llm.modelscope_client import modelscope_chat_with_tools
        from .tools import execute_tool

        messages: list[dict] = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": user_content},
        ]
        all_tool_records: list[dict] = []

        for iteration in range(max_iterations):
            content, tool_calls, assistant_message = modelscope_chat_with_tools(
                messages,
                tools=tools,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            if not tool_calls:
                # 模型直接返回内容，ReAct 结束
                return content, all_tool_records

            # 把模型的 tool_calls 加入 messages
            messages.append(assistant_message)

            # 执行每个工具调用，把结果回填
            for call in tool_calls:
                call_id = call.get("id", f"call_{iteration}")
                fn = call.get("function", {})
                fn_name = fn.get("name", "")
                try:
                    fn_args = json.loads(fn.get("arguments", "{}"))
                except Exception:
                    fn_args = {}

                logger.info("[%s] function_call: %s(%s)", self.name, fn_name, fn_args)
                result = execute_tool(fn_name, fn_args)
                all_tool_records.append({"name": fn_name, "args": fn_args, "result": result})

                messages.append({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": fn_name,
                    "content": result,
                })

        # 超出最大迭代，最后调用一次让模型汇总
        content, _, _ = modelscope_chat_with_tools(
            messages,
            tools=[],  # 不再提供工具，强制输出最终答案
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return content, all_tool_records
