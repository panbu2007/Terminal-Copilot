# Capability Gap Fill Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four implementation gaps — true DAG branching, async Agent enhancement for rule-match paths, LLM-based hallucination detection, and LLM pre-audit of execution plans.

**Architecture:** Rule suggestions are returned immediately on the stream endpoint; a background thread then runs RAGAgent + alignment check and pushes SSE enhancement events. For plan generation, `build_execution_plan()` gains a branch DAG for the port-in-use scenario, `ExecutorAgent.generate_dag()` outputs full DAG JSON when suggestions are empty, and `SafetyAgent.pre_audit()` audits the plan before it is returned.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, vanilla JS (no build step), existing `modelscope_chat_completion` LLM client, existing `ThreadPoolExecutor` pattern from `plan_executor.py`.

**Spec:** `docs/superpowers/specs/2026-03-13-capability-gap-fill-design.md`

---

## Chunk 1: Data Model Extensions + Alignment Check

### Task 1: Add optional fields to models.py

**Files:**
- Modify: `backend/app/models.py`

- [ ] **Step 1: Add `alignment` fields to `CommandSuggestion`**

In `backend/app/models.py`, find the `CommandSuggestion` class (around line 22) and add two fields after `confidence_label`:

```python
# 意图对齐检测（LLM 语义判断）
alignment: str = ""         # "ok" | "warn" | "mismatch"
alignment_reason: str = ""
```

- [ ] **Step 2: Add `pre_audit` field to `ExecutionPlan`**

In `backend/app/models.py`, find the `ExecutionPlan` class (around line 186) and add after `created_at`:

```python
pre_audit: dict | None = None
```

- [ ] **Step 3: Verify imports are clean**

```bash
python -c "from backend.app.models import CommandSuggestion, ExecutionPlan; s = CommandSuggestion(id='x', title='t', command='c', explanation='e'); print(s.alignment, s.alignment_reason); p = ExecutionPlan(id='1', intent='i', root_id='n0', generated_by='test', created_at='now'); print(p.pre_audit)"
```

Expected output (first line is two empty strings separated by a space, second is None):
```

None
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/models.py
git commit -m "feat: add alignment and pre_audit fields to models"
```

---

### Task 2: Add LLM alignment check to grounding.py

**Files:**
- Modify: `backend/app/grounding.py`

The existing `annotate_confidence()` checks syntax and RAG citations. We add a new function that calls the LLM to check whether each suggestion semantically aligns with the user's intent.

- [ ] **Step 1: Add the function at the end of grounding.py**

```python
def async_alignment_check(
    intent: str,
    suggestions: list[CommandSuggestion],
) -> list[CommandSuggestion]:
    """LLM 语义对齐检测：判断每条建议是否符合用户意图。

    更新每条 suggestion 的 alignment / alignment_reason 字段（原地修改）。
    无 LLM 时静默跳过，不抛出异常。
    """
    if not suggestions or not intent:
        return suggestions

    try:
        from .llm.modelscope_client import modelscope_chat_completion, modelscope_is_configured

        if not modelscope_is_configured():
            return suggestions

        items = [
            {"id": s.id, "command": s.command, "title": s.title}
            for s in suggestions
            if s.command and s.command != "(auto)"
        ]
        if not items:
            return suggestions

        prompt = (
            f"用户意图：{intent}\n"
            "以下是为该意图生成的命令建议。请判断每条命令是否与意图对齐。\n"
            "只返回严格 JSON 数组，每个元素：\n"
            '{"id": "...", "alignment": "ok|warn|mismatch", "reason": "一句话中文说明"}\n'
            "数据：\n"
            + repr(items)
        )
        raw = modelscope_chat_completion(
            messages=[
                {"role": "system", "content": "你是命令意图对齐审查员，只返回 JSON 数组。"},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=400,
        )

        import json as _json

        m = re.search(r"\[[\s\S]*\]", raw or "")
        if not m:
            return suggestions
        results = _json.loads(m.group(0))
        if not isinstance(results, list):
            return suggestions

        by_id = {r["id"]: r for r in results if isinstance(r, dict) and "id" in r}
        for s in suggestions:
            entry = by_id.get(s.id)
            if entry:
                s.alignment = str(entry.get("alignment", "")).strip()
                s.alignment_reason = str(entry.get("reason", "")).strip()
    except Exception:
        pass  # 静默失败：alignment 字段保持为空

    return suggestions
```

- [ ] **Step 2: Verify the function is importable**

