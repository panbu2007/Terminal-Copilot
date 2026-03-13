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
| Multi-Agent for rule paths | Only fires on zero-rule-match | Async parallel enhancement for all paths |
| Hallucination detection | Syntax + RAG citation check only | LLM semantic intent-vs-command alignment |
| SafetyAgent depth | Post-exec counting; no LLM | LLM pre-audit of full plan before execution |

---

## Architecture: Complete Data Flow

```
User Input
    │
    ▼
planner.suggest()  ←  Rules engine (sync, ~ms)
    │
    ├─ Rules matched ──→ CommandSuggestions (return immediately)
    │                     │
    │                     └─ Background ThreadPoolExecutor:
    │                         ├─ OrchestratorAgent → enhance citations/confidence → SSE push
    │                         └─ HallucinationChecker (LLM) → alignment scores → SSE push
    │
    └─ No rules matched → OrchestratorAgent (sync) → CommandSuggestions

    ▼
POST /api/plan/generate
    │
    ├─ build_execution_plan()
    │   ├─ Known scenarios (port-in-use, docker-mirror) → hand-crafted branch DAG
    │   └─ LLM path → ExecutorAgent.generate_dag() → parse ExecutionPlan
    │                   (malformed JSON → retry once with error context → fallback to linear)
    │
    ├─ SafetyAgent.pre_audit(plan) → LLM reviews full plan → findings → plan.pre_audit
    │
    └─ Return ExecutionPlan (with pre_audit field)

    ▼
POST /api/plan/{id}/execute  →  SSE stream
    │
    ├─ BFS DAG traversal (unchanged)
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

No breaking changes—all new fields are optional with defaults.

### 2. `grounding.py` — LLM alignment check

New function `async_alignment_check(intent: str, suggestions: list[CommandSuggestion]) -> list[CommandSuggestion]`:

- Builds a single prompt: "Intent is X. For each command below, return alignment=ok/warn/mismatch + one-sentence reason."
- Parses LLM JSON response; updates `suggestion.alignment` and `suggestion.alignment_reason` in place
- Returns the updated list; caller handles SSE push
- Falls back gracefully (no error raised) if LLM unavailable or response malformed

Design principle: `grounding.py` remains SSE-agnostic. The caller in `main.py` is responsible for pushing results to the event queue.

### 3. `planner.py` — Two changes

**① `build_execution_plan()` — branch-aware DAG for known scenarios**

For the port-in-use scenario, generate:
```
n0 (diagnose) → n1 (command: ss -ltnp) → n2 (condition: port occupied?)
    n2 --success-→ n3 (command: kill <PID>) → n4 (verify: ss check) → n5 (end)
    n2 --failure-→ n5 (end: port already free)
```

For docker-mirror and git-typo scenarios: keep linear chain (no meaningful branch applies).

For all other/LLM-generated suggestions: keep existing linear chain logic unchanged.

**② `suggest()` — async enhancement after rule match**

```python
if suggestions and llm_enabled:
    # Submit background enhancement; do NOT await
    _ENHANCEMENT_POOL.submit(_enhance_async, suggestions, intent, event_queue)
# Return rule suggestions immediately
return final
```

`_enhance_async()` runs OrchestratorAgent + `async_alignment_check()` in parallel (inner ThreadPoolExecutor), pushes `agent_enhancement` and `alignment_update` SSE events on completion.

### 4. `agents/executor_agent.py` — DAG output mode

New method `generate_dag(intent, platform, ...) -> ExecutionPlan | None`:

```
Prompt: "Return a DAG as JSON: {nodes:[{id,type,title,command,risk_level,description}], edges:[{source_id,target_id,condition,label}]}"
→ Parse response into ExecutionPlan
→ If JSONDecodeError or schema validation fails:
    retry once with: "Previous response was invalid JSON: <error>. Retry with correct schema."
