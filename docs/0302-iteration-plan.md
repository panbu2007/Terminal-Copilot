# Terminal Copilot 复赛迭代计划

## 一、战略概述

### 1.1 定位转向

| | 初赛定位（旧） | 复赛定位（新） |
|--|--------------|--------------|
| **一句话** | Web 终端智能副驾 | 终端场景的 AI 知识执行引擎——运维 SOP 智能训练与执行平台 |
| **核心价值** | 帮你执行命令 | 把团队经验变成可检索、可执行、**可审计**的智能工作流 |
| **竞争策略** | 与 Claude Code 等正面竞争 | 绕开 CLI 赛道，切入企业级知识资产化 + 可审计执行 |
| **Web 形态** | 弱点（不能操作真实环境） | 独占优势（可视化审查、团队协作、审计日志） |
| **目标用户** | 个人开发者 | 运维团队、SRE 新人、DevOps 团队 |

### 1.2 三大核心能力（改造后）

```
能力 1：知识资产化
  团队 Runbook → chunk + embedding → 向量知识库
  → RAG Agent 检索 → 建议附带"依据来源"
  → 支持用户上传自定义文档

能力 2：可视化执行计划（Execution Plan Graph）
  用户意图 → Planner Agent 生成完整 DAG 执行图
  → 执行前：可视化审查（节点/分支/风险/回滚路径）
  → 执行中：实时高亮当前节点
  → 执行后：路径记录归档

能力 3：自动审计（Auto Audit）
  Safety Agent 对完成的执行路径自动审计
  → 检查：幻觉 / 风险 / 最小权限 / 回滚覆盖 / 知识依据
  → 输出：结构化审计报告（PASS / WARN / FAIL）
  → 可导出合规记录
```

### 1.3 复赛权重变化与目标

| 维度 | 满分 | 当前预估 | 改造后目标 | 关键改造项 |
|------|------|---------|-----------|-----------|
| 场景价值 | 20 | 12-14 | 17-19 | 定位转向 + 企业级痛点 |
| 技术前瞻 | 20 | 5-8 | 15-18 | Multi-Agent + 向量 RAG + 执行图 |
| 工具整合 | 15 | 6-8 | 11-13 | Function Calling + 防幻觉 + 自动审计 |
| 用户体验 | 15 | 8-10 | 12-14 | 执行图可视化 + Agent 动效 + 游客引导 |
| 赛道专属 | 15 | 6-8 | 11-13 | "重塑工作流" + 效率对比 + 鲁棒性 |
| 游客投票 | 15 | 5-7 | 9-12 | 引导模式 + 30秒 Wow Demo |
| **总计** | **100** | **42-55** | **75-89** | |

---

## 二、P0 紧急任务：技术架构升级

### 2.1 Multi-Agent 架构改造

**现状：** Planner/Policy/Verifier 是 Python 函数直接调用，planner.py 90% 是 if/else 硬编码。

**改造目标：** 真正的 Agent 协同决策，每个 Agent 有独立的 system prompt + tool list + ReAct 循环。

#### 目标架构

```
用户输入（意图 / 命令 / 报错）
         │
         ▼
┌─────────────────────────────┐
│      Orchestrator Agent      │  主控：任务理解 → 拆解 → 调度
│     (ReAct Loop + Router)    │
└──┬──────────┬────────────┬──┘
   │          │            │
   ▼          ▼            ▼
┌──────┐  ┌────────┐  ┌──────────┐
│ Diag │  │  RAG   │  │ Planner  │
│Agent │  │ Agent  │  │  Agent   │
└──┬───┘  └───┬────┘  └────┬─────┘
   │          │            │
   └──────────┼────────────┘
              ▼
    ┌──────────────────┐
    │  Safety Agent     │  独立安全审查 + 自动审计
    │  (Audit Engine)   │
    └────────┬─────────┘
             │
             ▼
    ┌──────────────────┐
    │  执行计划图输出    │  Execution Plan Graph (DAG)
    │  + 审计报告       │
    └──────────────────┘
```

#### Agent 定义

