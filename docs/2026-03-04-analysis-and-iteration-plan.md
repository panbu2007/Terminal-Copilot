# Terminal Copilot — Project Analysis & Iteration Plan

**Date:** 2026-03-04
**Stage:** Pre-Finals (复赛准备)

---

## 1. Current State Audit

### 1.1 What Has Been Built (Backend — Substantial Progress)

| Module | Status | Implementation Quality |
|--------|--------|----------------------|
| **Multi-Agent Architecture** | ✅ Done | Orchestrator + DiagAgent + RAGAgent + SafetyAgent + ExecutorAgent. Parallel dispatch via ThreadPoolExecutor. BaseAgent with `_react_loop()` (ReAct pattern). |
| **Function Calling / Tool Use** | ✅ Done | 4 tools defined (search_runbook, diagnose_error, execute_command, verify_result). `modelscope_chat_with_tools()` integration. |
| **Hybrid RAG (Vector + Keyword)** | ✅ Done | rag_v2.py: ModelScope bge-small-zh-v1.5 embeddings, cosine similarity, RRF fusion. Background vector cache build. Graceful degradation to keyword-only. |
| **Anti-Hallucination (Grounding)** | ✅ Done | grounding.py: syntax check + RAG support check → confidence annotation (high/medium/low). |
| **Execution Plan DAG Model** | ✅ Done | ExecutionPlan, PlanNode, PlanEdge Pydantic models. `build_execution_plan()` in planner.py. |
| **Plan Executor Engine** | ✅ Done | plan_executor.py: BFS DAG traversal, SSE event queue, per-node approval, cancel support. |
| **Plan API Endpoints** | ✅ Done | `/api/plan/generate`, `/api/plan/{id}/execute`, `/api/plan/{id}/stream` (SSE), `/api/plan/{id}/node/{n}/approve`, `/api/plan/{id}/cancel` |
| **SSE Streaming (suggest)** | ✅ Done | `/api/suggest/stream` pushes agent_progress events in real-time. |
| **Audit Report** | ✅ Partial | plan_executor emits `audit_complete` event with per-node status. Basic structure exists but no dedicated Safety Agent post-audit analysis. |
| **Runbook Knowledge Base** | ✅ Expanded | 52 Markdown files (up from 24). Covers K8s, Nginx, MySQL, Redis, SSH, etc. |

### 1.2 What Has NOT Been Built (Frontend — Critical Gap)

| Feature | Status | Impact |
|---------|--------|--------|
| **Execution Plan Graph (D3/dagre DAG)** | ❌ Not implemented | The #1 differentiator exists only as backend JSON. Users cannot see it. |
| **PlanStreamClient (SSE consumer)** | ❌ Not implemented | Real-time agent progress never reaches the UI. |
| **Agent Collaboration Panel** | ❌ Not implemented | No visual indication of multi-agent work happening. |
| **Audit Report UI** | ❌ Not implemented | Audit data is generated but never rendered. |
| **Tab Switching (Plan Graph / Agent / Audit)** | ❌ Not implemented | Right panel is still the old timeline + suggestion cards. |
| **Node Detail Popover** | ❌ Not implemented | Cannot inspect individual plan nodes. |
| **Execution State Animations** | ❌ Not implemented | No running/passed/failed visual feedback on the graph. |
| **Quick Demo Buttons / Onboarding** | ❌ Not implemented | No guided experience for non-technical visitors. |
| **Runbook Upload UI** | ❌ Not implemented | Cannot demonstrate knowledge base customization. |
| **Confidence Labels on Cards** | ❌ Not implemented | grounding.py annotates confidence but the frontend never displays it. |

**Summary:** The backend is ~80% complete for the new architecture. The frontend is ~0% complete — it's still the original MVP interface with no visualization of the new capabilities. This means the most powerful features (execution plan graph, agent collaboration, audit reports) are invisible to users and judges.

### 1.3 Note on CLAUDE.md

CLAUDE.md describes "PlanGraphRenderer (D3.js/dagre DAG viz) + PlanStreamClient (SSE)" as existing in app.js. This is inaccurate — app.js contains 0 references to D3, dagre, PlanGraphRenderer, or PlanStreamClient. The documentation reflects planned rather than actual state.

---

## 2. Scoring Against Finals Rubric

### 2.1 General Technical Score (70 points total)

#### Scene Value (场景价值) — 20 points

