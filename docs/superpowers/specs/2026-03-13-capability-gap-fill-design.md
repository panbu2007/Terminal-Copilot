# Design Spec: Capability Gap Fill
**Date:** 2026-03-13
**Branch:** dev/0310
**Status:** Approved

---

## Background

Terminal Copilot already has the structural skeleton for four advanced capabilities—DAG plan execution, multi-agent orchestration, hallucination grounding, and post-execution audit—but each is partially implemented. This spec closes the remaining gaps (excluding minimum-privilege audit).

### Gap Summary

| Gap | Current State | Target |
|-----|--------------|--------|
| True DAG branching | Linear chain only (`n0→n1→n2→end`) | Conditional branch nodes + failure edges |
| Multi-Agent for rule paths | Only fires on zero-rule-match | Async citation/alignment enhancement for rule-match paths |
| Hallucination detection | Syntax + RAG citation check only | LLM semantic intent-vs-command alignment |
| SafetyAgent depth | Post-exec counting; no LLM | LLM pre-audit of full plan before execution |

---

## Architecture: Complete Data Flow

```
User Input
    │
    ▼
planner.suggest(req)  ←  Rules engine (sync, ~ms)
    │
    ├─ Rules matched ──→ CommandSuggestions (return immediately)
    │
    └─ No rules matched → OrchestratorAgent (sync) → CommandSuggestions

    ▼
main.py  /api/suggest/stream  [SSE endpoint only]
    │
    ├─ Call planner.suggest(req) → rule suggestions
    ├─ Stream rule suggestions to client immediately
    └─ If llm_enabled and event_queue is not None:
        Submit background ThreadPoolExecutor task:
            ├─ RAGAgent.retrieve(intent) → updated citations per suggestion
            └─ grounding.async_alignment_check(intent, suggestions) → alignment scores
        Each result pushed as SSE event to existing event_queue

    ▼
POST /api/plan/generate  (PlanGenerateRequest: intent + suggestions)
    │
    ├─ If suggestions non-empty:
    │   └─ build_execution_plan(intent, suggestions)
    │       ├─ Port-in-use scenario → branch DAG (condition node + failure edge)
    │       └─ All other scenarios → existing linear chain
    │
    ├─ If suggestions empty and intent non-empty and llm_enabled:
    │   └─ ExecutorAgent.generate_dag(intent) → ExecutionPlan | None
    │       ├─ Success → use LLM DAG
    │       └─ None (malformed after retry) → build_execution_plan(intent, []) → minimal plan
    │
    ├─ SafetyAgent.pre_audit(plan, timeout=8s) → plan.pre_audit
    │   └─ Timeout / LLM unavailable → plan.pre_audit = fallback_pass_dict
    │
    └─ Return ExecutionPlan (with pre_audit field)

    ▼
POST /api/plan/{id}/execute  →  SSE stream
    │
    ├─ BFS DAG traversal (unchanged — success/failure edge routing already works)
    ├─ node_start / node_done / need_approval (unchanged)
    └─ On completion → summarize_execution_audit() → audit_complete (unchanged)
```

---

## Backend Changes

### 1. `models.py` — Minimal additions

```python
# ExecutionPlan: add optional pre_audit field
pre_audit: dict | None = None

# CommandSuggestion: add alignment fields
alignment: str = ""         # "ok" | "warn" | "mismatch"
alignment_reason: str = ""
```

No breaking changes — all new fields are optional with defaults.

### 2. `grounding.py` — LLM alignment check

New function `async_alignment_check(intent: str, suggestions: list[CommandSuggestion]) -> list[CommandSuggestion]`:

- Builds a single prompt: "Intent is X. For each command below, is it aligned? Return JSON array: [{id, alignment, reason}] where alignment is ok/warn/mismatch."
- Parses LLM JSON response; updates `suggestion.alignment` and `suggestion.alignment_reason` in-place by matching `id`
- Returns the updated list; the function does NOT push SSE — the caller in `main.py` is responsible for event dispatch
- Falls back gracefully (leaves fields empty, no exception) if LLM is unavailable or response is malformed