| Agent | 职责 | 工具 (Tools) | 模型 |
|-------|------|-------------|------|
| **Orchestrator** | 任务理解、拆解、Agent 调度 | `dispatch_agent`, `aggregate` | Qwen2.5-Coder-32B |
| **Diag Agent** | 错误诊断、环境分析 | `parse_stderr`, `check_env` | Qwen2.5-Coder-32B |
| **RAG Agent** | 知识检索、依据引用 | `vector_search`, `keyword_search` | bge-small-zh (embed) |
| **Planner Agent** | 生成执行计划图 (DAG) | `generate_plan_graph`, `estimate_risk` | Qwen2.5-Coder-32B |
| **Safety Agent** | 执行前审查 + 执行后审计 | `audit_node`, `check_grounding`, `generate_report` | Qwen2.5-Coder-32B |

#### Agent 消息协议

```python
@dataclass
class AgentMessage:
    sender: str          # "orchestrator" | "diag" | "rag" | "planner" | "safety"
    content: str         # 自然语言内容
    tool_calls: list     # 工具调用记录
    metadata: dict       # 附加数据（置信度、来源、耗时等）
    timestamp: float
```

#### Orchestrator 核心流程

```python
class OrchestratorAgent(BaseAgent):
    async def process(self, user_input: str, context: SessionContext):
        # 1. 任务理解与拆解
        task_plan = await self.think(user_input, context)

        # 2. 并行分发：诊断 + 检索
        diag_result, rag_result = await asyncio.gather(
            self.diag_agent.analyze(task_plan),
            self.rag_agent.search(task_plan),
        )

        # 3. Planner 综合生成执行计划图
        execution_plan = await self.planner_agent.generate_plan(
            task=task_plan,
            diagnosis=diag_result,
            knowledge=rag_result,
        )

        # 4. Safety Agent 执行前预审
        pre_audit = await self.safety_agent.pre_audit(execution_plan)

        # 5. 输出：执行计划图 + 预审结果
        return PlanOutput(
            plan_graph=execution_plan,
            audit=pre_audit,
            rag_citations=rag_result.citations,
        )
```

### 2.2 向量 RAG 升级

**现状：** rag.py 纯关键词 TF 匹配 + 手写 rerank，无语义理解。

**改造：** embedding 向量检索 + 关键词检索 → 混合融合（Hybrid Search）。

#### 架构

```
Runbook 文档（Markdown）
    │
    ▼ Chunk（按标题/段落切分）
    │
    ▼ Embed（调用魔搭 bge-small-zh-v1.5 API）
    │
    ▼ 存入 numpy 向量索引
    │
查询时：
    用户意图 → embed → cosine similarity → top-K 语义结果
                   ↘                        ↙
                    RRF 融合排序
                   ↗                        ↘
    用户意图 → tokenize → 关键词 TF 匹配 → top-K 关键词结果
    │
    ▼ 融合后 top-3 返回，附带 source + snippet
```

#### 关键实现

```python
class HybridRAG:
    def __init__(self):
        self.chunks: list[DocChunk] = []
        self.embeddings: np.ndarray = None  # (N, dim)

    async def build_index(self, docs: list[Doc]):
        """启动时：chunk + embed + 建立索引"""
        self.chunks = self._chunk_documents(docs)
        vectors = []
        for chunk in self.chunks:
            vec = await self._get_embedding(chunk.text)
            vectors.append(vec)
        self.embeddings = np.array(vectors)

    async def search(self, query: str, top_k: int = 3) -> list[Citation]:
        """混合检索：向量 + 关键词 → RRF 融合"""
        vec_results = await self._vector_search(query, top_k=10)
        kw_results = self._keyword_search(query, top_k=10)
        fused = self._reciprocal_rank_fusion(vec_results, kw_results)
        return fused[:top_k]

    async def _get_embedding(self, text: str) -> list[float]:
        """调用魔搭 bge-small-zh-v1.5 Embedding API"""
        # POST https://api-inference.modelscope.cn/v1/embeddings
        # model: "BAAI/bge-small-zh-v1.5"
        ...
```

#### 知识库上传支持

```python
@app.post("/api/runbook/upload")
async def upload_runbook(file: UploadFile):
    """用户上传自定义 Runbook，自动 chunk + embed + 加入索引"""
    content = await file.read()
    text = content.decode("utf-8")
    doc = Doc(title=file.filename, text=text, source=f"custom/{file.filename}")
    await rag.add_document(doc)  # 增量更新索引
    return {"status": "ok", "chunks": len(rag.chunks)}

@app.get("/api/runbook/list")
def list_runbooks():
    """列出当前知识库所有文档"""
    return {"documents": [{"title": d.title, "source": d.source} for d in rag.docs]}
```

