from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from queue import Queue
from typing import Callable

from ..models import Citation, CommandSuggestion, RiskLevel
from .diag_agent import DiagAgent
from .executor_agent import ExecutorAgent
from .rag_agent import RAGAgent
from .safety_agent import SafetyAgent

logger = logging.getLogger("terminal_copilot.orchestrator")

# 全局复用 Agent 实例（无状态，线程安全）
_diag = DiagAgent()
_rag = RAGAgent()
_executor = ExecutorAgent()
_safety = SafetyAgent()


class OrchestratorAgent:
    """主控 Agent：任务理解、拆解、并行调度、结果聚合

    架构流程：
    用户输入 → 并行(DiagAgent, RAGAgent) → ExecutorAgent → SafetyAgent → 建议输出
    """

    name = "orchestrator"

    def process(
        self,
        *,
        user_intent: str,
        platform: str | None,
        last_stdout: str = "",
        last_stderr: str = "",
        last_exit_code: int | None = None,
        event_queue: Queue | None = None,
        conversation_messages: list[dict] | None = None,
    ) -> list[CommandSuggestion]:
        """主入口：协调各 Agent 生成建议列表。

        event_queue: 可选的线程安全队列，用于向 SSE 端点推送实时进度事件。
        """

        def emit(agent: str, status: str, message: str) -> None:
            if event_queue is not None:
                event_queue.put({"type": "agent_progress", "agent": agent, "status": status, "message": message})
            logger.info("[%s] %s: %s", agent, status, message)

        emit("orchestrator", "start", f"正在分析意图：{user_intent[:40]}")

        # Step 1: 并行调度 DiagAgent + RAGAgent
        diag_result: dict = {}
        rag_citations: list = []

        emit("diag", "start", "分析错误输出...")
        emit("rag", "start", "检索知识库...")

        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="agent") as pool:
            futures = {
                pool.submit(_diag.diagnose, user_intent, last_stderr, last_exit_code): "diag",
                pool.submit(_rag.retrieve, user_intent, 3): "rag",
            }
            for future in as_completed(futures):
                key = futures[future]
                try:
                    result = future.result(timeout=15)
                    if key == "diag":
                        diag_result = result
                        err_type = diag_result.get("error_type") or "无错误"
                        emit("diag", "done", f"诊断完成: {err_type}")
                    else:
                        rag_citations = result
                        emit("rag", "done", f"找到 {len(rag_citations)} 篇相关文档")
                except Exception as e:
                    emit(key, "error", f"失败: {e}")

        # Step 2: ExecutorAgent 生成命令建议（支持 Function Calling）
        emit("executor", "start", "Function Calling：调用工具生成命令建议...")
        raw_suggestions = _executor.generate(
            user_intent=user_intent,
            platform=platform,
            diag=diag_result,
            citations=rag_citations,
            last_stdout=last_stdout,
            last_stderr=last_stderr,
            event_queue=event_queue,
            conversation_messages=conversation_messages,
        )
        emit("executor", "done", f"生成 {len(raw_suggestions)} 条建议")

        if not raw_suggestions:
            emit("orchestrator", "done", "未生成建议")
            return []

        # Step 3: SafetyAgent 审查风险
        emit("safety", "start", "安全审查命令风险...")
        audited = _safety.audit(raw_suggestions)
        blocked = sum(1 for x in audited if x.get("risk_level") == "block")
        warned = sum(1 for x in audited if x.get("risk_level") == "warn")
        safety_msg = f"审查完成"
        if blocked:
            safety_msg += f"，拦截 {blocked} 条高危命令"
        if warned:
            safety_msg += f"，{warned} 条需确认"
        emit("safety", "done", safety_msg)

        # Step 4: 组装为 CommandSuggestion 模型
        suggestions = []
        for i, item in enumerate(audited):
            risk_level_str = item.get("risk_level", "safe")
            try:
                risk_level = RiskLevel(risk_level_str)
            except ValueError:
                risk_level = RiskLevel.safe

            citations = [
                Citation(title=c.title, snippet=c.snippet)
                for c in rag_citations
                if hasattr(c, "title")
            ]

            suggestions.append(
                CommandSuggestion(
                    id=f"agent-{i}",
                    title=item["title"],
                    command=item["command"],
                    explanation=item.get("explanation", ""),
                    agent="orchestrator",
                    why=item.get("why", ""),
                    risk=item.get("risk", ""),
                    rollback=item.get("rollback", ""),
                    verify=item.get("verify", ""),
                    risk_level=risk_level,
                    requires_confirmation=item.get("requires_confirmation", False),
                    tags=["agent", "orchestrator"],
                    citations=citations[:2],
                )
            )

        emit("orchestrator", "done", f"协作完成，输出 {len(suggestions)} 条建议")
        return suggestions