Design principle: `grounding.py` is SSE-agnostic and has no import of Queue or main.

### 3. `planner.py` — One change only

**`build_execution_plan()` — branch DAG for port-in-use scenario**

For the port-in-use scenario (detected by checking if any suggestion has id starting with `intent-port-` or command contains `ss -ltnp`/`netstat`/`lsof` and intent mentions `8000`), generate a branching DAG using success/failure edges directly on the command node:

```
n0 (diagnose: Analyze Intent)
  └─[success]→ n1 (command: ss -ltnp | grep :8000, risk=safe)
                  ├─[success]→ n2 (command: ps -fp <PID> — 查看占用进程详情, risk=safe)
                  │               └─[success]→ n3 (human: 确认是否终止该进程?)
                  │                               └─[success]→ n4 (command: kill <PID>, risk=warn)
                  │                                               └─[success]→ n5 (verify: ss -ltnp | grep :8000)
                  │                                                               └─[success]→ n6 (end)
                  └─[failure]→ n6 (end: 端口空闲，无需处理)
```

Rationale:
- `ss -ltnp | grep :8000` exits 0 when the port is occupied (grep found a match), non-zero when the port is free. The BFS engine routes `success`/`failure` edges based on the preceding node's status, natively encoding the branch.
- n2 (`ps -fp`) is read-only and lets the user see what process is running before deciding to kill.
- n3 (`type="human"`) causes the BFS executor to pause and emit a `need_approval` SSE event. The user must explicitly approve before n4 executes. If the user skips n3, the kill is never run.
- n4 (`risk=warn`) would also trigger `needs_approval` independently via the existing policy check, providing a second confirmation layer.

**No `condition` node type is used** in hand-crafted plans. For LLM-generated plans (`generate_dag()`), the prompt instructs the LLM to place `success`/`failure` edges on command nodes rather than inserting intermediate condition nodes. Condition nodes that appear in LLM output are treated as no-ops (no command → the existing `_execute_node()` fallthrough already marks them `passed`); they function as visual-only labels in the DAG graph.

No change to `suggest()` — the async enhancement trigger lives entirely in `main.py` (see Section 7).

All other scenarios (docker-mirror, git-typo, generic) keep the existing linear chain logic unchanged.

### 4. `agents/executor_agent.py` — DAG output mode

New method `generate_dag(intent: str, platform: str | None = None) -> ExecutionPlan | None`:

**Prompt schema:**
```
Return a JSON object representing an execution plan:
{
  "nodes": [{"id": str, "type": "diagnose|command|condition|verify|rollback|end",
              "title": str, "command": str, "risk_level": "safe|warn|block", "description": str}],
  "edges": [{"source_id": str, "target_id": str, "condition": "success|failure|always", "label": str}]
}
No markdown, no explanation. JSON only.
```

**Retry logic:**
1. Call LLM, attempt `json.loads()` + Pydantic validation
2. If validation fails: retry once with: `"Your previous response had this error: <error_message>. Return corrected JSON only."`
3. If retry also fails: `return None`

Caller (`main.py`) falls back to `build_execution_plan(intent, [])` when `None` is returned.

### 5. `agents/safety_agent.py` — Plan pre-audit

New method `pre_audit(plan: ExecutionPlan, *, timeout: float = 8.0) -> dict`:

**Prompt structure:**
```
Audit this execution plan. Intent: {plan.intent}
Nodes: [{id, title, command, risk_level, type}...]
Edges: [{source_id, target_id, condition}...]

Evaluate: step ordering, rollback coverage for warn/block nodes, whether high-risk commands
have a preceding verify/diagnose node, intent alignment.

Return JSON only:
{"severity": "pass|warn|fail", "summary": str,
 "findings": [{"severity": "pass|warn|fail|info", "title": str, "message": str}],
 "recommendations": [str]}
```

