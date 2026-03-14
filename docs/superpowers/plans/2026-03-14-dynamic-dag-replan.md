# Dynamic DAG Re-plan & Auto-run Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the plan executor so that when a `condition` node fails, a `ReplanAgent` generates follow-up nodes that are injected into the running DAG; also add a configurable `auto_run_level` that lets safe/warn nodes execute without manual approval.

**Architecture:** `ReplanAgent` (new, in `backend/app/agents/`) calls LLM with the failed node's output and returns new `PlanNode` + `PlanEdge` objects. `plan_executor.py` injects these into its in-memory BFS state and emits SSE events. The frontend adds an auto-run selector UI and handles the three new SSE events (`replan_starting`, `nodes_appended`, `replan_failed`).

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, D3.js v7, dagre, vanilla JS (no build step). ModelScope OpenAI-compatible API for LLM calls. Spec: `docs/superpowers/specs/2026-03-14-dynamic-dag-replan-design.md`.

---

## Chunk 1: Backend

### Task 1: ReplanAgent

**Files:**
- Create: `backend/app/agents/replan_agent.py`
- Modify: `backend/app/agents/__init__.py`

- [ ] **Step 1.1: Create `replan_agent.py`**

```python
# backend/app/agents/replan_agent.py
from __future__ import annotations

import concurrent.futures
import json
import re as _re
from uuid import uuid4

from .base import BaseAgent
from ..models import PlanEdge, PlanNode, RiskLevel


class ReplanAgent(BaseAgent):
    """Generates follow-up DAG nodes when a condition node fails during execution."""

    name = "replan"
    system_prompt = (
        "You are a terminal operations planner. Given a failed condition node and its output, "
        "generate a minimal list of follow-up shell commands to resolve the problem. "
        "Return strict JSON only."
    )

    def think(self, messages):
        """Required by BaseAgent interface; not used directly — call generate_extension instead."""
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
        """Call LLM to generate follow-up nodes after a condition node fails.

        Returns (new_nodes, new_edges) or ([], []) on any failure.
        """
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
            # Guarantee uniqueness against existing and already-generated ids
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

        # Wire nodes in sequence; first node connects from the failed condition node
        prev_id = failed_node_id
        for node in nodes:
            edges.append(PlanEdge(source_id=prev_id, target_id=node.id, condition="always", label="replan"))
            prev_id = node.id

        return nodes, edges
```

- [ ] **Step 1.2: Export `ReplanAgent` from `__init__.py`**

Edit `backend/app/agents/__init__.py`:

```python
from .orchestrator import OrchestratorAgent
from .replan_agent import ReplanAgent
from .tools import TOOLS

__all__ = ["OrchestratorAgent", "ReplanAgent", "TOOLS"]
```

- [ ] **Step 1.3: Verify import works**

```bash
cd /mnt/c/pb/programs/terminal_copilot
python -c "from backend.app.agents.replan_agent import ReplanAgent; a = ReplanAgent(); print('OK', a.name)"
```

Expected: `OK replan`

- [ ] **Step 1.4: Commit**

```bash
git add backend/app/agents/replan_agent.py backend/app/agents/__init__.py
git commit -m "feat: add ReplanAgent for dynamic DAG extension after condition node failure"
```

---

### Task 2: plan_executor.py changes

**Files:**
- Modify: `backend/app/plan_executor.py`

- [ ] **Step 2.1: Add `auto_run_level` and `appended_nodes/edges` to `PlanExecutionState`**

In `plan_executor.py`, find the `PlanExecutionState` dataclass and add three fields after `cancel_event`:

```python
auto_run_level: str = "none"          # "none" | "safe" | "safe_warn"
appended_nodes: list = field(default_factory=list)   # PlanNode, accumulated for audit
appended_edges: list = field(default_factory=list)   # PlanEdge, accumulated for audit
```

- [ ] **Step 2.2: Add module-level `_REPLANNER` singleton**

After the existing `_AUDITOR = SafetyAgent()` line, add:

```python
from .agents.replan_agent import ReplanAgent as _ReplanAgent
_REPLANNER = _ReplanAgent()
```