→ If retry also fails: return None → caller falls back to linear chain
```

Existing `generate()` method unchanged; `generate_dag()` is called only from `build_execution_plan()` on the LLM path.

### 5. `agents/safety_agent.py` — Plan pre-audit

New method `pre_audit(plan: ExecutionPlan) -> dict`:

Prompt includes: `plan.intent` + all nodes (title, command, risk_level, type) + edges summary.

LLM evaluates:
- Step ordering correctness
- Whether high-risk commands have a preceding verify/diagnose node
- Whether rollback coverage exists for warn/block nodes
- Whether the plan aligns with the stated intent

Returns same structure as `summarize_execution_audit()`:
```python
{
    "severity": "pass" | "warn" | "fail",
    "summary": str,
    "findings": [{"severity", "title", "message"}],
    "recommendations": [str],
}
```

Falls back to `{"severity": "pass", "summary": "预审跳过（LLM 不可用）", "findings": [], "recommendations": []}` if LLM unavailable.

### 6. `main.py` — Wiring

**`/api/suggest/stream`:**
- After `planner.suggest()` returns rule suggestions, submit async enhancement task with the session's SSE event queue
- No change to response timing or structure

**`/api/plan/generate`:**
```python
plan = build_execution_plan(intent=req.intent, suggestions=req.suggestions)
plan.pre_audit = _safety.pre_audit(plan)  # blocking, but happens before response
return PlanGenerateResponse(session_id=..., plan=plan)
```

---

## Frontend Changes (`app.js` only)

### New SSE event handlers

Two new event types in the SSE stream consumer:

| Event type | Action |
|-----------|--------|
| `agent_enhancement` | Find suggestion card by id, update citations list + confidence badge |
| `alignment_update` | Find suggestion card by id, update alignment indicator (✓/⚠/✗ + reason tooltip) |

Suggestion card DOM structure unchanged; only badge/indicator content is updated in place.

### Pre-audit summary in plan view

In `renderPlan()` (line ~1123): after graph renders, check `plan.pre_audit`:
- If present → insert summary card below the graph container
- Reuse existing `audit-finding` CSS classes (no new styles needed)
- `severity=pass` → green, `warn` → yellow, `fail` → red
- Expandable `findings` list

Upgrade `planPreAuditEl` (currently shows only numeric counts) to render the full `pre_audit.summary`.

### No changes needed

- `PlanGraphRenderer.nodeColors()` already handles `condition` type (yellow diamond, 164×120)
- Edge label rendering already uses `edge.label || edge.condition`
- `renderAuditReport()` post-execution flow unchanged

---

## Error Handling & Fallbacks

| Failure scenario | Fallback |
|----------------|---------|
| LLM unavailable for alignment check | Skip silently; suggestions returned without alignment field |
| LLM DAG output malformed on retry | `build_execution_plan()` falls back to linear chain |
| LLM pre_audit fails | `plan.pre_audit = {"severity":"pass","summary":"预审跳过","findings":[],"recommendations":[]}` |
| Async enhancement thread crashes | Exception logged; SSE client receives no enhancement events; UI stays stable |

---

## Out of Scope

- Minimum-privilege audit (kill -9 vs kill -15, sudo necessity) — explicitly excluded per user request
- Embedding-based hallucination detection (Option C) — deferred
- Execution-time LLM commentary on individual nodes — deferred

---

## Files Modified

| File | Change type |
|------|------------|
| `backend/app/models.py` | Add 3 optional fields |
| `backend/app/grounding.py` | Add `async_alignment_check()` |
| `backend/app/planner.py` | Branch DAG builder + async enhancement trigger |
| `backend/app/agents/executor_agent.py` | Add `generate_dag()` method |
| `backend/app/agents/safety_agent.py` | Add `pre_audit()` method |
| `backend/app/main.py` | Wire async enhancement + pre_audit into endpoints |
| `frontend/static/app.js` | Handle 2 new SSE events + render pre_audit |