**Implementation notes:**
- Run LLM call inside `concurrent.futures.ThreadPoolExecutor` with `future.result(timeout=timeout)` to enforce the 8-second limit
- Parse response strictly: validate `findings` is a list; if empty or missing, append a default `{"severity":"info","title":"审计完成","message":"无异常发现"}` entry before accessing `findings[0]`
- `summary` field: use `result.get("summary") or findings[0]["message"]` — prefer the LLM-provided top-level summary; fall back to first finding's message if summary is absent or empty
- Fallback on any exception (timeout, parse error, LLM unavailable):
  ```python
  return {"severity": "pass", "summary": "预审跳过（LLM 不可用）", "findings": [], "recommendations": []}
  ```

### 6. `plan_executor.py` — No changes required

`condition` node type already falls through the existing no-command path in `_execute_node()`:

```python
else:
    # No command — informational node, mark passed
    return "passed"
```

Since hand-crafted plans no longer use condition nodes (branching is encoded on command node edges), and LLM-generated condition nodes are treated as visual-only no-ops, no code changes to `plan_executor.py` are needed.

### 7. `main.py` — Wiring

**`/api/suggest/stream` only (non-stream endpoint unchanged):**

After `planner.suggest(req)` returns rule suggestions, if `llm_enabled` and the stream's `event_queue` is not None:

```python
# Only fire for rule-matched paths (suggestions already populated)
if suggestions and llm_enabled and event_queue is not None:
    _ENHANCE_POOL.submit(
        _run_enhancement, intent, list(suggestions), event_queue
    )
```

`_run_enhancement(intent, suggestions, event_queue)` runs in background thread:
```python
citations = []
updated = list(suggestions)

with ThreadPoolExecutor(max_workers=2) as pool:
    rag_future = pool.submit(rag_agent.retrieve, intent, 3)
    align_future = pool.submit(grounding.async_alignment_check, intent, suggestions)

    # Retrieve each result independently — one failure must not block the other
    try:
        citations = rag_future.result(timeout=10)
    except Exception:
        pass  # citations stays []

    try:
        updated = align_future.result(timeout=10)
    except Exception:
        pass  # updated stays original suggestions

# Push alignment events
for s in updated:
    if s.alignment:
        event_queue.put({"type": "alignment_update",
                         "suggestion_id": s.id,
                         "alignment": s.alignment,
                         "alignment_reason": s.alignment_reason})

# Push citation enhancement events
for s in suggestions:
    extra = [c for c in citations if c not in s.citations][:2]
    if extra:
        event_queue.put({"type": "agent_enhancement",
                         "suggestion_id": s.id,
                         "citations": [c.model_dump() for c in extra],
                         "confidence": s.confidence,
                         "confidence_label": s.confidence_label})
```

`_ENHANCE_POOL` is a module-level `ThreadPoolExecutor(max_workers=4)` in `main.py`.

**`/api/plan/generate`:**

```python
if req.suggestions:
    plan = build_execution_plan(intent=req.intent, suggestions=req.suggestions)
elif req.intent and llm_enabled:
    plan = executor_agent.generate_dag(req.intent, platform=req.platform)
    if plan is None:
        plan = build_execution_plan(intent=req.intent, suggestions=[])
else:
    plan = build_execution_plan(intent=req.intent, suggestions=[])

plan.pre_audit = safety_agent.pre_audit(plan, timeout=8.0)
# Store plan AFTER pre_audit is set so _PLAN_STORE contains the complete plan
_PLAN_STORE[plan.id] = plan
return PlanGenerateResponse(session_id=..., plan=plan)
```

---

## SSE Event Payload Schemas

All new SSE events have a `type` field for routing. Existing events are unchanged.

### `alignment_update`
```json
{
  "type": "alignment_update",
  "suggestion_id": "intent-port-linux",
  "alignment": "ok",
  "alignment_reason": "命令与查看端口占用的意图一致"
}
```