- [ ] **Step 2.3: Add `_inject_extension` helper function**

Add this function just before `_execute_plan`:

```python
def _inject_extension(
    state: PlanExecutionState,
    nodes: dict,          # local BFS nodes dict (mutated in-place)
    out_edges: dict,      # local BFS out_edges dict (mutated in-place)
    in_degree: dict,      # local BFS in_degree dict (mutated in-place)
    new_nodes: list,      # list[PlanNode]
    new_edges: list,      # list[PlanEdge]
) -> None:
    """Inject new nodes/edges into the running BFS state and the plan object."""
    import threading as _threading

    for node in new_nodes:
        nodes[node.id] = node
        in_degree[node.id] = 0
        out_edges[node.id] = []
        state.node_statuses[node.id] = "pending"
        state.approve_events[node.id] = _threading.Event()
        state.plan.nodes.append(node)

    new_node_ids = {n.id for n in new_nodes}
    for edge in new_edges:
        src = edge.source_id
        tgt = edge.target_id
        if src in out_edges:
            out_edges[src].append((tgt, edge.condition or "always"))
        # Only increment in_degree for edges between new nodes.
        # The edge from the already-visited failed condition node must NOT increment
        # in_degree, otherwise rx_1 gets in_degree=1 and is never added to the BFS queue.
        if tgt in in_degree and src in new_node_ids:
            in_degree[tgt] = in_degree.get(tgt, 0) + 1
        state.plan.edges.append(edge)

    state.appended_nodes.extend(new_nodes)
    state.appended_edges.extend(new_edges)
```

- [ ] **Step 2.4: Add the re-plan trigger in the BFS loop**

In `_execute_plan`, after the `node_status = _execute_node(state, node)` line and the existing `state.node_statuses[node_id] = node_status` line, add (before the successor-enqueue block):

```python
        # Re-plan: if a condition node failed, ask LLM for follow-up nodes
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
                _inject_extension(state, nodes, out_edges, in_degree, new_nodes, new_edges)
                _emit(state, {
                    "type": "nodes_appended",
                    "nodes": [n.model_dump() for n in new_nodes],
                    "edges": [e.model_dump() for e in new_edges],
                })
                for n in new_nodes:
                    if in_degree.get(n.id, 0) == 0 and n.id not in visited:
                        queue.append(n.id)
            else:
                _emit(state, {"type": "replan_failed", "reason": "LLM unavailable or no extension generated"})
```

- [ ] **Step 2.5: Add auto-run gate in `_execute_node`**

In `_execute_node`, replace the existing `needs_approval` assignment:

```python
    needs_approval = (
        node.risk_level == "block"
        or node.type == "human"
        or (node.risk_level == "warn" and cmd)
    )
```

with:

```python
    auto_level = state.auto_run_level
    auto_approve = (
        (auto_level == "safe" and node.risk_level == "safe")
        or (auto_level == "safe_warn" and node.risk_level in {"safe", "warn"})
    )
    needs_approval = not auto_approve and (
        node.risk_level == "block"
        or node.type == "human"
        or (node.risk_level == "warn" and cmd)
    )
```

- [ ] **Step 2.6: Verify syntax**

```bash
cd /mnt/c/pb/programs/terminal_copilot
python -c "from backend.app.plan_executor import start_plan_execution, _REPLANNER; print('OK', _REPLANNER.name)"
```

Expected: `OK replan`

- [ ] **Step 2.7: Commit**

```bash
git add backend/app/plan_executor.py
git commit -m "feat: inject ReplanAgent into plan_executor — dynamic DAG extension + auto_run_level gate"
```

---

### Task 3: main.py — API changes

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 3.1: Extend `PlanExecuteRequest` with `auto_run_level`**

Find `class PlanExecuteRequest(BaseModel):` (line ~1402) and add the new field:

```python
class PlanExecuteRequest(BaseModel):
    session_id: str | None = None
    auto_run_level: str = "none"   # "none" | "safe" | "safe_warn"
```

- [ ] **Step 3.2: Pass `auto_run_level` to `start_plan_execution`**

