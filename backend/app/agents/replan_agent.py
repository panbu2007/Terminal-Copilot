from __future__ import annotations

import concurrent.futures
import json
import re as _re
from uuid import uuid4

from .base import BaseAgent
from ..models import PlanEdge, PlanNode, RiskLevel


class ReplanAgent(BaseAgent):
    """Generate follow-up DAG nodes after a condition node fails."""

    name = "replan"
    system_prompt = (
        "You are a terminal operations planner. Given a failed condition node and its output, "
        "generate a minimal list of follow-up shell commands to resolve the problem. "
        "Return strict JSON only."
    )

    def think(self, messages):
        from .base import AgentMessage

        return AgentMessage(role=self.name, content="[]")

    def generate_extension(
        self,
        *,
        plan_intent: str,
        failed_node: PlanNode,
        stdout: str,
        stderr: str,
        existing_node_ids: set[str],
        timeout: float = 10.0,
    ) -> tuple[list[PlanNode], list[PlanEdge]]:
        try:
            from ..llm.modelscope_client import (
                modelscope_chat_completion,
                modelscope_is_configured,
            )

            if not modelscope_is_configured():
                return [], []

            prompt = (
                f"Plan intent: {plan_intent}\n"
                f"Failed condition node: {failed_node.title!r}\n"
                f"Node description: {failed_node.description or ''}\n"
                f"stdout: {(stdout or '')[:600]}\n"
                f"stderr: {(stderr or '')[:400]}\n\n"
                "Generate 2-4 follow-up shell commands to resolve or investigate the issue.\n"
                "Return JSON only:\n"
                '{"nodes":[{"title":"...","command":"...","type":"command|verify","risk_level":"safe|warn"}]}'
            )

            def _call() -> str:
                return modelscope_chat_completion(
                    messages=[
                        {"role": "system", "content": self.system_prompt},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.1,
                    max_tokens=600,
                )

            pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
            future = pool.submit(_call)
            try:
                raw = future.result(timeout=timeout)
            finally:
                pool.shutdown(wait=False, cancel_futures=True)

            match = _re.search(r"\{[\s\S]*\}", raw or "")
            if not match:
                return [], []
            data = json.loads(match.group(0))
            raw_nodes = data.get("nodes")
            if not isinstance(raw_nodes, list) or not raw_nodes:
                return [], []

            return self._build_nodes_edges(
                raw_nodes, failed_node_id=failed_node.id, existing_ids=existing_node_ids
            )
        except Exception:
            return [], []

    def _build_nodes_edges(
        self,
        raw_nodes: list[dict],
        *,
        failed_node_id: str,
        existing_ids: set[str],
    ) -> tuple[list[PlanNode], list[PlanEdge]]:
        nodes: list[PlanNode] = []
        edges: list[PlanEdge] = []

        for raw in raw_nodes:
            title = str(raw.get("title") or "").strip()
            command = str(raw.get("command") or "").strip()
            node_type = str(raw.get("type") or "command").strip()
            if node_type not in {"command", "verify", "diagnose", "rollback"}:
                node_type = "command"

            raw_risk = str(raw.get("risk_level") or "safe").strip().lower()
            risk = RiskLevel.warn if raw_risk == "warn" else RiskLevel.safe

            uid = f"rx_{failed_node_id}_{uuid4().hex[:8]}"
            while uid in existing_ids or any(n.id == uid for n in nodes):
                uid = f"rx_{failed_node_id}_{uuid4().hex[:8]}"

            nodes.append(
                PlanNode(
                    id=uid,
                    type=node_type,  # type: ignore[arg-type]
                    title=title or command[:40] or "Follow-up",
                    command=command,
                    risk_level=risk,
                    grounded=False,
                    description=f"Auto-generated follow-up for failed condition: {failed_node_id}",
                    citations=[],
                )
            )

        prev_id = failed_node_id
        for node in nodes:
            edges.append(
                PlanEdge(
                    source_id=prev_id,
                    target_id=node.id,
                    condition="always",
                    label="replan",
                )
            )
            prev_id = node.id

        return nodes, edges