### 2.3 Function Calling / Tool Use

**现状：** LLM 只做"单轮 prompt → 解析 JSON"，没有工具调用。

**改造：** 为 LLM 定义标准 tools，让模型自主决定调用哪个工具。

```python
AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_runbook",
            "description": "从组织知识库检索相关排障文档",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "检索关键词或意图描述"},
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_execution_plan",
            "description": "根据诊断结果生成包含分支、验证和回滚的执行计划图",
            "parameters": {
                "type": "object",
                "properties": {
                    "intent": {"type": "string"},
                    "diagnosis": {"type": "string"},
                    "platform": {"type": "string", "enum": ["linux", "mac", "windows"]},
                },
                "required": ["intent"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "audit_command",
            "description": "对单条命令进行安全审计：语法检查、风险评估、权限分析",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "context": {"type": "string", "description": "执行上下文和目的"},
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "verify_result",
            "description": "验证命令执行结果是否符合预期",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "expected": {"type": "string"},
                    "stdout": {"type": "string"},
                    "exit_code": {"type": "integer"},
                },
                "required": ["command", "stdout"]
            }
        }
    }
]
```

---

## 三、P0 紧急任务：杀手级差异化功能

### 3.1 可视化执行计划图（Execution Plan Graph）

**这是整个项目最强的差异化武器——所有竞品都没有这个能力。**

#### 概念

AI 不再只输出"下一条命令"，而是输出一个**完整的执行计划 DAG（有向无环图）**，包含诊断节点、条件分支、执行节点、验证节点、回滚路径。用户在执行前就能看到 AI 打算做什么。

#### 数据结构

```python
@dataclass
class PlanNode:
    id: str
    type: str             # "diagnose" | "command" | "condition" | "verify" | "rollback" | "end"
    title: str            # 节点标题（中文）
    command: str | None   # 可执行命令（type=command 时有值）
    risk_level: str       # "safe" | "warn" | "block"
    grounded: bool        # 是否有 RAG 知识库依据
    citation: Citation | None
    description: str      # 节点说明

@dataclass
class PlanEdge:
    source_id: str
    target_id: str
    condition: str        # "success" | "failure" | "occupied" | "critical_service" 等
    label: str            # 边上的条件文字

@dataclass
class ExecutionPlan:
    id: str
    intent: str           # 用户原始意图
    nodes: list[PlanNode]
    edges: list[PlanEdge]
    root_id: str
    generated_by: str     # "planner_agent"
    created_at: str

@dataclass
class NodeExecution:
    node_id: str
    status: str           # "pending" | "running" | "passed" | "failed" | "skipped"
    stdout: str
    stderr: str
    exit_code: int | None
    executed_at: str | None
```

#### 示例：端口排查的执行计划图

```
用户意图："端口 8000 被占用了，帮我处理"

      ┌──────────────────┐
      │ 🔍 诊断：查看端口  │ ← 节点 1
      │ ss -ltnp|grep 8000│
      │ Risk: SAFE ✅      │
      │ 依据: port-check.md│
      └────────┬─────────┘
               │
        ┌──────▼──────┐
        │ 🧠 条件判断  │ ← 节点 2（自动）
        │ 端口是否占用？│
        └──┬───────┬──┘
           │       │
    有进程占用│       │无占用
           ▼       ▼
   ┌───────────┐ ┌─────────────┐
   │ 识别进程   │ │ ✅ 完成      │ ← 节点 3b
   │ ps -p PID │ │ 端口可用，    │
   │ Risk: SAFE│ │ 无需操作     │
   └─────┬─────┘ └─────────────┘
         │              ← 节点 3a
  ┌──────▼───────┐
  │ ⚠️ 风险评估   │ ← 节点 4（Safety Agent）
  │ 是否关键服务？ │
  └──┬────────┬──┘
     │        │
 非关键│        │关键服务
     ▼        ▼
┌──────────┐ ┌────────────────┐
│ kill PID │ │ 🛑 需人工确认   │ ← 节点 5b
│Risk: WARN│ │ 建议联系负责人  │
│ 需确认 ⚠️ │ └────────────────┘
└────┬─────┘
     │        ← 节点 5a
┌────▼──────┐
│ ✅ 验证    │ ← 节点 6
│ ss -ltnp  │
│ grep 8000 │
└──┬─────┬──┘
   │     │
  成功   失败
   ▼     ▼
┌─────┐ ┌──────────┐
│完成 │ │ 🔄 回滚   │ ← 节点 7b
└─────┘ │ 重启服务  │
        └──────────┘
```