In `api_plan_execute`, replace:

```python
    start_plan_execution(plan, session_id=str(session.id), cwd=session.cwd)
```

with:

```python
    level = req.auto_run_level if req.auto_run_level in {"none", "safe", "safe_warn"} else "none"
    state = start_plan_execution(plan, session_id=str(session.id), cwd=session.cwd)
    state.auto_run_level = level
```

- [ ] **Step 3.3: Add `POST /api/plan/{plan_id}/auto-run` route**

Add the following after the `api_plan_execute` route (after line ~1425):

```python
class PlanAutoRunRequest(BaseModel):
    level: str  # "none" | "safe" | "safe_warn"


@app.post("/api/plan/{plan_id}/auto-run")
def api_plan_set_auto_run(plan_id: str, req: PlanAutoRunRequest) -> dict:
    if req.level not in {"none", "safe", "safe_warn"}:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=400, content={"ok": False, "error": "invalid level"})
    state = get_plan_state(plan_id)
    if state is None:
        raise HTTPException(status_code=404, detail="plan_not_found")
    state.auto_run_level = req.level
    return {"ok": True, "new_level": req.level}
```

- [ ] **Step 3.4: Start server and verify new endpoint exists**

```bash
cmd.exe /c "conda activate base && cd /d C:\\pb\\programs\\terminal_copilot && python -m uvicorn backend.app.main:app --reload --port 8000"
```

In another terminal:
```bash
curl -s http://localhost:8000/api/plan/nonexistent/auto-run \
  -X POST -H "Content-Type: application/json" \
  -d '{"level":"safe"}' | python -m json.tool
```

Expected: `{"detail": "plan_not_found"}` (404)

```bash
curl -s http://localhost:8000/api/plan/x/auto-run \
  -X POST -H "Content-Type: application/json" \
  -d '{"level":"invalid"}' | python -m json.tool
```

Expected: `{"ok": false, "error": "invalid level"}`

- [ ] **Step 3.5: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: add auto_run_level to plan execute request and POST /api/plan/{id}/auto-run route"
```

---

## Chunk 2: Frontend

### Task 4: Frontend — auto-run UI + SSE handlers + appendNodes

**Files:**
- Modify: `frontend/static/app.js`

- [ ] **Step 4.1: Add `apiPlanSetAutoRun` helper function**

Find `async function apiPlanExecute(planId)` (line ~2026) and add after it:

```javascript
async function apiPlanSetAutoRun(planId, level) {
  return postJson(`/api/plan/${encodeURIComponent(planId)}/auto-run`, { level });
}
```

- [ ] **Step 4.2: Add `auto_run_level` tracking variable**

Near the other plan state variables (around line 325 where `let currentPlan = null` lives), add:

```javascript
let currentPlanAutoRunLevel = 'none'; // "none" | "safe" | "safe_warn"
```

- [ ] **Step 4.3: Update `apiPlanExecute` to send `auto_run_level`**

Replace the existing `apiPlanExecute` function body:

```javascript
async function apiPlanExecute(planId) {
  return postJson(`/api/plan/${encodeURIComponent(planId)}/execute`, {
    session_id: getSessionId() || null,
    auto_run_level: currentPlanAutoRunLevel,
  });
}
```

- [ ] **Step 4.4: Add auto-run selector UI in `updatePlanOpBar`**

Find `function updatePlanOpBar()` (around line 1163). Near the end of the function, after the pre-audit line block, add the auto-run selector using DOM methods (no innerHTML):

```javascript
  // Auto-run selector
  let autoRunSel = document.getElementById('planAutoRunSel');
  if (!autoRunSel) {
    const container = planOpTitleEl && planOpTitleEl.parentElement;
    if (container) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;color:#94a3b8;';

      const label = document.createElement('span');
      label.textContent = '自动运行：';
      wrap.appendChild(label);

      const sel = document.createElement('select');
      sel.id = 'planAutoRunSel';
      sel.style.cssText = 'background:#1e2230;color:#e2e8f0;border:1px solid #334155;border-radius:4px;padding:2px 6px;font-size:12px;';

      const opts = [['none', '关闭'], ['safe', '仅 safe'], ['safe_warn', 'safe + warn']];
      for (const [val, lbl] of opts) {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        sel.appendChild(opt);
      }
      wrap.appendChild(sel);
      container.appendChild(wrap);

      autoRunSel = sel;
      sel.addEventListener('change', async () => {
        currentPlanAutoRunLevel = sel.value;
        if (currentPlan && currentPlan.id && currentPlanStream && currentPlanStream.source) {
          try { await apiPlanSetAutoRun(currentPlan.id, currentPlanAutoRunLevel); } catch { /* ignore */ }
        }
      });
    }
  }
  if (autoRunSel) autoRunSel.value = currentPlanAutoRunLevel;
