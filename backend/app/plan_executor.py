"""Plan execution engine — BFS DAG traversal with SSE event streaming."""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from queue import Queue
from typing import Any

from .agents.safety_agent import SafetyAgent
from .executor import get_executor
from .models import ExecutionPlan, PlanNode


# ── State ─────────────────────────────────────────────────────────────────────

@dataclass
class PlanExecutionState:
    plan: ExecutionPlan
    session_id: str
    cwd: str
    status: str = "pending"           # pending|running|completed|failed|interrupted
    node_statuses: dict[str, str] = field(default_factory=dict)
    node_outputs: dict[str, dict] = field(default_factory=dict)
    event_queue: Queue = field(default_factory=Queue)
    approve_events: dict[str, threading.Event] = field(default_factory=dict)
    skipped_by_user: set[str] = field(default_factory=set)
    cancel_event: threading.Event = field(default_factory=threading.Event)


_ACTIVE_PLANS: dict[str, PlanExecutionState] = {}
_AUDITOR = SafetyAgent()


# ── Public API ─────────────────────────────────────────────────────────────────

def start_plan_execution(
    plan: ExecutionPlan,
    *,
    session_id: str,
    cwd: str,
) -> PlanExecutionState:
    state = PlanExecutionState(plan=plan, session_id=session_id, cwd=cwd)
    for node in plan.nodes:
        state.node_statuses[node.id] = "pending"
        # Pre-create approve events for nodes that may need them
        state.approve_events[node.id] = threading.Event()
    _ACTIVE_PLANS[plan.id] = state
    t = threading.Thread(target=_execute_plan, args=(state,), daemon=True)
    t.start()
    return state


def approve_node(plan_id: str, node_id: str) -> bool:
    state = _ACTIVE_PLANS.get(plan_id)
    if state is None:
        return False
    ev = state.approve_events.get(node_id)
    if ev is None:
        return False
    ev.set()
    return True


def skip_node(plan_id: str, node_id: str) -> bool:
    state = _ACTIVE_PLANS.get(plan_id)
    if state is None:
        return False
    ev = state.approve_events.get(node_id)
    if ev is None:
        return False
    state.skipped_by_user.add(node_id)
    ev.set()
    return True


def cancel_plan(plan_id: str) -> bool:
    state = _ACTIVE_PLANS.get(plan_id)
    if state is None:
        return False
    state.cancel_event.set()
    return True


def get_plan_state(plan_id: str) -> PlanExecutionState | None:
    return _ACTIVE_PLANS.get(plan_id)


# ── Execution engine ───────────────────────────────────────────────────────────

def _emit(state: PlanExecutionState, evt: dict[str, Any] | None) -> None:
    state.event_queue.put(evt)