#### 三层交互

**执行前审查（Plan Review）：**
- 用户看到完整图后，可以逐节点审查：命令是否合理、风险评估是否正确、回滚方案是否存在
- 可以手动修改某个节点的命令、跳过某个节点、或拒绝整个计划
- Safety Agent 对每个节点做预审，标注风险等级和知识依据

**执行中追踪（Live Tracking）：**
- 图上实时高亮当前执行到哪个节点
- 颜色编码：🟢 已通过 / 🟡 正在执行 / 🔴 失败 / ⚪ 未执行
- 条件分支处自动根据实际输出选择路径
- 用户随时可以中断

**执行后归档：**
- 完整的执行路径（走了哪些节点、跳过了哪些）保存为审计记录
- 可导出为时间线回放或结构化报告

#### 前端渲染方案

使用 **D3.js** 渲染 DAG 图（比 Mermaid 更灵活，支持动态高亮和动画）：

```javascript
// 核心渲染逻辑
class PlanGraphRenderer {
    constructor(container, plan) {
        this.svg = d3.select(container).append("svg");
        this.plan = plan;
        this.nodeElements = {};
    }

    render() {
        // 使用 dagre 布局算法计算节点位置
        const g = new dagre.graphlib.Graph();
        g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });

        for (const node of this.plan.nodes) {
            g.setNode(node.id, { label: node.title, width: 200, height: 80 });
        }
        for (const edge of this.plan.edges) {
            g.setEdge(edge.source_id, edge.target_id, { label: edge.label });
        }

        dagre.layout(g);
        this._drawNodes(g);
        this._drawEdges(g);
    }

    // 执行时动态更新节点状态
    updateNodeStatus(nodeId, status) {
        const el = this.nodeElements[nodeId];
        el.classed("node-pending", status === "pending")
          .classed("node-running", status === "running")
          .classed("node-passed", status === "passed")
          .classed("node-failed", status === "failed");

        if (status === "running") {
            el.select(".node-indicator").transition()
              .duration(600).style("opacity", 0.3)
              .transition().duration(600).style("opacity", 1)
              .on("end", function repeat() {
                  d3.select(this).transition()
                    .duration(600).style("opacity", 0.3)
                    .transition().duration(600).style("opacity", 1)
                    .on("end", repeat);
              });
        }
    }
}
```

#### 后端 API

```python
@app.post("/api/plan/generate")
async def generate_plan(req: PlanRequest) -> PlanResponse:
    """生成执行计划图（不执行，仅规划）"""
    plan = await orchestrator.generate_plan(req.intent, req.context)
    pre_audit = await safety_agent.pre_audit(plan)
    return PlanResponse(plan=plan, audit=pre_audit)

@app.post("/api/plan/{plan_id}/execute")
async def execute_plan(plan_id: str, req: ExecutePlanRequest):
    """按计划图逐节点执行（SSE 推送进度）"""
    ...

@app.post("/api/plan/{plan_id}/node/{node_id}/approve")
async def approve_node(plan_id: str, node_id: str):
    """用户审批某个需确认的节点"""
    ...

@app.post("/api/plan/{plan_id}/node/{node_id}/modify")
async def modify_node(plan_id: str, node_id: str, req: ModifyNodeRequest):
    """用户修改某个节点的命令"""
    ...
```

### 3.2 自动审计系统（Auto Audit）

**Safety Agent 在执行完成后自动对整个执行路径做合规审计。**

#### 审计维度

| 维度 | 检查内容 | 判定标准 |
|------|---------|---------|
| **命令合法性** | 是否为合法 shell 语法 | 语法解析通过 → PASS |
| **风险等级** | 是否触发了高危命令 | block → FAIL，warn → WARN |
| **知识依据** | 建议是否有 RAG 知识库支撑 | 有依据 → Grounded，无依据 → Ungrounded(WARN) |
| **最小权限** | 是否使用了不必要的高权限 | 不必要的 sudo / kill -9 → WARN |
| **回滚覆盖** | 关键操作是否有回滚方案 | 有回滚节点 → PASS，无 → WARN |
| **验证覆盖** | 关键操作后是否有验证步骤 | 有验证节点 → PASS，无 → WARN |
| **幻觉检测** | 命令是否与用户意图一致 | 意图是"查看"但生成了"删除" → FAIL |
| **路径合理性** | 实际执行路径是否符合最优路径 | 偏离过多 → WARN |