```

- [ ] **Step 4.5: Add `appendNodes` method to `PlanGraphRenderer`**

Add this method to the `PlanGraphRenderer` class, just before the closing `}` of the class (after the `highlightEdgesFrom` method, around line 841):

```javascript
  appendNodes(newNodes, newEdges) {
    if (!this.plan || !this.svg || !this.content) return;

    // Merge into plan object so getCurrentPlanNode() finds appended nodes
    if (currentPlan) {
      currentPlan.nodes = [...(currentPlan.nodes || []), ...newNodes];
      currentPlan.edges = [...(currentPlan.edges || []), ...newEdges];
    }
    this.plan.nodes = [...(this.plan.nodes || []), ...newNodes];
    this.plan.edges = [...(this.plan.edges || []), ...newEdges];

    // Full re-layout with all nodes (existing + new)
    const width = Math.max(this.container.clientWidth || 320, 320);
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 74, marginx: 28, marginy: 28 });
    graph.setDefaultEdgeLabel(() => ({}));

    for (const node of this.plan.nodes) {
      const textWidth = Math.max(String(node.title || '').length * 8, 136);
      graph.setNode(node.id, {
        width: node.type === 'condition' ? 164 : Math.min(Math.max(textWidth + 64, 196), 290),
        height: node.type === 'condition' ? 120 : node.type === 'end' ? 82 : 104,
      });
    }
    for (const edge of this.plan.edges || []) {
      graph.setEdge(edge.source_id, edge.target_id, { label: edge.label || edge.condition || '' });
    }
    dagre.layout(graph);

    const newNodeIds = new Set(newNodes.map((n) => n.id));

    for (const node of this.plan.nodes) {
      const pos = graph.node(node.id);
      if (!pos) continue;
      if (newNodeIds.has(node.id)) {
        // Render new node with dashed border
        const colors = this.nodeColors(node.type);
        const w = pos.width;
        const h = pos.height;
        const group = this.content.append('g')
          .attr('class', 'plan-node plan-node-appended status-pending')
          .attr('transform', `translate(${pos.x - w / 2},${pos.y - h / 2})`);
        group.append('rect')
          .attr('width', w).attr('height', h).attr('rx', 10)
          .attr('fill', colors.fill)
          .attr('stroke', colors.stroke)
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '6 3');
        group.append('text')
          .attr('x', w / 2).attr('y', h / 2 - 6)
          .attr('text-anchor', 'middle').attr('fill', '#e2e8f0').attr('font-size', 12)
          .text(this.truncate(node.title || '', 24));
        group.append('text').attr('class', 'badge-icon').attr('x', w - 18).attr('y', 28)
          .attr('text-anchor', 'end').attr('fill', '#f8fafc').text('○');
        this.nodeEls.set(node.id, group);
      } else {
        // Move existing node to updated position
        const el = this.nodeEls.get(node.id);
        if (el) el.attr('transform', `translate(${pos.x - pos.width / 2},${pos.y - pos.height / 2})`);
      }
    }

    // Draw edges for new nodes
    for (const edge of newEdges) {
      const from = graph.node(edge.source_id);
      const to = graph.node(edge.target_id);
      if (!from || !to) continue;
      const group = this.content.append('g').attr('class', 'plan-edge-group');
      const x1 = from.x, y1 = from.y + from.height / 2;
      const x2 = to.x, y2 = to.y - to.height / 2;
      const midY = (y1 + y2) / 2;
      const path = group.append('path')
        .attr('d', `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`)
        .attr('fill', 'none').attr('stroke', '#7f8aa8').attr('stroke-width', 1.5)
        .attr('marker-end', 'url(#planArrow)');
      this.edgeEls.push({ source: edge.source_id, target: edge.target_id, condition: edge.condition || 'success', path, el: group });
    }

    // Update SVG height and re-fit
    const graphHeight = Math.max(360, ...this.plan.nodes.map((n) => {
      const pos = graph.node(n.id);
      return pos ? pos.y + 112 : 360;
    })) + 48;
    this.svg.attr('viewBox', `0 0 ${width} ${graphHeight}`);
    requestAnimationFrame(() => this.fit());
  }