### `agent_enhancement`
```json
{
  "type": "agent_enhancement",
  "suggestion_id": "intent-port-linux",
  "citations": [
    {"title": "Linux 端口占用排查", "snippet": "使用 ss -ltnp...", "source": ""}
  ],
  "confidence": "high",
  "confidence_label": "✓ RAG验证"
}
```

Frontend identifies the suggestion card via `suggestion_id` matching the card's `data-suggestion-id` attribute (already present in app.js suggestion card rendering).

---

## Frontend Changes (`app.js` only)

### New SSE event handlers

Add to the existing SSE event consumer (the `switch(event.type)` or `if` chain):

```javascript
case 'alignment_update': {
  const card = document.querySelector(`[data-suggestion-id="${payload.suggestion_id}"]`);
  if (!card) break;
  const badge = card.querySelector('.confidence-badge') || card.querySelector('.alignment-badge');
  // Add/update alignment indicator: ok=✓green, warn=⚠yellow, mismatch=✗red
  // Tooltip on hover shows alignment_reason
  break;
}
case 'agent_enhancement': {
  const card = document.querySelector(`[data-suggestion-id="${payload.suggestion_id}"]`);
  if (!card) break;
  // Update citations list and confidence badge in-place
  break;
}
```

### Pre-audit summary in plan view

In `renderPlan()` (~line 1123): after graph renders, check `plan.pre_audit`:
- If present and `findings.length > 0` → insert summary card below graph container
- Reuse existing `audit-finding` CSS classes (no new styles needed)
- `severity=pass` → green, `warn` → yellow, `fail` → red
- Expandable `findings` list via click toggle

Upgrade `planPreAuditEl` (currently shows only numeric counts at ~line 1037) to render `plan.pre_audit.summary` text in addition to the count line.

### No changes needed

- `PlanGraphRenderer.nodeColors()` already handles `condition` type (yellow diamond, 164×120)
- Edge label rendering already uses `edge.label || edge.condition`
- `renderAuditReport()` post-execution flow unchanged

---

## Error Handling & Fallbacks

| Failure scenario | Fallback |
|----------------|---------|
| LLM unavailable (alignment check) | `alignment`/`alignment_reason` fields remain empty; no SSE events pushed |
| LLM alignment response malformed | Same as above; silent fail |
| LLM `generate_dag()` malformed after retry | `generate_dag()` returns `None`; `main.py` calls `build_execution_plan(intent, [])` |
| LLM `pre_audit()` timeout (>8s) or error | `plan.pre_audit = {"severity":"pass","summary":"预审跳过（LLM 不可用）","findings":[],"recommendations":[]}` |
| `pre_audit` LLM returns empty findings list | Append default `{"severity":"info","title":"审计完成","message":"无异常发现"}` before use |
| Background enhancement thread crashes | Exception logged; no SSE events; UI stable with rule suggestions |
| Enhancement fires on non-stream endpoint | Cannot happen — trigger is gated on `event_queue is not None` |

---

## Out of Scope

- Minimum-privilege audit (kill -9 vs kill -15, sudo necessity) — explicitly excluded per user request
- Embedding-based hallucination detection — deferred
- Execution-time LLM commentary on individual nodes — deferred
- LLM enhancement for the non-streaming `/api/suggest` endpoint — no SSE queue available

---

## Files Modified

| File | Change type |
|------|------------|
| `backend/app/models.py` | Add 3 optional fields to `ExecutionPlan` and `CommandSuggestion` |
| `backend/app/grounding.py` | Add `async_alignment_check()` |
| `backend/app/planner.py` | Branch DAG builder for port-in-use scenario only |
| `backend/app/agents/executor_agent.py` | Add `generate_dag()` method with retry |
| `backend/app/agents/safety_agent.py` | Add `pre_audit()` method with timeout |
| `backend/app/plan_executor.py` | No changes — condition nodes already handled by no-command fallthrough |
| `backend/app/main.py` | Async enhancement trigger on stream endpoint + plan/generate wiring |
| `frontend/static/app.js` | Handle 2 new SSE events + render `plan.pre_audit` |