#### 审计报告数据结构

```python
@dataclass
class AuditFinding:
    node_id: str
    severity: str         # "info" | "warn" | "fail"
    dimension: str        # "risk" | "grounding" | "permission" | "rollback" | "hallucination"
    message: str
    recommendation: str

@dataclass
class AuditReport:
    plan_id: str
    session_id: str
    timestamp: str
    total_nodes: int
    executed_nodes: int
    skipped_nodes: int
    overall_verdict: str  # "PASS" | "PASS_WITH_WARNINGS" | "FAIL"
    findings: list[AuditFinding]
    summary: str          # Safety Agent 生成的自然语言总结
```

#### 审计报告示例（UI 展示）

```
┌─────────────────────────────────────────┐
│ 📋 自动审计报告                          │
│ Plan: 端口 8000 排查与处理               │
│ 时间: 2025-07-15 14:23:01               │
├─────────────────────────────────────────┤
│ 📊 总览                                 │
│ 节点总数: 6  执行: 5  跳过: 1            │
│ 总体评级: ✅ PASS (2 warnings)          │
├─────────────────────────────────────────┤
│ ⚠️ 发现 #1 [WARN] 最小权限              │
│ 节点: #5a kill -9 <PID>                │
│ 说明: 使用了 kill -9（强制终止），       │
│       建议优先使用 kill -15（优雅终止）  │
│ 依据: port-check.md §3.2               │
├─────────────────────────────────────────┤
│ ⚠️ 发现 #2 [WARN] 知识依据              │
│ 节点: #4 风险评估                       │
│ 说明: 该判断由 LLM 生成，未找到          │
│       精确匹配的 Runbook 依据            │
│ 建议: 团队可补充相关 SOP 文档           │
├─────────────────────────────────────────┤
│ ✅ 其他节点均通过审计                    │
│   #1 诊断命令 — PASS (grounded)         │
│   #3a 进程识别 — PASS (safe)            │
│   #6 验证 — PASS (验证步骤完整)          │
├─────────────────────────────────────────┤
│ [导出 JSON] [导出 Markdown] [分享链接]   │
└─────────────────────────────────────────┘
```

#### 审计与竞品的差异化对比

| 能力 | Claude Code | Warp | Copilot CLI | **Terminal Copilot (改造后)** |
|------|------------|------|------------|------------------------------|
| 生成命令 | ✅ | ✅ | ✅ | ✅ |
| 执行命令 | ✅ | ✅ | ❌ | ✅ |
| **执行前可视化计划** | ❌ | ❌ | ❌ | **✅** |
| **执行中实时追踪** | ❌ | ❌ | ❌ | **✅** |
| **执行后自动审计** | ❌ | ❌ | ❌ | **✅** |
| **幻觉检测** | ❌ | ❌ | ❌ | **✅** |
| **合规报告导出** | ❌ | ❌ | ❌ | **✅** |
| **知识库定制** | ❌ | ❌ | ❌ | **✅** |

---

## 四、P1 重点任务

### 4.1 用户体验升级

#### 4.1.1 整体 UI 重构（配合执行计划图）

**改造后的页面布局：**

```
┌──────────────────────────────────────────────────┐
│ Terminal Copilot · 运维 SOP 智能执行引擎   [状态] │
│ [simulate/local] [知识库管理] [LLM设置] [新会话]  │
├────────────────────┬─────────────────────────────┤
│                    │                             │
│   xterm.js 终端    │   执行计划图（DAG 可视化）    │
│                    │   ┌─────┐                   │
│   > 端口 8000 被   │   │诊断 │──→ ...           │
│     占用了         │   └─────┘                   │
│                    │                             │
│                    ├─────────────────────────────┤
│                    │   Agent 状态面板             │
│                    │   🧠 Orchestrator: 调度中    │
│                    │   🔍 RAG Agent: 检索完成     │
│                    │   🛡️ Safety: 预审通过       │
│                    ├─────────────────────────────┤
│                    │   审计报告 / 时间线          │
│                    │   ✅ PASS (2 warnings)      │
│                    │   [导出] [分享]              │
├────────────────────┴─────────────────────────────┤
│ [🔍 查端口] [🐳 Docker] [🔧 Git] [📚 自定义]    │
│            ↑ 快速 Demo 按钮（游客入口）            │
└──────────────────────────────────────────────────┘
```

