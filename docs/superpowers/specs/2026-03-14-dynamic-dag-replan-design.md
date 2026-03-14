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
- Re-planning on appended condition nodes that also fail (single-level re-plan only; nested re-plan not supported).
- Persisting plans across server restarts (in-memory only, unchanged).
- Changing the risk classification logic in `policy.py`.

---

## Architecture

### New Component: `ReplanAgent`

**File:** `backend/app/agents/replan_agent.py`

Follows the same pattern as existing agents (`DiagAgent`, `SafetyAgent`). Stateless, instantiated once as a module-level singleton in `plan_executor.py`. LLM call timeout: 10 seconds; exceeding it returns `([], [])`.

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
- On LLM unavailability, timeout, or parse failure: returns `([], [])` — silent degradation, no crash.
- Node IDs use the scheme `rx_{failed_node_id}_{uuid4().hex[:8]}` to guarantee no collision across plans, nodes, and parallel calls.
- Appended nodes are always `grounded=False`, `citations=[]` (LLM-generated, not runbook-backed).
- Informational nodes (empty command) always pass immediately and are not subject to approval or auto-run rules.

### Changes to `PlanExecutionState`

```python
@dataclass
class PlanExecutionState:
    ...
    auto_run_level: str = "none"   # "none" | "safe" | "safe_warn"
    appended_nodes: list[PlanNode] = field(default_factory=list)   # for audit/SSE
    appended_edges: list[PlanEdge] = field(default_factory=list)
```

`appended_nodes` / `appended_edges` accumulate all dynamically injected nodes for the audit report and SSE serialisation.

### Changes to `plan_executor.py`

**Module-level singleton:**
```python
_REPLANNER = ReplanAgent()
```

**BFS loop — re-plan trigger** (after `_execute_node` returns):

```python
if node.type == "condition" and node_status == "failed":
    _emit(state, {"type": "replan_starting", "failed_node_id": node_id})
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

**`_inject_extension(state, nodes, out_edges, in_degree, source_node_id, new_nodes, new_edges)`**

Mutates all passed-in local BFS structures **and** the state object:

1. For each new node: add to `nodes` dict, set `state.node_statuses[n.id] = "pending"`, create `state.approve_events[n.id] = threading.Event()`.
2. For each new edge: add to `out_edges[src]`, increment `in_degree[tgt]`.
3. Append to `state.appended_nodes` and `state.appended_edges` (for audit/SSE).
4. Append to `state.plan.nodes` and `state.plan.edges` so the state object stays consistent with any external reader.

Note: `state.plan` is an in-memory Pydantic model; `.nodes` and `.edges` are regular Python lists and are mutable at runtime.

Edge wiring pattern:

```
Before:  condition_N --success--> end
         (condition_N --failure--> nothing, BFS stops here)

After _inject_extension adds new_nodes [rx_1, rx_2] and edges
[condition_N→rx_1 (always), rx_1→rx_2 (success), rx_2→end (success)]:
  condition_N --failure--> (replan trigger)
                           --> rx_1 --> rx_2 --> end
```

The new root node (`rx_1`, `in_degree == 0` after injection) is added to BFS queue.

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

`block` and `human` nodes are never auto-approved regardless of level. Changing `auto_run_level` mid-execution takes effect only for nodes not yet in `awaiting_approval` state; nodes already waiting continue to wait for manual approval.

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

```
Request:  { "level": "none" | "safe" | "safe_warn" }
200:      { "ok": true, "new_level": "safe_warn" }
400:      { "ok": false, "error": "invalid level" }
404:      { "ok": false, "error": "plan not found" }
```

### New SSE Events

| Event | Fields | Description |
|-------|--------|-------------|
| `replan_starting` | `failed_node_id` | Condition node failed; LLM re-plan in progress |
| `nodes_appended` | `nodes[]`, `edges[]` | Re-plan succeeded; new nodes injected into DAG |
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
- During execution: calls `POST /api/plan/{id}/auto-run` immediately on change; takes effect on the next unstarted node.

### `PlanStreamClient` — new SSE branches

- `replan_starting`: show a spinner/notice on the failed condition node card: "正在生成后续步骤…".
- `nodes_appended`: dismiss spinner; call `PlanGraphRenderer.appendNodes(nodes, edges)`.
- `replan_failed`: show inline notice: "自动扩展不可用（LLM 未配置）".

### `PlanGraphRenderer.appendNodes(nodes, edges)`

- Adds new nodes and edges to the existing dagre graph object.
- Calls `layout()` to recalculate positions for all nodes (existing nodes keep their relative order).
- Calls `zoomToFit()` if appended nodes extend beyond the current viewport.
- New nodes rendered with a distinct highlight style (dashed border) to distinguish them from original plan nodes.
- Already-completed nodes retain their existing status styling.

**Estimated additions:** ~110 lines in `app.js`.

---

## Data Flow

```
condition node fails
    └─► emit replan_starting SSE → frontend shows spinner
    └─► plan_executor calls ReplanAgent.generate_extension()
            ├─► LLM available → returns new PlanNode[], PlanEdge[]
            │       └─► _inject_extension() mutates nodes, out_edges,
            │               in_degree, state.appended_nodes,
            │               state.plan.nodes/edges
            │       └─► emit nodes_appended SSE → frontend updates DAG
            │       └─► BFS queue extended → new nodes execute
            │               └─► auto_run_level checked per node
            │                       ├─► safe/warn → skip approval wait
            │                       └─► block/human → still require approval
            └─► LLM unavailable / timeout → returns ([], [])
                    └─► emit replan_failed SSE → frontend shows notice
                    └─► BFS continues with original remaining nodes
```

---

## Degradation & Safety

| Scenario | Behaviour |
|----------|-----------|
| LLM not configured | `replan_failed` emitted; plan completes normally |
| ReplanAgent raises exception | Caught, treated as empty extension |
| ReplanAgent LLM call times out (10s) | Returns `([], [])`; `replan_failed` emitted |
| `block` node in appended nodes | Still requires manual approval |
| `human` node in appended nodes | Still requires manual approval |
| User cancels plan mid-replan | `cancel_event` checked at next BFS iteration; LLM result discarded |
| Appended condition node also fails | No further re-plan (single-level only); `replan_failed` not emitted, plan ends |
| Condition node has no command | stdout/stderr are empty strings; ReplanAgent uses intent + node title only |
| `auto_run_level` changed while node awaiting approval | No effect on current waiting node; applies to next node only |

---

## Files to Create / Modify

| File | Change |
|------|--------|
| `backend/app/agents/replan_agent.py` | **New** — `ReplanAgent` class |
| `backend/app/agents/__init__.py` | Export `ReplanAgent` |
| `backend/app/plan_executor.py` | Add `_REPLANNER`, `_inject_extension`, re-plan trigger in BFS, auto-run gate in `_execute_node` |
| `backend/app/models.py` | No change (PlanNode/PlanEdge already sufficient) |
| `backend/app/main.py` | Read `auto_run_level` from execute request; add `POST /api/plan/{id}/auto-run` route |
| `frontend/static/app.js` | Auto-run selector UI; `replan_starting`/`nodes_appended`/`replan_failed` SSE handlers; `appendNodes` method |