| Aspect | Current State | Score |
|--------|--------------|-------|
| Pain point precision | Real pain point (AI command trust + team knowledge silos), but the product demo still looks like "another terminal AI assistant" because the differentiating features are backend-only | — |
| Demand authenticity | Enterprise audit/compliance need is genuine. However, cannot demonstrate it without the frontend. | — |
| Market potential | Unique positioning vs Claude Code/Warp if properly presented. Currently indistinguishable in demo. | — |

**Estimated Score: 12-14 / 20** (Average tier)

The backend architecture supports a compelling enterprise story, but judges evaluate what they can see and interact with. Without the execution plan graph and audit report UI, the product looks like a standard terminal chatbot.

#### Technical Foresight (技术前瞻) — 20 points

| Aspect | Current State | Assessment |
|--------|--------------|------------|
| Multi-Agent | ✅ Implemented: Orchestrator, DiagAgent, RAGAgent, SafetyAgent, ExecutorAgent with parallel dispatch | Genuine multi-agent, not fake function calls |
| Advanced RAG | ✅ Implemented: bge-small-zh-v1.5 embeddings + keyword + RRF fusion | Real hybrid retrieval |
| Function Calling | ✅ Implemented: 4 tools, ReAct loop in BaseAgent | Proper tool use pattern |
| DAG Execution Engine | ✅ Implemented: BFS traversal, SSE events, approval system | Real engineering complexity |
| Anti-Hallucination | ✅ Implemented: grounding.py with syntax + RAG confidence check | Lightweight but present |
| Fine-tuning / LoRA | ❌ Not implemented | — |

**Estimated Score: 14-16 / 20** (Good tier)

Backend architecture genuinely qualifies for "Good" tier. The multi-agent + hybrid RAG + function calling + DAG execution engine represent real engineering challenges. However, judges need to see these working visually. If the DAG graph renders live with agent animations, this could push to 17-18.

#### Tool Integration (工具整合) — 15 points

| Aspect | Current State | Assessment |
|--------|--------------|------------|
| ModelScope ecosystem usage | Uses Qwen LLM + bge-small-zh-v1.5 embeddings. Two distinct model types. | Reasonable coverage |
| Agent decision logic | Orchestrator dispatches tasks, ExecutorAgent uses function calling for autonomous tool selection | Not simple API stacking |
| Anti-hallucination | Grounding checker annotates confidence | Present but basic |
| Robustness | Graceful degradation (vector→keyword RAG, LLM→rules planner). Parallel agent execution with timeouts. | Decent |
| Complex task chains | DAG execution with conditional branching and approval gates | Advanced |

**Estimated Score: 10-12 / 15** (Good tier)

The function calling + parallel agents + hybrid RAG with degradation is genuinely "non-trivial integration." The key risk: if the SSE agent progress never shows in the frontend, judges will assume it's simple API calls.

#### User Experience (用户体验) — 15 points

| Aspect | Current State | Assessment |
|--------|--------------|------------|
| Interaction paradigm | Still: terminal input → wait → suggestion cards. No DAG graph, no agent panel, no dynamic UI. | Traditional chatbot pattern |
| UI quality | Dark terminal theme, functional but unremarkable. No animations, no transitions. | Standard |
| Imagination / surprise | The backend supports remarkable features (live DAG, audit reports) but none are visible. | Zero wow factor in current UI |
| Onboarding | None. Non-technical visitors have no entry point. | Critical for 15-point visitor vote |

**Estimated Score: 7-9 / 15** (Average tier, bordering Poor)

This is the most critical gap. The rubric explicitly rewards "Infinite UI" and "AI-driven dynamic interfaces." The DAG execution graph IS exactly that — but it doesn't exist in the frontend. Without it, the score stays in Average.

### 2.2 Track-Specific Score (赛道专属分) — 15 points

Track 1 evaluates: **business value, efficiency improvement rate, robustness, automation degree.**

| Aspect | Current State | Assessment |
|--------|--------------|------------|
| Business value | Enterprise positioning (audit, compliance, knowledge assets) is compelling in theory | Story exists but undemonstratable |
| Efficiency improvement | No quantified comparison. No guided demo to show time savings. | Missing |
| Robustness | Backend degradation paths exist. No visible robustness demo. | Hidden |
| Automation degree | Full DAG auto-execution exists in backend. Users can't see or trigger it. | Hidden |

**Estimated Score: 8-10 / 15** (Average-to-Good)

The enterprise story is strong on paper. But "Track experts" will look for demonstrated workflow transformation, not backend code architecture.

### 2.3 Visitor Vote (游客投票) — 15 points

Current product requires understanding terminal commands to use. No quick demo buttons. No onboarding. Non-technical visitors will struggle to understand the value within 30 seconds.