#### 4.1.2 Agent 协作可视化（SSE 实时推送）

```
右侧 Agent 状态面板（实时动态）：

┌─────────────────────────────┐
│ 🧠 Orchestrator             │
│   └─ 分析意图… → 已拆解任务  │
├─────────────────────────────┤
│ 🔍 RAG Agent                │
│   ├─ 检索: "端口占用 8000"   │
│   ├─ 命中 3 篇文档          │
│   └─ ✅ 最佳匹配: port-check│
├─────────────────────────────┤
│ 🩺 Diag Agent               │
│   ├─ 分析上下文…            │
│   └─ 诊断: EADDRINUSE       │
├─────────────────────────────┤
│ 📋 Planner Agent            │
│   └─ 生成执行计划图（6节点） │
├─────────────────────────────┤
│ 🛡️ Safety Agent             │
│   ├─ 预审: 2 个 WARN        │
│   └─ ✅ 整体可执行           │
└─────────────────────────────┘
```

后端使用 SSE 推送 Agent 进度：

```python
@app.get("/api/plan/stream/{plan_id}")
async def stream_plan_progress(plan_id: str):
    """SSE 推送执行进度"""
    async def event_generator():
        async for event in orchestrator.execute_with_progress(plan_id):
            yield {
                "event": event.type,  # "agent_start" | "agent_done" | "node_start" | "node_done"
                "data": json.dumps(event.payload),
            }
    return EventSourceResponse(event_generator())
```

#### 4.1.3 游客引导模式

```html
<!-- 页面底部：快速 Demo 按钮 -->
<div class="quick-demo-bar">
  <span>30 秒体验 AI 运维副驾：</span>
  <button data-demo="port">🔍 查端口占用</button>
  <button data-demo="docker">🐳 Docker 换源</button>
  <button data-demo="git">🔧 修复 Git 拼写</button>
  <button data-demo="upload">📚 上传你的文档</button>
</div>
```

点击按钮 → 自动填入预设意图 → Agent 协作动画 → 执行计划图生成 → 全程无需手动输入。

### 4.2 防幻觉机制（显式化）

#### 置信度标签系统

每个执行计划节点都带有置信度标签：

| 标签 | 含义 | 判定条件 |
|------|------|---------|
| `✅ Grounded` | 有知识库依据 | RAG 检索到匹配文档且相似度 > 阈值 |
| `⚠️ Unverified` | 无知识库依据 | LLM 生成但 RAG 未检索到匹配 |
| `✗ Syntax Error` | 命令语法有误 | shell 语法检查失败 |

在 UI 上每个节点右上角显示标签，让用户（和评委）一眼看到防幻觉机制的运作。

### 4.3 赛道专属分准备

#### 4.3.1 效率对比演示

```
场景：端口 8000 被占用，需要找到并结束进程

传统方式（手动搜索 + 试错）：
  1. Google 搜索 "如何查看端口占用"        → 30 秒
  2. 尝试命令，可能用错平台命令              → 20 秒
  3. 找到 PID 后搜索如何 kill              → 20 秒
  4. 执行 kill，不确定是否成功              → 10 秒
  5. 没有验证步骤，可能以为成功实际没有      → ?
  总计：80+ 秒 + 心智负担 + 无审计记录

Terminal Copilot（AI SOP 引导）：
  1. 输入 "端口 8000 被占用"               → 3 秒
  2. 查看执行计划图，确认合理               → 5 秒
  3. 批准执行，自动逐步完成                 → 10 秒
  4. 自动验证 + 审计报告                    → 自动
  总计：18 秒 + 零心智负担 + 完整审计记录
```

#### 4.3.2 "重塑工作流"叙事

赛道一卓越档描述："不仅提速，更重塑了工作流"。

Terminal Copilot 重塑的工作流：