```bash
python -c "from backend.app.grounding import async_alignment_check; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Verify it handles empty input without error**

```bash
python -c "
from backend.app.grounding import async_alignment_check
result = async_alignment_check('test intent', [])
print('empty ok:', result)
"
```

Expected: `empty ok: []`

- [ ] **Step 4: Commit**

```bash
git add backend/app/grounding.py
git commit -m "feat: add async_alignment_check to grounding.py"
```

---

## Chunk 2: SafetyAgent Pre-Audit

### Task 3: Add pre_audit() method to SafetyAgent

**Files:**
- Modify: `backend/app/agents/safety_agent.py`

- [ ] **Step 1: Add imports at top of safety_agent.py**

After the existing `from __future__ import annotations` (add it if missing), add:

```python
import concurrent.futures
import json as _json
import re as _re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..models import ExecutionPlan
```

- [ ] **Step 2: Add the pre_audit method inside SafetyAgent class**

Add after `summarize_execution_audit()`:

```python
    def pre_audit(self, plan: "ExecutionPlan", *, timeout: float = 8.0) -> dict:
        """执行前 LLM 预审：评估计划步骤顺序、回滚覆盖、高危节点前置验证、意图对齐。

        在 timeout 秒内完成，超时或 LLM 不可用时返回 pass 占位符。
        """
        _FALLBACK: dict = {
            "severity": "pass",
            "summary": "预审跳过（LLM 不可用）",
            "findings": [],
            "recommendations": [],
        }

        try:
            from ..llm.modelscope_client import modelscope_chat_completion, modelscope_is_configured

            if not modelscope_is_configured():
                return _FALLBACK

            nodes_summary = [
                {"id": n.id, "type": n.type, "title": n.title,
                 "command": n.command, "risk_level": n.risk_level}
                for n in (plan.nodes or [])
            ]
            edges_summary = [
                {"source": e.source_id, "target": e.target_id, "condition": e.condition}
                for e in (plan.edges or [])
            ]
            prompt = (
                f"审计以下执行计划。\n意图：{plan.intent}\n"
                f"节点：{_json.dumps(nodes_summary, ensure_ascii=False)}\n"
                f"边：{_json.dumps(edges_summary, ensure_ascii=False)}\n\n"
                "评估：1) 步骤顺序是否合理；2) warn/block 节点是否有回滚；"
                "3) 高危命令前是否有诊断/验证节点；4) 计划是否与意图对齐。\n"
                "只返回严格 JSON：\n"
                '{"severity":"pass|warn|fail","summary":"一句话总结",'
                '"findings":[{"severity":"pass|warn|fail|info","title":"...","message":"..."}],'
                '"recommendations":["..."]}'
            )

            def _call() -> str:
                return modelscope_chat_completion(
                    messages=[
                        {"role": "system", "content": "你是执行计划安全审查员，只返回 JSON。"},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.1,
                    max_tokens=600,
                )

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(_call)
                raw = future.result(timeout=timeout)

            m = _re.search(r"\{[\s\S]*\}", raw or "")
            if not m:
                return _FALLBACK
            result = _json.loads(m.group(0))
            if not isinstance(result, dict):
                return _FALLBACK

            # 确保 findings 非空，防止 findings[0] KeyError
            findings = result.get("findings") or []
            if not findings:
                findings = [{"severity": "info", "title": "审计完成", "message": "未发现异常"}]
            result["findings"] = findings

            # summary 优先用 LLM 提供的，否则用 findings[0]["message"] 兜底
            result["summary"] = result.get("summary") or findings[0].get("message", "预审完成")
            result.setdefault("recommendations", [])
            result.setdefault("severity", "pass")
            return result

        except Exception:
            return _FALLBACK
```

- [ ] **Step 3: Verify the method is importable**

```bash
python -c "from backend.app.agents.safety_agent import SafetyAgent; a = SafetyAgent(); print(hasattr(a, 'pre_audit'))"
```

Expected: `True`

- [ ] **Step 4: Verify fallback behavior (force timeout)**

```bash
python -c "
from backend.app.agents.safety_agent import SafetyAgent
from backend.app.models import ExecutionPlan, PlanNode
from datetime import datetime, timezone

plan = ExecutionPlan(id='test', intent='test intent', root_id='n0',
    generated_by='test', created_at=datetime.now(timezone.utc).isoformat(),
    nodes=[PlanNode(id='n0', title='test', command='ls')],
    edges=[])

a = SafetyAgent()
result = a.pre_audit(plan, timeout=0.001)
print('severity:', result['severity'])
print('summary:', result['summary'])
"
```

Expected:
```
severity: pass
summary: 预审跳过（LLM 不可用）
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/safety_agent.py
git commit -m "feat: add pre_audit() to SafetyAgent with LLM + timeout"
```

---

## Chunk 3: Planner Branch DAG + ExecutorAgent DAG Mode

### Task 4: Add port-in-use branch DAG to planner.py

**Files:**
- Modify: `backend/app/planner.py`

The port-in-use scenario currently generates linear suggestions. We intercept it in `build_execution_plan()` to generate a proper branching DAG.

- [ ] **Step 1: Add branch DAG helper functions before `build_execution_plan()`**

Add these two functions in `planner.py`, just before the `build_execution_plan` function definition:

```python
def _is_port_in_use_scenario(suggestions: list[CommandSuggestion], intent: str) -> bool:
    """判断是否为端口占用场景（需要生成分支 DAG）"""
    has_port_suggestion = any(
        s.id.startswith(("intent-port-", "port-linux", "port-windows", "port-mac"))
        for s in suggestions
    )
    intent_mentions_port = "8000" in (intent or "") and any(
        kw in (intent or "").lower() for kw in ("端口", "port", "占用", "listen")
    )
    return has_port_suggestion or intent_mentions_port


def _build_port_in_use_plan(intent: str, suggestions: list[CommandSuggestion]) -> ExecutionPlan:
    """为端口占用场景生成分支 DAG：
    diagnose → detect (ss/grep) → identify (ps) → human confirm → kill → verify → end
    n1 failure edge → end (端口空闲，无需处理)
    """
    # 选择平台合适的检测命令（从 suggestions 找，或 fallback）
    detect_cmd = "ss -ltnp | grep :8000"
    detect_cit: list = []
    for s in suggestions:
        if s.id.startswith(("intent-port-", "port-linux", "port-windows", "port-mac")):
            if s.command and s.command != "(auto)":
                detect_cmd = s.command
                detect_cit = list(s.citations or [])
                break

    nodes = [
        PlanNode(id="n0", type="diagnose", title="分析意图", command="",
                 risk_level=RiskLevel.safe, grounded=False,
                 description=intent or "端口占用场景"),
        PlanNode(id="n1", type="command", title="检测端口 8000 是否被占用",
                 command=detect_cmd, risk_level=RiskLevel.safe,
                 grounded=bool(detect_cit),
                 description="exit_code=0 表示端口被占用，exit_code≠0 表示端口空闲",
                 citations=detect_cit),
        PlanNode(id="n2", type="command", title="查看占用进程详情",
                 command=_materialize_plan_command(
                     "ps -p <pid>", title="查看占用进程详情", intent=intent or ""
                 ),
                 risk_level=RiskLevel.safe, grounded=False,
                 description="只读：确认是哪个进程在占用端口"),
        PlanNode(id="n3", type="human", title="确认是否终止该进程",
                 command="", risk_level=RiskLevel.warn, grounded=False,
                 description="人工审批：确认后才会执行 kill"),
        PlanNode(id="n4", type="command", title="终止占用进程",
                 command=_materialize_plan_command(
                     "kill <PID>", title="终止占用进程", intent=intent or ""
                 ),
                 risk_level=RiskLevel.warn, grounded=False,
                 rollback="重启被终止的服务（如 systemctl restart <service>）"),
        PlanNode(id="n5", type="verify", title="验证端口已释放",
                 command=detect_cmd, risk_level=RiskLevel.safe, grounded=False,
                 description="确认 8000 端口不再 LISTEN"),
        PlanNode(id="n6", type="end", title="Done", command="",
                 risk_level=RiskLevel.safe, grounded=True, description=""),
    ]

    edges = [
        PlanEdge(source_id="n0", target_id="n1", condition="success", label="next"),
        PlanEdge(source_id="n1", target_id="n2", condition="success", label="端口被占用"),
        PlanEdge(source_id="n1", target_id="n6", condition="failure", label="端口空闲"),
        PlanEdge(source_id="n2", target_id="n3", condition="success", label="next"),
        PlanEdge(source_id="n3", target_id="n4", condition="success", label="已批准"),
        PlanEdge(source_id="n4", target_id="n5", condition="success", label="next"),
        PlanEdge(source_id="n5", target_id="n6", condition="success", label="done"),
    ]

    return ExecutionPlan(
        id=str(uuid4()),
        intent=intent or "",
        nodes=nodes,
        edges=edges,
        root_id="n0",
        generated_by="planner_branch",
        created_at=datetime.now(timezone.utc).isoformat(),
    )
```

- [ ] **Step 2: Modify `build_execution_plan()` to check for port-in-use scenario**

At the very beginning of `build_execution_plan()`, before the existing `nodes: list[PlanNode] = []` line, add:

```python
    # 端口占用场景：生成分支 DAG（诊断→识别→人工确认→终止→验证）
    if _is_port_in_use_scenario(suggestions, intent):
        return _build_port_in_use_plan(intent, suggestions)
```

- [ ] **Step 3: Verify the branch DAG is generated for port-in-use intent**

```bash
python -c "
from backend.app.models import CommandSuggestion, RiskLevel
from backend.app.planner import build_execution_plan

sug = [CommandSuggestion(id='intent-port-linux', title='查看端口', command='ss -ltnp | grep :8000', explanation='test')]
plan = build_execution_plan(intent='端口 8000 被占用', suggestions=sug)
print('generated_by:', plan.generated_by)
print('nodes:', [n.id + ':' + n.type for n in plan.nodes])
failure_edges = [(e.source_id, e.target_id) for e in plan.edges if e.condition == 'failure']
print('failure edges:', failure_edges)
"
```

Expected output:
```
generated_by: planner_branch
nodes: ['n0:diagnose', 'n1:command', 'n2:command', 'n3:human', 'n4:command', 'n5:verify', 'n6:end']
failure edges: [('n1', 'n6')]
```

- [ ] **Step 4: Verify non-port scenarios still produce linear chain**

```bash
python -c "
from backend.app.models import CommandSuggestion
from backend.app.planner import build_execution_plan

sug = [CommandSuggestion(id='daemon-reload', title='重载', command='systemctl daemon-reload', explanation='e')]
plan = build_execution_plan(intent='docker 换源', suggestions=sug)
print('generated_by:', plan.generated_by)
print('nodes count:', len(plan.nodes))
"
```

Expected: `generated_by: planner` (not `planner_branch`), nodes count = 3.

- [ ] **Step 5: Commit**

```bash
git add backend/app/planner.py
git commit -m "feat: branch DAG for port-in-use scenario in build_execution_plan"
```

---

### Task 5: Add generate_dag() to ExecutorAgent

**Files:**
- Modify: `backend/app/agents/executor_agent.py`

This method is called from `main.py` when `/api/plan/generate` receives an intent but no pre-built suggestions. It asks the LLM to return a full DAG JSON, retries once on parse failure, and returns `None` on second failure.

- [ ] **Step 1: Add necessary imports at top of executor_agent.py**

Add after existing imports:

```python
from datetime import datetime, timezone
from uuid import uuid4
```

- [ ] **Step 2: Add `generate_dag()` method inside `ExecutorAgent` class**

Add after the `_parse()` method:

```python
    def generate_dag(
        self,
        intent: str,
        *,
        platform: str | None = None,
    ) -> "ExecutionPlan | None":
        """让 LLM 直接输出完整 DAG JSON，解析为 ExecutionPlan。

        解析失败时重试一次（附带错误信息），再失败返回 None。
        调用方（main.py）在收到 None 时应 fallback 到 build_execution_plan(intent, [])。
        """
        from ..models import ExecutionPlan, PlanEdge, PlanNode

        schema_hint = (
            "返回 JSON 对象（不要 markdown 代码块，不要任何文字说明）：\n"
            '{"nodes":[{"id":"n0","type":"diagnose|command|verify|rollback|end|human",'
            '"title":"...","command":"","risk_level":"safe|warn|block","description":"..."}],'
            '"edges":[{"source_id":"n0","target_id":"n1","condition":"success|failure|always","label":"..."}]}\n'
            "要求：\n"
            "- 根节点 type=diagnose，末节点 type=end\n"
            "- 用 success/failure 条件边表达分支（不要插入 condition 类型节点）\n"
            "- warn/block 节点前必须有 diagnose 或 verify 节点\n"
            "- 最多 8 个节点\n"
            f"意图：{intent}\n平台：{platform or 'linux'}"
        )

        def _try_parse(raw: str) -> "ExecutionPlan | None":
            import json as _json2
            import re as _re2

            m = _re2.search(r"\{[\s\S]*\}", raw or "")
            if not m:
                return None
            try:
                data = _json2.loads(m.group(0))
            except Exception:
                return None
            if not isinstance(data, dict):
                return None
            try:
                nodes = [PlanNode(**n) for n in data.get("nodes", [])]
                edges = [PlanEdge(**e) for e in data.get("edges", [])]
            except Exception:
                return None
            if not nodes:
                return None
            node_ids = {n.id for n in nodes}
            target_ids = {e.target_id for e in edges}
            root_candidates = [n.id for n in nodes if n.id not in target_ids]
            root_id = root_candidates[0] if root_candidates else nodes[0].id
            return ExecutionPlan(
                id=str(uuid4()),
                intent=intent,
                nodes=nodes,
                edges=edges,
                root_id=root_id,
                generated_by="executor_agent_dag",
                created_at=datetime.now(timezone.utc).isoformat(),
            )

        # 第一次尝试
        try:
            raw = self._llm(schema_hint, max_tokens=1200, temperature=0.1)
            plan = _try_parse(raw)
            if plan is not None:
                return plan
            error_msg = "Response was not valid JSON matching the schema."
        except Exception as e:
            error_msg = str(e)[:200]

        # 第二次尝试（带错误上下文）
        try:
            retry_prompt = (
                f"上次返回有误：{error_msg}\n"
                "请严格按照以下 schema 重新返回，不要任何额外文字：\n" + schema_hint
            )
            raw2 = self._llm(retry_prompt, max_tokens=1200, temperature=0.1)
            return _try_parse(raw2)
        except Exception:
            return None
```

- [ ] **Step 3: Add TYPE_CHECKING guard for ExecutionPlan**

At top of executor_agent.py, add:

```python
from __future__ import annotations
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from ..models import ExecutionPlan
```

If `from __future__ import annotations` already exists at the top, only add the TYPE_CHECKING block.

- [ ] **Step 4: Verify the method is importable**

```bash
python -c "from backend.app.agents.executor_agent import ExecutorAgent; a = ExecutorAgent(); print(hasattr(a, 'generate_dag'))"
```

Expected: `True`

- [ ] **Step 5: Commit**

```bash
git add backend/app/agents/executor_agent.py
git commit -m "feat: add generate_dag() to ExecutorAgent with retry"
```

---

## Chunk 4: main.py Wiring

### Task 6: Async enhancement on stream endpoint

**Files:**
- Modify: `backend/app/main.py`

The current `_run_orchestrator()` in the stream endpoint always runs OrchestratorAgent even when rules matched. We change it: if rules matched → send suggestions immediately → run lighter enhancement (RAG + alignment) in the same background thread → done. If no rules → run OrchestratorAgent as before.

- [ ] **Step 1: Add module-level thread pool for enhancement in main.py**

Near the top of main.py, after the existing imports, add:

```python
from concurrent.futures import ThreadPoolExecutor as _ThreadPoolExecutor
_ENHANCE_POOL = _ThreadPoolExecutor(max_workers=4, thread_name_prefix="enhance")
```

- [ ] **Step 2: Add `_run_enhancement` as a module-level function in main.py**

Add this function before `api_suggest_stream` (not nested inside it):

```python
def _run_enhancement(
    intent: str,
    suggestions: list,
    q: "Queue",
) -> None:
    """RAGAgent citation enrichment + LLM alignment check.
    Pushes agent_enhancement and alignment_update SSE events to q.
    Each future is caught independently so one failure does not block the other.
    """
    from .agents.rag_agent import RAGAgent
    from .grounding import async_alignment_check

    rag = RAGAgent()
    citations: list = []
    updated = list(suggestions)

    with _ThreadPoolExecutor(max_workers=2) as pool:
        rag_future = pool.submit(rag.retrieve, intent, 3)
        align_future = pool.submit(async_alignment_check, intent, suggestions)

        try:
            citations = rag_future.result(timeout=10)
        except Exception:
            citations = []

        try:
            updated = align_future.result(timeout=10)
        except Exception:
            updated = list(suggestions)

    # Push alignment events
    for s in updated:
        if getattr(s, "alignment", ""):
            q.put({
                "type": "alignment_update",
                "suggestion_id": s.id,
                "alignment": s.alignment,
                "alignment_reason": s.alignment_reason,
            })

    # Push citation enrichment events
    existing_by_id = {
        s.id: {(c.title, c.snippet) for c in (s.citations or [])}
        for s in suggestions
    }
    for s in suggestions:
        extra = [
            c for c in citations
            if (c.title, c.snippet) not in existing_by_id.get(s.id, set())
        ][:2]
        if extra:
            q.put({
                "type": "agent_enhancement",
                "suggestion_id": s.id,
                "citations": [c.model_dump() for c in extra],
                "confidence": getattr(s, "confidence", ""),
                "confidence_label": getattr(s, "confidence_label", ""),
            })
```

- [ ] **Step 3: Modify `_run_orchestrator()` inside `api_suggest_stream`**

Find `_run_orchestrator()` (currently lines ~617-674). Replace its entire body with:

```python
    def _run_orchestrator() -> None:
        try:
            rule_suggestions = suggest(req)
            rule_only = bool(rule_suggestions) and not any(
                "orchestrator" in (s.tags or []) for s in rule_suggestions
            )

            if rule_only:
                # 规则命中：立即发送建议，然后在同一后台线程运行增强
                session = STORE.get_or_create(req.session_id)
                from .grounding import annotate_confidence
                annotate_confidence(rule_suggestions)
                q.put({
                    "type": "suggestions",
                    "session_id": str(session.id),
                    "suggestions": [s.model_dump() for s in rule_suggestions],
                    "steps": STORE.to_dict_steps(session),
                })
                from .llm.modelscope_client import modelscope_is_configured
                if modelscope_is_configured():
                    _run_enhancement(req.last_command or "", rule_suggestions, q)
                return

            # 无规则命中：走 OrchestratorAgent
            from .agents import OrchestratorAgent
            from .llm.modelscope_client import modelscope_is_configured

            if modelscope_is_configured():
                orchestrator = OrchestratorAgent()
                agent_suggestions = orchestrator.process(
                    user_intent=req.last_command,
                    platform=req.platform,
                    last_stdout=req.last_stdout,
                    last_stderr=req.last_stderr,
                    last_exit_code=req.last_exit_code,
                    event_queue=q,
                    conversation_messages=req.conversation_messages,
                )
                final = agent_suggestions if agent_suggestions else rule_suggestions
            else:
                q.put({
                    "type": "agent_progress",
                    "agent": "orchestrator",
                    "status": "done",
                    "message": "规则引擎模式（未配置 LLM Token）",
                })
                final = rule_suggestions

            session = STORE.get_or_create(req.session_id)
            from .grounding import annotate_confidence
            annotate_confidence(final)
            q.put({
                "type": "suggestions",
                "session_id": str(session.id),
                "suggestions": [s.model_dump() for s in final],
                "steps": STORE.to_dict_steps(session),
            })
        except Exception as e:
            q.put({"type": "error", "message": str(e)[:200]})
        finally:
            q.put(None)  # 结束哨兵
```

- [ ] **Step 4: Verify main.py imports cleanly**

```bash
python -c "import backend.app.main; print('main imports OK')"
```

Expected: `main imports OK`

- [ ] **Step 5: Integration smoke test — rule suggestion still works**

Start server (separate terminal):
```bash
cmd.exe /c "conda activate base && cd /d C:\pb\programs\terminal_copilot && python -m uvicorn backend.app.main:app --reload --port 8000"
```

Then:
```bash
curl -s -X POST http://localhost:8000/api/suggest \
  -H "Content-Type: application/json" \
  -d "{\"last_command\":\"docker 换源\",\"platform\":\"linux\"}" | python -m json.tool | grep -c "title"
```

Expected: number ≥ 1.

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: async enhancement on stream endpoint; rule suggestions sent immediately"
```

---

### Task 7: Wire pre_audit and generate_dag into /api/plan/generate

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Add agent imports near the top of main.py**

After the existing import block, add:

```python
from .agents.executor_agent import ExecutorAgent as _ExecutorAgent
from .agents.safety_agent import SafetyAgent as _SafetyAgent
```

- [ ] **Step 2: Add module-level agent singletons in main.py**

After the existing `_PLAN_STORE` declaration, add:

```python
_EXECUTOR_AGENT = _ExecutorAgent()
_SAFETY_AGENT = _SafetyAgent()
```

- [ ] **Step 3: Replace the body of `api_plan_generate`**

Find the function `api_plan_generate`. Keep the session setup and STORE.add_event call, but replace the plan-building and return logic with:

```python
    # Build plan: use suggestions if provided, else try LLM DAG, else empty linear
    if req.suggestions:
        plan: ExecutionPlan = build_execution_plan(
            intent=req.intent, suggestions=req.suggestions
        )
    elif req.intent:
        from .llm.modelscope_client import modelscope_is_configured
        if modelscope_is_configured():
            plan = _EXECUTOR_AGENT.generate_dag(req.intent, platform=req.platform)
            if plan is None:
                logger.warning(
                    "generate_dag returned None for intent=%s, fallback to linear",
                    (req.intent or "")[:60],
                )
                plan = build_execution_plan(intent=req.intent, suggestions=[])
        else:
            plan = build_execution_plan(intent=req.intent or "", suggestions=[])
    else:
        plan = build_execution_plan(intent=req.intent or "", suggestions=[])

    # Pre-audit (blocking, max 8s, falls back to pass dict on any error)
    plan.pre_audit = _SAFETY_AGENT.pre_audit(plan, timeout=8.0)

    # Store AFTER pre_audit is populated so _PLAN_STORE has the complete plan
    _PLAN_STORE[plan.id] = plan

    STORE.add_event(
        session,
        kind="plan_generate",
        payload={
            "intent": (req.intent or "")[:200],
            "nodes": str(len(plan.nodes)),
            "edges": str(len(plan.edges)),
        },
    )
    return PlanGenerateResponse(session_id=session.id, plan=plan)
```

- [ ] **Step 4: Verify plan/generate works with suggestions**

With server running:
```bash
curl -s -X POST http://localhost:8000/api/plan/generate \
  -H "Content-Type: application/json" \
  -d "{\"intent\":\"docker 换源\",\"suggestions\":[{\"id\":\"s1\",\"title\":\"重载\",\"command\":\"systemctl daemon-reload\",\"explanation\":\"e\",\"agent\":\"rules\",\"risk_level\":\"safe\",\"requires_confirmation\":false,\"tags\":[],\"citations\":[]}]}" \
  | python -m json.tool | grep "generated_by"
```

Expected: `"generated_by": "planner"` (linear, since docker-mirror scenario is linear).

- [ ] **Step 5: Verify port-in-use plan generates branch DAG**

```bash
curl -s -X POST http://localhost:8000/api/plan/generate \
  -H "Content-Type: application/json" \
  -d "{\"intent\":\"端口 8000 被占用\",\"suggestions\":[{\"id\":\"intent-port-linux\",\"title\":\"查看端口\",\"command\":\"ss -ltnp | grep :8000\",\"explanation\":\"e\",\"agent\":\"rules\",\"risk_level\":\"safe\",\"requires_confirmation\":false,\"tags\":[],\"citations\":[]}]}" \
  | python -m json.tool | grep "generated_by"
```

Expected: `"generated_by": "planner_branch"`

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: wire pre_audit + generate_dag into /api/plan/generate"
```

---

## Chunk 5: Frontend SSE Handlers + Pre-Audit Rendering

### Task 8: Add data-suggestion-id to suggestion cards

**Files:**
- Modify: `frontend/static/app.js`

The SSE enhancement events use `suggestion_id` to find the right card in the DOM. Currently cards have no identifier attribute.

- [ ] **Step 1: Add `data-suggestion-id` in `renderSuggestions()`**

Find the line ~2203 where `const card = document.createElement('div')` is called inside the `for (const s of suggestions)` loop. After `card.className = 'card';`, add:

```javascript
    card.dataset.suggestionId = String(s.id || '');
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:8000`, trigger a suggestion (type `docker 换源`, press Enter). Open DevTools Elements panel, inspect a suggestion card `div.card` → confirm `data-suggestion-id` attribute is present.

- [ ] **Step 3: Commit**

```bash
git add frontend/static/app.js
git commit -m "feat: add data-suggestion-id to suggestion cards for SSE targeting"
```

---

### Task 9: Handle alignment_update and agent_enhancement SSE events

**Files:**
- Modify: `frontend/static/app.js`

The stream handler `handleChunk()` (~line 1287) currently handles `agent_progress`, `tool_call`, `suggestions`, `error`. Add two new branches.

- [ ] **Step 1: Add handlers inside `handleChunk`**

Find the `} else if (payload.type === 'tool_call') {` block (~line 1299). Add two new `else if` branches immediately after it:

```javascript
        } else if (payload.type === 'alignment_update') {
          const _sid = String(payload.suggestion_id || '');
          const _card = (suggestionsEl && _sid)
            ? suggestionsEl.querySelector('[data-suggestion-id="' + CSS.escape(_sid) + '"]')
            : null;
          if (_card && payload.alignment) {
            const _old = _card.querySelector('.alignment-badge');
            if (_old) _old.remove();
            const _badge = document.createElement('span');
            const _lvl = String(payload.alignment).trim().toLowerCase();
            const _icon = _lvl === 'ok' ? '✓' : _lvl === 'warn' ? '⚠' : '✗';
            const _color = _lvl === 'ok' ? 'high' : _lvl === 'warn' ? 'medium' : 'low';
            _badge.className = 'badge confidence-' + _color + ' alignment-badge';
            _badge.title = String(payload.alignment_reason || '');
            _badge.textContent = _icon + ' 意图对齐';
            const _row = _card.querySelector('.badge-row');
            if (_row) _row.appendChild(_badge);
          }
        } else if (payload.type === 'agent_enhancement') {
          const _sid2 = String(payload.suggestion_id || '');
          const _card2 = (suggestionsEl && _sid2)
            ? suggestionsEl.querySelector('[data-suggestion-id="' + CSS.escape(_sid2) + '"]')
            : null;
          if (_card2 && Array.isArray(payload.citations) && payload.citations.length) {
            for (const _c of payload.citations) {
              const _cite = document.createElement('div');
              _cite.className = 'explain';
              const _src = _c && _c.source ? '（' + _c.source + '）' : '';
              _cite.textContent = '依据（增强）：' + String(_c.title || '') + _src + ' - ' + String(_c.snippet || '');
              const _actions = _card2.querySelector('.actions');
              if (_actions) _card2.insertBefore(_cite, _actions);
              else _card2.appendChild(_cite);
            }
          }
        }
