from __future__ import annotations

import json

from .base import AgentMessage, BaseAgent


class RAGAgent(BaseAgent):
    """知识库检索 Agent：封装现有关键词 TF 检索，返回结构化引用"""

    name = "rag"
    system_prompt = ""  # 纯检索，无需 LLM

    def think(self, messages: list[AgentMessage]) -> AgentMessage:
        """从消息中提取查询词，执行检索"""
        query = next((m.content for m in reversed(messages) if m.role in {"user", "orchestrator"}), "")
        citations = self.retrieve(query)
        return AgentMessage(
            role=self.name,
            content=json.dumps([{"title": c.title, "snippet": c.snippet} for c in citations], ensure_ascii=False),
            metadata={"agent": self.name, "count": len(citations)},
        )

    def retrieve(self, query: str, limit: int = 3) -> list:
        """调用混合 RAG 检索（向量语义 + 关键词 TF，RRF 融合）；降级到纯关键词"""
        try:
            from ..rag_v2 import hybrid_retrieve
            return hybrid_retrieve(query, limit=limit)
        except Exception:
            from ..rag import retrieve as kw_retrieve
            return kw_retrieve(query, limit=limit)