**Estimated Score: 4-6 / 15**

### 2.4 Total Score Estimate

| Dimension | Max | Estimate | Tier |
|-----------|-----|----------|------|
| Scene Value | 20 | 12-14 | Average |
| Technical Foresight | 20 | 14-16 | Good |
| Tool Integration | 15 | 10-12 | Good |
| User Experience | 15 | 7-9 | Average |
| Track-Specific | 15 | 8-10 | Average-Good |
| Visitor Vote | 15 | 4-6 | Poor |
| **Total** | **100** | **55-67** | **Mid-range, not competitive for top tier** |

---

## 3. Core Diagnosis

### 3.1 The Paradox: 80% Backend, 0% Frontend Visualization

The project has invested heavily in backend architecture that genuinely differentiates it from competitors. Multi-Agent orchestration, hybrid vector RAG, function calling, DAG execution engine, grounding checks — these are real technical achievements.

But none of them are visible to users or judges.

The backend returns an ExecutionPlan JSON with nodes, edges, risk levels, and grounding annotations. The plan executor emits SSE events for every agent start/done and every node execution. The audit system generates per-node reports. All of this data simply **disappears** because the frontend doesn't consume it.

**This is like building a Ferrari engine and putting it in a bicycle frame.**

### 3.2 Enterprise Differentiation: Present in Architecture, Absent in Experience

The enterprise positioning (auditable AI execution, knowledge asset management, SOP-driven workflows) is architecturally sound. But the product cannot demonstrate any of these in the current UI:

- "Auditable AI execution" — the audit report JSON is generated but never shown
- "Execution plan review before execution" — the plan DAG exists but is never rendered
- "Knowledge asset management" — 52 runbooks exist but no upload/management UI
- "Team SOP workflow" — the DAG engine supports it but users interact via a basic terminal

### 3.3 Visitor Experience: Non-Existent

The 15-point visitor vote is currently almost a write-off. A non-technical visitor sees a dark terminal and has no idea what to do. There's no guided tour, no quick demo buttons, no visual hook.

---

## 4. Iteration Plan — Priority: Surface the Backend

The strategic principle is simple: **the backend is ready; the iteration is entirely about making it visible.** No new backend features are needed. Every hour should go into frontend visualization.

### 4.1 P0 Critical — Execution Plan Graph Visualization (The Killer Feature)

**What exists:** Backend generates `ExecutionPlan` JSON with nodes (type, command, risk_level, grounded, title) and edges (source, target, condition). Plan executor runs BFS with SSE events.

**What's needed:** D3.js + dagre rendering in the right panel.

**Implementation approach:**