```

- [ ] **Step 2: Verify no JS errors on load**

Open browser DevTools console at `http://localhost:8000`. Confirm no syntax errors or runtime errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/static/app.js
git commit -m "feat: handle alignment_update and agent_enhancement SSE events"
```

---

### Task 10: Render pre_audit in plan view

**Files:**
- Modify: `frontend/static/app.js`

After `planRenderer.render()` in `renderPlan()`, check `plan.pre_audit` and render a collapsible summary below the graph.

- [ ] **Step 1: Add `renderPreAudit()` helper function**

Add this function near `renderAuditReport()` (around line 921). All dynamic text is set via `textContent` to avoid XSS:

```javascript
function renderPreAudit(preAudit) {
  // Update the planPreAuditEl counts line
  if (planPreAuditEl && currentPlan && Array.isArray(currentPlan.nodes)) {
    const warnCount = currentPlan.nodes.filter((n) => n.risk_level === 'warn').length;
    const blockCount = currentPlan.nodes.filter((n) => n.risk_level === 'block').length;
    const groundedCount = currentPlan.nodes.filter((n) => n.grounded).length;
    let countText = `预审查: ${warnCount} 个 warn，${blockCount} 个 block，${groundedCount}/${currentPlan.nodes.length} 个节点有依据`;
    if (preAudit && preAudit.summary) {
      countText += ' · ' + String(preAudit.summary);
    }
    planPreAuditEl.textContent = countText;
  }

  // Remove any previous pre-audit card
  const existing = document.getElementById('planPreAuditCard');
  if (existing) existing.remove();

  if (!preAudit || !Array.isArray(preAudit.findings) || preAudit.findings.length === 0) return;

  const card = document.createElement('div');
  card.id = 'planPreAuditCard';
  card.style.marginTop = '8px';

  const severity = String(preAudit.severity || 'pass').toLowerCase();
  const severityClass = severity === 'fail' ? 'fail' : severity === 'warn' ? 'warn' : 'info';

  // Header row
  const header = document.createElement('div');
  header.className = 'audit-finding severity-' + severityClass;

  const headerTitle = document.createElement('div');
  headerTitle.className = 'audit-finding-header';
  headerTitle.textContent = '执行前预审 · ' + String(preAudit.severity || 'pass').toUpperCase();
  header.appendChild(headerTitle);

  const headerMsg = document.createElement('div');
  headerMsg.className = 'audit-finding-msg';
  headerMsg.textContent = String(preAudit.summary || '');
  header.appendChild(headerMsg);
  card.appendChild(header);

  // Collapsible findings
  let showFindings = false;
  const toggle = document.createElement('div');
  toggle.className = 'explain';
  toggle.style.cursor = 'pointer';
  toggle.style.marginTop = '4px';

  const findingsContainer = document.createElement('div');
  findingsContainer.style.display = 'none';

  toggle.textContent = '▶ 查看 ' + preAudit.findings.length + ' 条详情';
  toggle.onclick = () => {
    showFindings = !showFindings;
    findingsContainer.style.display = showFindings ? '' : 'none';
    toggle.textContent = (showFindings ? '▼ ' : '▶ ') + '查看 ' + preAudit.findings.length + ' 条详情';
  };
  card.appendChild(toggle);

  for (const f of preAudit.findings) {
    const row = document.createElement('div');
    const fc = String(f.severity || 'info').toLowerCase();
    row.className = 'audit-finding severity-' + (fc === 'fail' ? 'fail' : fc === 'warn' ? 'warn' : 'info');

    const rowTitle = document.createElement('div');
    rowTitle.className = 'audit-finding-header';
    rowTitle.textContent = String(f.title || '');
    row.appendChild(rowTitle);

    const rowMsg = document.createElement('div');
    rowMsg.className = 'audit-finding-msg';
    rowMsg.textContent = String(f.message || '');
    row.appendChild(rowMsg);

    findingsContainer.appendChild(row);
  }
  card.appendChild(findingsContainer);

  // Insert after planGraphEl
  if (planGraphEl && planGraphEl.parentNode) {
    planGraphEl.parentNode.insertBefore(card, planGraphEl.nextSibling);
  }
}
```

- [ ] **Step 2: Call `renderPreAudit()` at end of `renderPlan()`**

Find `renderPlan()` (~line 1123). At the end of the function, before the closing `}`, add:

```javascript
  renderPreAudit((plan && plan.pre_audit) ? plan.pre_audit : null);