def _execute_plan(state: PlanExecutionState) -> None:  # noqa: C901
    state.status = "running"
    plan = state.plan
    nodes: dict[str, PlanNode] = {n.id: n for n in plan.nodes}

    # Build adjacency maps
    # out_edges[src] = list of (target_id, condition)
    out_edges: dict[str, list[tuple[str, str]]] = {nid: [] for nid in nodes}
    in_degree: dict[str, int] = {nid: 0 for nid in nodes}

    for e in plan.edges:
        src = e.source_id
        tgt = e.target_id
        cond = e.condition or "success"
        if src in out_edges:
            out_edges[src].append((tgt, cond))
        if tgt in in_degree:
            in_degree[tgt] = in_degree.get(tgt, 0) + 1

    # Find root nodes (zero in-degree)
    queue: list[str] = [nid for nid, deg in in_degree.items() if deg == 0]
    visited: set[str] = set()

    # BFS
    while queue:
        if state.cancel_event.is_set():
            state.status = "interrupted"
            _emit(state, {"type": "plan_done", "summary": "interrupted"})
            _emit(state, None)
            return

        node_id = queue.pop(0)
        if node_id in visited:
            continue
        visited.add(node_id)

        node = nodes.get(node_id)
        if node is None:
            continue

        node_status = _execute_node(state, node)
        state.node_statuses[node_id] = node_status

        # Enqueue successors based on edge conditions
        for (tgt, cond) in out_edges.get(node_id, []):
            if tgt in visited:
                continue
            follows = (
                cond == "always"
                or (cond in {"success", ""} and node_status == "passed")
                or (cond == "failure" and node_status == "failed")
            )
            if follows:
                queue.append(tgt)

    for nid in nodes:
        if nid in visited:
            continue
        if state.node_statuses.get(nid) in {"pending", "awaiting_approval"}:
            state.node_statuses[nid] = "skipped"
            _emit(state, {"type": "node_skipped", "node_id": nid, "reason": "unreachable"})

    # Build audit report
    total = len(nodes)
    passed = sum(1 for s in state.node_statuses.values() if s == "passed")
    failed = sum(1 for s in state.node_statuses.values() if s == "failed")
    skipped = sum(1 for s in state.node_statuses.values() if s == "skipped")

    has_fail = failed > 0
    overall = "FAIL" if has_fail else "PASS"

    node_report = []
    for nid, ns in state.node_statuses.items():
        n = nodes.get(nid)
        node_report.append({
            "node_id": nid,
            "title": n.title if n else nid,
            "status": ns,
            "risk_level": n.risk_level if n else "safe",
            "grounded": bool(n.grounded) if n else False,
            "type": n.type if n else "command",
            "output": state.node_outputs.get(nid, {}),
        })

    report = {
        "plan_id": plan.id,
        "intent": plan.intent,
        "overall": overall,
        "total": total,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "nodes": node_report,
    }
    report["analysis"] = _AUDITOR.summarize_execution_audit(report)
    _emit(state, {"type": "audit_complete", "report": report})
    _emit(state, {"type": "plan_done", "summary": overall})
    _emit(state, None)  # sentinel

    state.status = "completed" if not has_fail else "failed"
def _execute_node(state: PlanExecutionState, node: PlanNode) -> str:
    """Execute a single node; return final status string."""
    nid = node.id
    cmd = (node.command or "").strip()

    # End node: always passes silently
    if node.type == "end":
        state.node_statuses[nid] = "passed"
        return "passed"

    # Nodes requiring approval: block / human type / warn with command
    needs_approval = (
        node.risk_level == "block"
        or node.type == "human"
        or (node.risk_level == "warn" and cmd)
    )

    if needs_approval:
        state.node_statuses[nid] = "awaiting_approval"
        _emit(state, {
            "type": "need_approval",
            "node_id": nid,
            "reason": f"risk={node.risk_level} type={node.type}",
        })
        ev = state.approve_events.get(nid)
        approved = False
        if ev is not None:
            approved = ev.wait(timeout=300.0)

        if state.cancel_event.is_set():
            return "skipped"

        if nid in state.skipped_by_user:
            _emit(state, {"type": "node_skipped", "node_id": nid, "reason": "skipped_by_user"})
            return "skipped"

        if not approved:
            # Timed out or cancelled — skip the node
            _emit(state, {"type": "node_skipped", "node_id": nid, "reason": "approval_timeout"})
            return "skipped"

        # If risk==block, even after approval we don't run the command
        if node.risk_level == "block":
            _emit(state, {"type": "node_skipped", "node_id": nid, "reason": "blocked_by_policy"})
            return "skipped"

    # Execute command if present
    if cmd:
        _emit(state, {"type": "node_start", "node_id": nid, "command": cmd})
        try:
            executor = get_executor()
            result = executor.run(
                cmd,
                confirmed=True,
                cwd=state.cwd,
                session_id=state.session_id,
            )
            if result.stdout:
                _emit(state, {"type": "node_stdout", "node_id": nid, "chunk": result.stdout})

            status = "passed" if result.exit_code == 0 else "failed"
            state.node_outputs[nid] = {
                "exit_code": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
            _emit(state, {
                "type": "node_done",
                "node_id": nid,
                "status": status,
                "exit_code": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
            })
            return status
        except Exception as exc:
            _emit(state, {
                "type": "node_done",
                "node_id": nid,
                "status": "failed",
                "exit_code": -1,
                "stdout": "",
                "stderr": str(exc)[:400],
            })
            return "failed"
    else:
        # No command — informational node, mark passed
        return "passed"
