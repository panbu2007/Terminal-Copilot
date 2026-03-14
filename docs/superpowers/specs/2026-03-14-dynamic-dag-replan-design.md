# Dynamic DAG Re-plan & Auto-run Design

**Date:** 2026-03-14
**Branch:** dev/0310
**Status:** Approved

---

## Problem

The execution plan (DAG) is a static snapshot generated before any commands run. When a `condition` node's output reveals an unexpected state (e.g., disk still ≥ 85% after cleanup), the plan ends with `plan_done` and leaves the user with no next steps. There is also no way to let safe commands run unattended when the user leaves the page.

---

## Goals

1. After a `condition` node fails, automatically extend the running DAG with LLM-generated follow-up nodes.
2. Allow users to configure an auto-run level so low-risk nodes execute without manual approval, including while the user is away.

---

## Non-Goals

- Re-planning on non-`condition` node failures (out of scope for this iteration).
- Persisting plans across server restarts (in-memory only, unchanged).
- Changing the risk classification logic in `policy.py`.

---

## Architecture

### New Component: `ReplanAgent`

**File:** `backend/app/agents/replan_agent.py`

Follows the same pattern as existing agents (`DiagAgent`, `SafetyAgent`). Stateless, instantiated once as a module-level singleton in `plan_executor.py`.

```python
class ReplanAgent(BaseAgent):
    def generate_extension(
        self,
        *,
        plan_intent: str,
        failed_node: PlanNode,
        stdout: str,
        stderr: str,
        existing_node_ids: set[str],
    ) -> tuple[list[PlanNode], list[PlanEdge]]:
        ...
```

- Calls LLM with plan intent + failed node title + stdout/stderr.
- Returns new nodes and edges to append after the failed condition node.
- On LLM unavailability or parse failure: returns `([], [])` — silent degradation, no crash.
- Node IDs are generated with a `rx_` prefix and a uuid suffix to avoid collisions with existing node IDs.

### Changes to `PlanExecutionState`

```python
@dataclass
class PlanExecutionState:
    ...
    auto_run_level: str = "none"  # "none" | "safe" | "safe_warn"
```

### Changes to `plan_executor.py`

**Module-level singleton:**
```python
_REPLANNER = ReplanAgent()
```

**BFS loop — re-plan trigger** (after `_execute_node` returns):
```python
if node.type == "condition" and node_status == "failed":
    new_nodes, new_edges = _REPLANNER.generate_extension(
        plan_intent=plan.intent,
        failed_node=node,
        stdout=state.node_outputs.get(node_id, {}).get("stdout", ""),
        stderr=state.node_outputs.get(node_id, {}).get("stderr", ""),
        existing_node_ids=set(nodes.keys()),
    )
    if new_nodes:
        _inject_extension(state, nodes, out_edges, in_degree, node_id, new_nodes, new_edges)
        _emit(state, {
            "type": "nodes_appended",
            "nodes": [n.model_dump() for n in new_nodes],
            "edges": [e.model_dump() for e in new_edges],
        })
        queue.extend([n.id for n in new_nodes if in_degree[n.id] == 0])
    else:
        _emit(state, {"type": "replan_failed", "reason": "LLM unavailable or no extension generated"})
```

**`_inject_extension` helper:** adds nodes to `nodes` dict, initialises `node_statuses` to `"pending"`, creates `approve_events`, updates `out_edges` and `in_degree`.

**Auto-run gate** in `_execute_node`:
```python
auto_approve = (
    (state.auto_run_level == "safe" and node.risk_level == "safe") or
    (state.auto_run_level == "safe_warn" and node.risk_level in {"safe", "warn"})
)
needs_approval = not auto_approve and (
    node.risk_level == "block"
    or node.type == "human"
    or (node.risk_level == "warn" and cmd)
)
```

`block` and `human` nodes are never auto-approved regardless of level.

---

## API Changes

### `POST /api/plan/{id}/execute`

Request body extended (backward-compatible, defaults to `"none"`):
```json
{
  "session_id": "...",
  "auto_run_level": "safe_warn"
}
```

### `POST /api/plan/{id}/auto-run` *(new)*

Adjust auto-run level for a running plan:
```json
{ "level": "none" | "safe" | "safe_warn" }
```

Returns `{"ok": true}` or `404` if plan not found.

### New SSE Events

| Event | Fields | Description |
|-------|--------|-------------|
| `nodes_appended` | `nodes[]`, `edges[]` | Re-plan succeeded; new nodes injected |
| `replan_failed` | `reason` | LLM unavailable or returned no usable nodes |

All existing events (`node_start`, `node_done`, `need_approval`, `node_skipped`, `audit_complete`, `plan_done`) are unchanged.

---

## Frontend Changes (`frontend/static/app.js`)

### Auto-run selector UI

A segmented control in the plan panel header:

```
自动运行：[关闭 ▾]   →   关闭 / 仅 safe / safe + warn
```

- Available before and during execution.
- Before execution: value sent with the `/execute` request.
- During execution: calls `POST /api/plan/{id}/auto-run` immediately on change; takes effect on the next node.

### `PlanStreamClient` — new SSE branches

- `nodes_appended`: calls `PlanGraphRenderer.appendNodes(nodes, edges)`.
- `replan_failed`: shows an inline notice in the plan panel: "自动扩展不可用（LLM 未配置）".

### `PlanGraphRenderer.appendNodes(nodes, edges)`

- Adds new nodes and edges to the existing dagre layout.
- New nodes rendered with a distinct highlight style (e.g., dashed border) to distinguish them from the original plan.
- Does not re-render already-completed nodes.

**Estimated additions:** ~100 lines in `app.js`.

---

## Data Flow

```
condition node fails
    └─► plan_executor calls ReplanAgent.generate_extension()
            ├─► LLM available → returns new PlanNode[], PlanEdge[]
            │       └─► _inject_extension() patches in-memory DAG
            │       └─► emit nodes_appended SSE
            │       └─► BFS queue extended → new nodes execute
            │               └─► auto_run_level checked per node
            │                       ├─► safe/warn → skip approval wait
            │                       └─► block/human → still require approval
            └─► LLM unavailable → returns ([], [])
                    └─► emit replan_failed SSE → frontend shows notice
                    └─► BFS continues with original remaining nodes
```

---

## Degradation & Safety

| Scenario | Behaviour |
|----------|-----------|
| LLM not configured | `replan_failed` emitted; plan completes normally |
| ReplanAgent raises exception | Caught, treated as empty extension |
| `block` node in appended nodes | Still requires approval (auto-run never overrides block) |
| User cancels plan mid-replan | `cancel_event` checked at next BFS iteration; LLM call may complete but result is discarded |
| New nodes have duplicate IDs | `rx_` prefix + uuid prevents collision |

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `backend/app/agents/replan_agent.py` | **New** — `ReplanAgent` class |
| `backend/app/agents/__init__.py` | Export `ReplanAgent` |
| `backend/app/plan_executor.py` | Add `_REPLANNER`, `_inject_extension`, re-plan trigger, auto-run gate |
| `backend/app/models.py` | No change (PlanNode/PlanEdge already sufficient) |
| `backend/app/main.py` | Read `auto_run_level` from execute request; add `/auto-run` route |
| `frontend/static/app.js` | Auto-run selector UI; `nodes_appended`/`replan_failed` SSE handlers; `appendNodes` method |