```

- [ ] **Step 3: Reset pre_audit card when a new plan is generated**

Find `generateExecutionPlan()` (~line 1324). After `renderAuditReport(null)`, add:

```javascript
  const _oldCard = document.getElementById('planPreAuditCard');
  if (_oldCard) _oldCard.remove();
```

- [ ] **Step 4: Verify plan view works in browser**

1. Open `http://localhost:8000`
2. Type `端口 8000 被占用` → press Enter
3. Click "生成执行计划" button
4. Open Plan panel
5. Verify: DAG shows branch structure with 7 nodes (n0–n6), n1 has two edges
6. Verify: `planPreAuditEl` shows counts + pre_audit summary text
7. Without LLM: no pre_audit card below graph (findings empty)

- [ ] **Step 5: Commit**

```bash
git add frontend/static/app.js
git commit -m "feat: render pre_audit summary card in plan view"
```

---

## Final Verification

- [ ] **End-to-end: port-in-use branch DAG executes correctly**

1. Start server
2. Open `http://localhost:8000`
3. Type `端口 8000 被占用` → Enter
4. Click "生成执行计划" → confirm DAG has branch structure
5. Click "执行计划"
6. Observe: n1 (`ss -ltnp | grep :8000`) runs
   - If port 8000 is free: n1 exits non-zero → n6 (end) reached, plan completes
   - If port 8000 is busy: n1 exits 0 → n2 runs (ps) → n3 (human: approve prompt appears)

- [ ] **End-to-end: docker mirror scenario remains linear**

1. Type `docker 换源` → Enter → Click "生成执行计划"
2. Plan is linear chain, no branching

- [ ] **End-to-end: alignment badges appear with LLM configured**

1. Configure LLM token via settings UI
2. Type `docker 换源` → Enter (stream endpoint)
3. Suggestion cards appear immediately
4. After a few seconds: `✓ 意图对齐` badge appears on relevant cards

- [ ] **Final commit**

```bash
git add -A
git commit -m "chore: capability gap fill complete"
```