Add CDN scripts to index.html:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dagre-d3/0.6.4/dagre-d3.min.js"></script>
```

Core rendering class needed in app.js (~300 lines):
- `PlanGraphRenderer.render(plan)` — dagre layout → D3 SVG nodes/edges
- `PlanGraphRenderer.updateNodeStatus(nodeId, status)` — dynamic color/animation per node
- Node types: diagnose (blue), command (purple), condition (diamond/yellow), verify (green), rollback (red dashed), end (gray circle), human (orange octagon)
- Risk level: colored left bar on each node (green/yellow/red)
- Grounded label: "✅ Grounded" or "⚠️ Unverified" badge per node
- Click node → detail popover (command, risk, citation, rollback, approve/skip buttons)

Execution state animations:
- pending: semi-transparent
- running: pulsing glow border + breathing animation
- passed: green border + ✅ badge
- failed: red border + shake animation + ❌ badge
- skipped: gray + strikethrough text
- awaiting_approval: orange blink + bell icon

**Estimated effort:** 2-3 days
**Score impact:** UX +4-6, Scene Value +2-3, Track +2-3, Visitor Vote +3-4 = **~15 points total**

### 4.2 P0 Critical — SSE Stream Consumer (PlanStreamClient)

**What exists:** Backend endpoint `/api/plan/{id}/stream` emits SSE events: `node_start`, `node_done`, `node_skipped`, `need_approval`, `node_stdout`, `audit_complete`, `plan_done`.

**What's needed:** EventSource client in app.js that connects to the stream and drives PlanGraphRenderer.

```javascript
class PlanStreamClient {
    constructor(planId) { this.source = new EventSource(`/api/plan/${planId}/stream`); }
    // Listen for: node_start → highlight running
    //             node_done → highlight passed/failed
    //             need_approval → show approval popover
    //             audit_complete → render audit report
    //             plan_done → disconnect
}
```

Also consume `/api/suggest/stream` for the Agent collaboration progress panel — backend already emits `agent_progress` events with agent name, status, and message.

**Estimated effort:** 1 day
**Score impact:** Part of P0 above (enables the graph to be dynamic)

### 4.3 P0 Critical — Right Panel Tab Restructure

Replace the current static timeline with three tabs:

| Tab | Content | Auto-activates when |
|-----|---------|---------------------|
| 🗺️ Execution Plan | DAG graph + controls | Plan is generated |
| 🤖 Agents | Agent progress bars + status | User submits intent |
| 📋 Audit & History | Audit report + timeline | Execution completes |

This gives the right panel a clear purpose for each phase of the workflow.

**Estimated effort:** 0.5 day
**Score impact:** Included in P0 total above

### 4.4 P1 Important — Agent Collaboration Panel

**What exists:** `/api/suggest/stream` emits `agent_progress` events: `{"type":"agent_progress", "agent":"rag", "status":"start", "message":"检索知识库..."}`.

**What's needed:** Five agent status rows, each with:
- Icon + name + status badge (⏳ waiting / 🔄 running / ✅ done / ❌ error)
- Progress bar with shimmer animation during "running"
- One-line summary text

This makes the multi-agent architecture visible — judges can see Orchestrator dispatching to DiagAgent and RAGAgent in parallel, then SafetyAgent auditing.

**Estimated effort:** 0.5-1 day
**Score impact:** Technical Foresight +1-2, UX +1-2, Visitor Vote +1-2

### 4.5 P1 Important — Audit Report UI

**What exists:** plan_executor emits `audit_complete` event with `{plan_id, intent, overall, total, passed, failed, skipped, nodes: [{node_id, title, status, risk_level, output}]}`.

**What's needed:** Render in the Audit tab:
- Overall verdict card: ✅ PASS / ⚠️ PASS WITH WARNINGS / ❌ FAIL with color
- Per-node status list with risk badges and output excerpts
- Export buttons: JSON download, Markdown download

This is the "prove AI did the right thing" feature — the enterprise differentiator.

**Estimated effort:** 0.5 day
**Score impact:** Scene Value +2, Track +2

### 4.6 P1 Important — Confidence Labels on Suggestion Cards

**What exists:** grounding.py annotates `suggestion.confidence` and `suggestion.confidence_label`. Backend returns these fields.

**What's needed:** Display the label on each suggestion card:
- "✅ RAG验证" — green badge
- "⚠️ 未经验证" — gray badge
- "✗ 语法存疑" — red badge

Minimal code change (~10 lines in renderSuggestions()).

**Estimated effort:** 0.5 hour
**Score impact:** Tool Integration +1

### 4.7 P1 Important — Quick Demo Buttons (Visitor Entry Point)

Add a bar at the bottom of the page:

```
[🔍 查端口占用] [🐳 Docker换源] [🔧 修Git拼写] [📚 自定义场景]
```

Each button: auto-fills the terminal with a preset intent → triggers plan generation → renders DAG → auto-executes with animations.

Non-technical visitors can experience the full workflow without typing anything.

**Estimated effort:** 0.5 day
**Score impact:** Visitor Vote +4-6 (massive ROI)

### 4.8 P2 Polish — Runbook Upload UI

Add a simple modal (accessible from header "知识库管理" button):
- Upload Markdown file → POST to backend → add to RAG index
- List current documents
- Delete button

This demonstrates knowledge asset customization — the core enterprise pitch.

**Estimated effort:** 0.5-1 day
**Score impact:** Scene Value +1-2, Track +1

### 4.9 P2 Polish — Documentation & Deliverables

- ModelScope Research Article (研习社文章): architecture diagram, feature highlights, competition link, demo video
- Demo video (2-3 min): full workflow including DAG visualization and audit report
- A3 poster: product screenshot (with DAG graph), three selling points, QR code

**Estimated effort:** 1 day

---

## 5. Enterprise Differentiation Talking Points

### 5.1 The Core Story (30-second pitch)

> "Every AI terminal tool can generate commands. None of them can prove those commands are safe, grounded in your team's knowledge, and auditable. Terminal Copilot generates a visual execution plan before running anything — you see the full path, the risk at each step, and whether the AI has knowledge-base evidence. After execution, an automatic audit report records what happened and flags concerns. It's not just faster operations — it's trustworthy, traceable AI operations."

### 5.2 Answering Judge Questions

| Question | Answer |
|----------|--------|
| "How is this different from Claude Code?" | "Claude Code executes commands from generic training data. Terminal Copilot executes from **your team's Runbooks** — every suggestion shows its knowledge-base source. And before anything runs, you see the complete execution plan as a visual DAG. After execution, a Safety Agent auto-audits every step. Claude Code can't prove its commands are correct; we can." |
| "The web terminal can't operate real environments?" | "That's intentional for enterprise use. Production ops should happen through a controlled gateway — not personal CLI tools. Our web interface provides: visual plan review before execution, team-shareable session replays, per-operation audit logs, and centralized safety policies. These are impossible in a CLI tool." |
| "The knowledge base only has 52 files?" | "52 is our seed content covering the most common scenarios. The key is that organizations upload their own Runbooks — this is their operational knowledge made AI-accessible. The hybrid RAG (vector + keyword) scales to thousands of documents." |
| "What's the real enterprise scenario?" | "New SRE joins the team. Day 1, they face a port conflict. Instead of pinging Slack and Googling for 20 minutes, they type their problem. The system pulls from the team's established runbook, generates a reviewed execution plan, and auto-audits the result. The senior engineer later reviews the audit log. Knowledge transferred, risk managed, operation documented." |

### 5.3 Three Enterprise Capabilities to Highlight on Poster

```
1. 📚 Knowledge Asset Engine
   Your team's runbooks → AI-searchable, AI-executable
   Not generic AI — YOUR organization's knowledge