```
传统：经验 → 记忆 → 手动执行 → 祈祷没出错 → 执行完就忘了

新流程：
  知识库化：经验 → Runbook → 向量索引（知识不再锁在脑子里）
  计划化：  意图 → Agent 生成执行图 → 审查后执行（不再盲操作）
  审计化：  每步操作 → 自动审计 → 合规报告（可追溯、可复盘）
  资产化：  执行记录 → 导出分享 → 团队知识沉淀（不再做完就忘）
```

### 4.4 游客投票策略

#### A3 海报内容规划

```
┌───────────────────────────────────────────┐
│                                           │
│    🤖 Terminal Copilot                    │
│    终端场景的 AI 知识执行引擎              │
│                                           │
│    "让 AI 不仅帮你做事，                   │
│     还能证明它做的事是对的"                │
│                                           │
│  ┌───────────────────────────────────┐   │
│  │  产品截图：左侧终端 + 右侧执行图  │   │
│  │  （DAG 可视化 + Agent 状态面板）  │   │
│  └───────────────────────────────────┘   │
│                                           │
│  ✨ 三大核心能力                          │
│                                           │
│  📚 知识资产化                            │
│     团队 Runbook → AI 可检索可引用        │
│     支持上传自定义文档                     │
│                                           │
│  🗺️ 可视化执行计划                        │
│     执行前：看到完整路径和分支             │
│     执行中：实时追踪当前节点              │
│                                           │
│  🛡️ 自动审计                             │
│     Safety Agent 自动检查每一步           │
│     幻觉检测 · 风险评估 · 合规报告        │
│                                           │
│  🎯 30 秒体验：点击屏幕上的快速 Demo      │
│                                           │
│  ┌──────┐                                 │
│  │二维码│ ← 创空间在线体验                │
│  └──────┘                                 │
│                                           │
│  Multi-Agent · 向量 RAG · ModelScope      │
│  D3.js 可视化 · FastAPI · xterm.js        │
└───────────────────────────────────────────┘
```

#### 现场 30 秒 Demo 脚本

```
游客走近 →
  屏幕显示快速 Demo 按钮 →
  游客点击 "🔍 查端口占用" →

  Step 1 (3s): Agent 状态面板动画——各 Agent 依次启动
  Step 2 (3s): 右侧生成执行计划图（DAG 动画展开）
  Step 3 (2s): Safety Agent 预审——节点标注风险和依据
  Step 4 (5s): 逐节点执行，图上实时高亮 🟢→🟡→🟢
  Step 5 (2s): 审计报告自动生成——"✅ PASS"

  游客："这个好直观！能看到 AI 在想什么"
  →
  贴纸 ✓
```

---

## 五、P2 补充任务

### 5.1 知识库扩充（24 篇 → 50+ 篇）

| 类别 | 新增文档 |
|------|---------|
| 容器/K8s | Pod CrashLoopBackOff、OOMKilled、ImagePullBackOff |
| Web 服务 | Nginx 502/504、SSL 证书过期、DNS 解析失败 |
| 数据库 | MySQL 连接数满、Redis 内存满、慢查询排查 |
| 系统 | 磁盘满、CPU 100%、内存泄漏、僵尸进程 |
| 网络 | 防火墙规则、SSH 连接超时 |
| 开发环境 | Node.js 版本冲突、Python venv、Git 冲突 |

### 5.2 演示场景（复赛现场 3 个 Demo）

| Demo | 场景 | 展示核心能力 |
|------|------|-------------|
| **Demo 1** | 新人排障：端口占用 | 执行计划图 + Agent 协作 + 自动审计 |
| **Demo 2** | SOP 标准化：Docker 换源 | 知识库引用 + 多步 SOP 引导 + 验证闭环 |
| **Demo 3** | 知识库定制：上传 Runbook → 立刻可用 | 向量 RAG + 可扩展性证明 |

Demo 3 是关键——直接证明"不只是运维，任何终端场景的知识都能导入"。

### 5.3 交付物

#### 魔搭研习社文章结构

1. **引言** — 痛点故事（AI 终端工具的信任危机：敢不敢执行？出了事能追溯吗？）
2. **产品定位** — 终端场景的 AI 知识执行引擎（vs. 传统终端 AI 助手）
3. **核心功能** — 三大能力 + 截图/GIF
4. **技术架构** — Multi-Agent 架构图 + 数据流
5. **创新亮点** — 执行计划图 + 自动审计（竞品对比表）
6. **技术实现** — 向量 RAG、Agent 通信、D3 可视化
7. **演示** — 嵌入视频 + 创空间链接