```

- [ ] **Step 4.6: Add new SSE event handlers in `PlanStreamClient.handleEvent`**

In `handleEvent`, after the `if (payload.type === 'heartbeat') return;` line, add:

```javascript
    if (payload.type === 'replan_starting') {
      const nodeEl = this.renderer.nodeEls.get(payload.failed_node_id);
      if (nodeEl) nodeEl.select('.badge-icon').text('↻');
      writePlanTerminalLine('[REPLAN] 检测到意外结果，正在生成后续步骤…', '\x1b[33m');
      return;
    }
    if (payload.type === 'nodes_appended') {
      const newNodes = Array.isArray(payload.nodes) ? payload.nodes : [];
      const newEdges = Array.isArray(payload.edges) ? payload.edges : [];
      this.renderer.appendNodes(newNodes, newEdges);
      writePlanTerminalLine(`[REPLAN] 追加了 ${newNodes.length} 个后续节点`, '\x1b[32m');
      return;
    }
    if (payload.type === 'replan_failed') {
      writePlanTerminalLine(`[REPLAN] 自动扩展不可用：${payload.reason || 'LLM 未配置'}`, '\x1b[33m');
      return;
    }
```

- [ ] **Step 4.7: Manual verification**

Start server:
```bash
cmd.exe /c "conda activate base && cd /d C:\\pb\\programs\\terminal_copilot && python -m uvicorn backend.app.main:app --reload --port 8000"
```

Open http://localhost:8000 in browser.

**Verify auto-run selector:**
1. Generate a plan (type "服务器健康巡检" and click plan).
2. Confirm the "自动运行：关闭" dropdown appears in the plan panel header.
3. Change it to "safe + warn" — no console errors.

**Verify `nodes_appended` (with LLM configured):**
1. Set `MODELSCOPE_ACCESS_TOKEN` in environment and restart server.
2. Generate and execute a health check plan.
3. When condition node h5 triggers, observe the terminal for `[REPLAN]` lines.
4. Confirm new dashed-border nodes appear in the DAG.

**Verify degradation (without LLM):**
1. Without a token, execute a health check plan.
2. When h5 fires, terminal shows `[REPLAN] 自动扩展不可用`.
3. Plan completes normally with `plan_done`.

- [ ] **Step 4.8: Commit**

```bash
git add frontend/static/app.js
git commit -m "feat: add auto-run selector UI and replan SSE handlers in frontend"
```

---

## Final verification checklist

- [ ] `python -c "from backend.app.agents.replan_agent import ReplanAgent; ReplanAgent()"` — no error
- [ ] `python -c "from backend.app.plan_executor import _REPLANNER, _inject_extension; print('ok')"` — no error
- [ ] Server starts without error on port 8000
- [ ] `POST /api/plan/x/auto-run` with invalid level → 400
- [ ] `POST /api/plan/x/auto-run` with unknown plan_id → 404
- [ ] Plan panel shows auto-run dropdown after plan generation
- [ ] Changing dropdown during execution calls `/api/plan/{id}/auto-run` successfully
- [ ] `warn` nodes skip approval gate when `auto_run_level = "safe_warn"`
- [ ] `block` nodes always require approval regardless of level
- [ ] `replan_starting` / `nodes_appended` / `replan_failed` logged to terminal during plan execution