2. 🗺️ Visual Execution Plan (DAG)
   See the full plan before anything runs
   Review risks, branches, rollback paths
   Real-time tracking during execution

3. 🛡️ Automatic Audit
   Every operation: who, what, when, why, from which document
   Confidence scoring: Grounded vs Unverified
   Exportable compliance reports
```

---

## 6. Schedule

### 6.1 Priority Matrix

| Priority | Task | Days | Score Impact |
|----------|------|------|-------------|
| **P0** | DAG Graph Rendering (D3 + dagre + animations) | 2-3 | +12-15 across all dims |
| **P0** | SSE Stream Consumer + Tab Restructure | 1 | Enables P0 above |
| **P1** | Agent Collaboration Panel | 0.5-1 | +3-5 |
| **P1** | Audit Report UI | 0.5 | +3-4 |
| **P1** | Quick Demo Buttons | 0.5 | +4-6 (visitor vote) |
| **P1** | Confidence Labels on Cards | 0.5h | +1 |
| **P2** | Runbook Upload UI | 0.5-1 | +2-3 |
| **P2** | Article + Video + Poster | 1 | Deliverable compliance |

### 6.2 Recommended Timeline (7 days)

| Day | Focus |
|-----|-------|
| **Day 1-2** | PlanGraphRenderer: dagre layout + D3 SVG rendering + node styles + click popover |
| **Day 3** | PlanStreamClient: SSE consumer + live node status updates + execution animations |
| **Day 4** | Tab restructure + Agent panel + Audit report UI |
| **Day 5** | Quick Demo buttons + confidence labels + onboarding flow |
| **Day 6** | Runbook upload UI + full end-to-end testing + bug fixes |
| **Day 7** | Article + video + poster + deployment to ModelScope Space |

### 6.3 Minimum Viable Sprint (3 days)

If time is extremely limited, focus exclusively on making backend features visible:

| Day | Task | Why |
|-----|------|-----|
| **Day 1** | Static DAG rendering (D3 + dagre, no animations) | Makes the #1 differentiator visible |
| **Day 2** | SSE consumer + live node highlighting + audit report card | Makes it dynamic + shows audit capability |
| **Day 3** | Quick Demo buttons + Agent panel (simplified) | Visitor vote + judge impression |

---

## 7. Expected Score After Iteration

| Dimension | Max | Current | After P0+P1 | Delta |
|-----------|-----|---------|-------------|-------|
| Scene Value | 20 | 12-14 | 16-18 | +4 |
| Technical Foresight | 20 | 14-16 | 17-19 | +3 |
| Tool Integration | 15 | 10-12 | 12-13 | +1 |
| User Experience | 15 | 7-9 | 12-14 | **+5** |
| Track-Specific | 15 | 8-10 | 12-14 | +3 |
| Visitor Vote | 15 | 4-6 | 9-12 | **+6** |
| **Total** | **100** | **55-67** | **78-90** | **+20-25** |

The single highest-ROI investment is the DAG visualization. It transforms every scoring dimension simultaneously because it makes the enterprise story demonstrable, the technical architecture visible, the user experience unique, and the visitor experience accessible.