#### 演示视频（2-3 分钟）

```
00:00-00:15  开场：所有终端 AI 工具共同的信任问题
00:15-00:45  核心 Demo：意图 → Agent 协作 → 执行计划图生成
00:45-01:15  执行计划图详解：审查 → 执行 → 实时追踪
01:15-01:45  自动审计报告展示
01:45-02:15  知识库定制：上传 Runbook → 立刻可用
02:15-02:45  竞品对比 + 技术架构
02:45-03:00  收尾
```

---

## 六、优先级排期

### 6.1 任务优先级矩阵

| 优先级 | 任务 | 预期收益 | 工作量 |
|--------|------|---------|--------|
| **P0** | Multi-Agent 架构 | 技术前瞻 +8-12 分 | 3-4 天 |
| **P0** | 向量 RAG + 知识库上传 | 技术前瞻 +3-5 分，场景价值 +3 分 | 1-2 天 |
| **P0** | 执行计划图（DAG 生成 + D3 可视化） | 全维度 +10-15 分（杀手级差异化） | 3-4 天 |
| **P0** | 自动审计系统 | 工具整合 +3-4 分，场景价值 +3 分 | 1-2 天 |
| **P1** | Function Calling 实现 | 工具整合 +3-4 分 | 1 天 |
| **P1** | Agent 状态面板 + SSE 推送 | 用户体验 +3-4 分 | 1-2 天 |
| **P1** | 游客引导模式 + 快速 Demo | 游客投票 +4-7 分 | 0.5 天 |
| **P1** | 防幻觉置信度标签 | 工具整合 +2 分 | 0.5 天 |
| **P2** | 知识库扩充 50+ 篇 | 场景价值 +2 分 | 1-2 天 |
| **P2** | 效率对比演示脚本 | 赛道专属 +2-3 分 | 0.5 天 |
| **P2** | 研习社文章 | 交付物 | 1 天 |
| **P2** | 演示视频 | 交付物备份 | 0.5 天 |
| **P2** | A3 海报设计 | 现场展示 | 0.5 天 |

### 6.2 建议排期（10 天）

| 阶段 | 天数 | 任务 |
|------|------|------|
| **Sprint 1** | Day 1-3 | Multi-Agent 架构 + Agent 消息协议 + Orchestrator |
| **Sprint 2** | Day 3-5 | 向量 RAG 升级 + 知识库上传 API |
| **Sprint 3** | Day 5-8 | 执行计划图：后端 DAG 生成 + 前端 D3 渲染 + SSE 推送 |
| **Sprint 4** | Day 8-9 | 自动审计 + 防幻觉标签 + 游客引导模式 |
| **Sprint 5** | Day 9-10 | 知识库扩充 + 文章 + 视频 + 海报 + 部署测试 |

### 6.3 最小可行改动（仅 4-5 天）

如果时间极其紧张，集中做以下四项：

| 任务 | 天数 | ROI |
|------|------|-----|
| Multi-Agent 骨架 + 向量 RAG | 2 天 | 技术前瞻直接跳档 |
| 执行计划图（简化版：Mermaid 渲染） | 1.5 天 | 杀手级差异化 + 体验突破 |
| 自动审计报告（基础版） | 0.5 天 | 完成差异化闭环 |
| 游客引导 + 快速 Demo | 0.5 天 | 游客投票基础分 |

---

## 七、预期成果

| 维度 | 满分 | 当前 | 改造后 | 提升 |
|------|------|------|--------|------|
| 场景价值 | 20 | 12-14 | 17-19 | +5 |
| 技术前瞻 | 20 | 5-8 | 15-18 | **+10** |
| 工具整合 | 15 | 6-8 | 11-13 | +5 |
| 用户体验 | 15 | 8-10 | 12-14 | +4 |
| 赛道专属 | 15 | 6-8 | 11-13 | +5 |
| 游客投票 | 15 | 5-7 | 9-12 | +5 |
| **总计** | **100** | **42-55** | **75-89** | **+30** |

核心增长来源：**执行计划图 + 自动审计**贡献了约 10-15 分的全维度提升，是性价比最高的单一功能投入。