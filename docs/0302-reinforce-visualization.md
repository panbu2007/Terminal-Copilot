# 执行计划图可视化 & 自动审计 UI 实现计划

## 一、当前 UI 现状与改造目标

### 1.1 当前右侧面板

现在右侧面板由两部分组成，全部是静态 DOM append：

```
aside.side-pane
├── div.side-title    "任务流时间线"
├── div#steps         ← 回合卡片列表（Plan/Execute/Verify/Next 四阶段文字）
├── div.side-subtitle "当前回合下一步建议"
└── div#suggestions   ← 建议卡列表（command/why/risk/rollback/verify 文字卡）
```

问题：纯文字堆叠，没有图形化，没有动态状态，没有空间展示执行路径关系。

### 1.2 改造后右侧面板（三区域）

```
aside.side-pane
├── [区域 A] 执行计划图（Execution Plan Graph）
│   ├── DAG 可视化画布（D3.js / SVG）
│   ├── 节点详情浮层（点击节点展开）
│   └── 图例 + 操作按钮（批准/修改/中断）
│
├── [区域 B] Agent 协作状态面板
│   ├── 各 Agent 实时状态条
│   └── 思考链摘要（当前 Agent 在做什么）
│
└── [区域 C] 审计报告 / 历史时间线
    ├── 自动审计报告卡
    ├── 历史回合折叠列表
    └── 导出按钮（JSON / Markdown / 分享链接）
```

---

## 二、区域 A：执行计划图可视化

### 2.1 视觉设计规范

#### 节点样式

```
┌─────────────────────────────┐
│ [图标] 节点标题              │
│ ─────────────────────────── │
│ $ command --here            │  ← 等宽字体，可复制
│                             │
│ [Risk:SAFE ✅] [Grounded ✅] │  ← 底部标签行
└─────────────────────────────┘
```

节点类型与视觉映射：

| type | 图标 | 默认边框色 | 背景色 | 形状 |
|------|------|-----------|--------|------|
| `diagnose` | 🔍 | `#60a5fa`（蓝） | `rgba(96,165,250,0.08)` | 圆角矩形 |
| `command` | ⚡ | `#a78bfa`（紫） | `rgba(167,139,250,0.08)` | 圆角矩形 |
| `condition` | 🧠 | `#fbbf24`（黄） | `rgba(251,191,36,0.08)` | 菱形 |
| `verify` | ✅ | `#34d399`（绿） | `rgba(52,211,153,0.08)` | 圆角矩形 |
| `rollback` | 🔄 | `#f87171`（红） | `rgba(248,113,113,0.08)` | 圆角矩形（虚线边框） |
| `end` | 🏁 | `#9ca3af`（灰） | `rgba(156,163,175,0.08)` | 圆形 |
| `human` | 🛑 | `#fb923c`（橙） | `rgba(251,146,60,0.08)` | 八角形 |

风险等级覆盖色（优先级高于类型色）：

| risk_level | 左侧色条 | 标签样式 |
|-----------|----------|---------|
| `safe` | `#34d399` | 绿底白字 |
| `warn` | `#fbbf24` | 黄底黑字 |
| `block` | `#ef4444` | 红底白字 |

知识依据标签：

| grounded | 标签 |
|----------|------|
| `true` | `✅ Grounded` 绿色小标签 |
| `false` | `⚠️ Unverified` 灰色小标签 |

#### 边（Edge）样式

| condition | 线条样式 | 颜色 | 标签 |
|-----------|---------|------|------|
| `success` | 实线 + 箭头 | `#34d399` | "成功" |
| `failure` | 虚线 + 箭头 | `#f87171` | "失败" |
| 自定义条件 | 实线 + 箭头 | `#9ca3af` | 条件文字（如"有进程占用"） |

#### 执行状态动态样式

| 状态 | 节点效果 | 边效果 |
|------|---------|--------|
| `pending` | 默认样式，半透明（opacity: 0.5） | 灰色 |
| `running` | 边框高亮 + 呼吸灯动画（脉冲发光） | 虚线流动动画 |
| `passed` | 绿色边框 + 左上角 ✅ 角标 | 绿色实线 |
| `failed` | 红色边框 + 左上角 ❌ 角标 + 轻微抖动 | 红色虚线 |
| `skipped` | 灰色半透明 + 删除线文字 | 灰色淡化 |
| `awaiting_approval` | 橙色边框 + 闪烁"待批准"标签 | — |

### 2.2 布局算法

使用 **dagre** 布局（专为 DAG 设计的分层布局算法）：

```
安装：前端直接从 CDN 引入（无需构建工具）
  <script src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"></script>

布局参数：
  rankdir: "TB"        （从上到下）
  nodesep: 50          （同层节点间距）
  ranksep: 70          （层与层间距）
  marginx: 20
  marginy: 20
```

condition 节点（菱形）使用 45° 旋转的正方形 + 内部文字不旋转。

画布支持：
- 鼠标滚轮缩放（zoom）
- 拖拽平移（pan）
- 点击节点弹出详情浮层
- 自动居中 + fit-to-view

### 2.3 节点详情浮层（点击展开）

```
┌──────────────────────────────────────┐
│ ⚡ kill -9 <PID>                 [×] │
├──────────────────────────────────────┤
│ 类型: command                        │
│ 风险: ⚠️ WARN                        │
│ 依据: ✅ Grounded                    │
│                                      │
│ 📄 知识来源                          │
│ port-check.md §3.2                   │
│ "当确认进程非关键服务时，可使用       │
│  kill 命令终止。优先使用 -15……"      │
│                                      │
│ 🔄 回滚方案                          │
│ systemctl restart <service>          │
│                                      │
│ ✏️ 操作                              │
│ [修改命令] [跳过此节点] [批准执行]    │
└──────────────────────────────────────┘
```

浮层定位：出现在节点右侧（空间不足时左侧），带指向节点的小三角。

### 2.4 图上方操作栏

```
┌──────────────────────────────────────────────┐
│ 执行计划 · 端口 8000 排查        6 个节点     │
│                                              │
│ [🔍 缩放适配] [📋 批准全部] [▶️ 开始执行]     │
│ [✏️ 编辑模式] [⏸️ 暂停] [⏹️ 中断]            │
│                                              │
│ 预审: ✅ Safety Agent 已通过 (2 warnings)    │
└──────────────────────────────────────────────┘
```

### 2.5 完整渲染流程

```
后端返回 ExecutionPlan JSON
         │
         ▼
    解析 nodes + edges
         │
         ▼
    dagre 计算布局坐标
         │
         ▼
    D3.js 绘制 SVG
    ├── <g> 边组：path + 箭头 + 条件标签
    ├── <g> 节点组：rect/diamond + 图标 + 标题 + 命令 + 标签
    └── <g> 状态覆盖层：角标 + 动画
         │
         ▼
    绑定交互事件
    ├── click → 展开节点详情浮层
    ├── wheel → 缩放
    ├── drag → 平移
    └── 操作按钮 → API 调用
         │
         ▼
    SSE 监听执行进度
    ├── "node_start"  → updateNodeStatus(id, "running")
    ├── "node_done"   → updateNodeStatus(id, "passed" | "failed")
    ├── "node_skip"   → updateNodeStatus(id, "skipped")
    ├── "need_approve" → updateNodeStatus(id, "awaiting_approval")
    └── "plan_done"   → 切换到审计报告视图
```

### 2.6 核心前端代码结构

```javascript
class PlanGraphRenderer {
    constructor(containerEl) {
        this.container = containerEl;
        this.svg = null;
        this.zoomGroup = null;
        this.zoom = null;
        this.plan = null;
        this.nodeElements = {};   // id → SVG <g> element
        this.edgeElements = {};   // "src-tgt" → SVG <path> element
        this.onNodeClick = null;  // callback
    }

    // ── 初始化 ──
    init() {
        this.svg = d3.select(this.container)
            .append("svg")
            .attr("width", "100%")
            .attr("height", "100%");

        this.zoomGroup = this.svg.append("g").attr("class", "zoom-layer");

        // 缩放 + 平移
        this.zoom = d3.zoom()
            .scaleExtent([0.3, 2.5])
            .on("zoom", (event) => {
                this.zoomGroup.attr("transform", event.transform);
            });
        this.svg.call(this.zoom);

        // 箭头 marker 定义
        this.svg.append("defs").append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 8).attr("refY", 0)
            .attr("markerWidth", 6).attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5")
            .attr("fill", "#9ca3af");
    }

    // ── 渲染计划图 ──
    render(plan) {
        this.plan = plan;
        this.zoomGroup.selectAll("*").remove();

        // dagre 布局
        const g = new dagre.graphlib.Graph();
        g.setGraph({ rankdir: "TB", nodesep: 50, ranksep: 70, marginx: 20, marginy: 20 });
        g.setDefaultEdgeLabel(() => ({}));

        for (const node of plan.nodes) {
            const isCondition = node.type === "condition";
            const w = isCondition ? 140 : 220;
            const h = isCondition ? 80 : 90;
            g.setNode(node.id, { ...node, width: w, height: h });
        }
        for (const edge of plan.edges) {
            g.setEdge(edge.source_id, edge.target_id, {
                label: edge.label || edge.condition,
                condition: edge.condition,
            });
        }
        dagre.layout(g);

        // 绘制边
        const edgesGroup = this.zoomGroup.append("g").attr("class", "edges");
        g.edges().forEach((e) => {
            const edgeData = g.edge(e);
            this._drawEdge(edgesGroup, e, edgeData);
        });

        // 绘制节点
        const nodesGroup = this.zoomGroup.append("g").attr("class", "nodes");
        g.nodes().forEach((id) => {
            const nodeData = g.node(id);
            this._drawNode(nodesGroup, nodeData);
        });

        // fit-to-view
        this._fitToView(g);
    }

    // ── 绘制单个节点 ──
    _drawNode(parent, node) {
        const group = parent.append("g")
            .attr("class", `plan-node node-type-${node.type} node-risk-${node.risk_level}`)
            .attr("data-node-id", node.id)
            .attr("transform", `translate(${node.x - node.width/2}, ${node.y - node.height/2})`)
            .style("cursor", "pointer")
            .on("click", () => {
                if (this.onNodeClick) this.onNodeClick(node);
            });

        // 背景矩形（condition 用旋转矩形模拟菱形）
        if (node.type === "condition") {
            group.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", node.width).attr("height", node.height)
                .attr("rx", 4)
                .attr("transform", `rotate(45, ${node.width/2}, ${node.height/2}) scale(0.72)`)
                .attr("transform-origin", `${node.width/2}px ${node.height/2}px`)
                .attr("class", "node-bg");
        } else if (node.type === "end") {
            group.append("circle")
                .attr("cx", node.width/2).attr("cy", node.height/2)
                .attr("r", 24)
                .attr("class", "node-bg");
        } else {
            group.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", node.width).attr("height", node.height)
                .attr("rx", 8)
                .attr("class", "node-bg");

            // 左侧风险色条
            group.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", 4).attr("height", node.height)
                .attr("rx", 2)
                .attr("class", `risk-bar risk-${node.risk_level}`);
        }

        // 图标 + 标题
        const icon = this._typeIcon(node.type);
        group.append("text")
            .attr("x", 14).attr("y", 20)
            .attr("class", "node-title")
            .text(`${icon} ${node.title}`);

        // 命令文字（如果有）
        if (node.command && node.type !== "condition") {
            group.append("text")
                .attr("x", 14).attr("y", 42)
                .attr("class", "node-command")
                .text(this._truncate(node.command, 28));
        }

        // 底部标签（risk + grounded）
        if (node.type !== "end" && node.type !== "condition") {
            const tagY = node.height - 14;
            group.append("text")
                .attr("x", 14).attr("y", tagY)
                .attr("class", `node-tag tag-risk-${node.risk_level}`)
                .text(node.risk_level.toUpperCase());

            if (typeof node.grounded === "boolean") {
                group.append("text")
                    .attr("x", 80).attr("y", tagY)
                    .attr("class", `node-tag tag-grounded-${node.grounded}`)
                    .text(node.grounded ? "✅ Grounded" : "⚠️ Unverified");
            }
        }

        // 状态角标占位（初始隐藏）
        group.append("g").attr("class", "status-badge").style("display", "none");

        this.nodeElements[node.id] = group;
    }

    // ── 绘制边 ──
    _drawEdge(parent, e, edgeData) {
        const points = edgeData.points || [];
        const line = d3.line().x(d => d.x).y(d => d.y).curve(d3.curveBasis);

        const path = parent.append("path")
            .attr("d", line(points))
            .attr("class", `plan-edge edge-${edgeData.condition || "default"}`)
            .attr("marker-end", "url(#arrowhead)")
            .attr("fill", "none");

        // 条件标签
        if (edgeData.label && points.length >= 2) {
            const mid = points[Math.floor(points.length / 2)];
            parent.append("text")
                .attr("x", mid.x).attr("y", mid.y - 6)
                .attr("class", "edge-label")
                .attr("text-anchor", "middle")
                .text(edgeData.label);
        }

        this.edgeElements[`${e.v}-${e.w}`] = path;
    }

    // ── 动态更新节点执行状态 ──
    updateNodeStatus(nodeId, status) {
        const group = this.nodeElements[nodeId];
        if (!group) return;

        // 清除旧状态 class
        group.classed("status-pending", false)
             .classed("status-running", false)
             .classed("status-passed", false)
             .classed("status-failed", false)
             .classed("status-skipped", false)
             .classed("status-awaiting", false);

        // 设置新状态
        group.classed(`status-${status}`, true);

        const badge = group.select(".status-badge");

        if (status === "running") {
            badge.style("display", null);
            badge.selectAll("*").remove();
            // 呼吸灯动画
            badge.append("circle")
                .attr("cx", -4).attr("cy", -4).attr("r", 6)
                .attr("fill", "#fbbf24")
                .attr("class", "pulse-anim");
        } else if (status === "passed") {
            badge.style("display", null);
            badge.selectAll("*").remove();
            badge.append("text")
                .attr("x", -8).attr("y", 2)
                .attr("class", "badge-icon")
                .text("✅");
        } else if (status === "failed") {
            badge.style("display", null);
            badge.selectAll("*").remove();
            badge.append("text")
                .attr("x", -8).attr("y", 2)
                .attr("class", "badge-icon")
                .text("❌");
            // 抖动动画
            group.classed("shake-anim", true);
            setTimeout(() => group.classed("shake-anim", false), 600);
        } else if (status === "awaiting") {
            badge.style("display", null);
            badge.selectAll("*").remove();
            badge.append("text")
                .attr("x", -8).attr("y", 2)
                .attr("class", "badge-icon blink-anim")
                .text("🔔");
        } else {
            badge.style("display", "none");
        }
    }

    // ── 更新边状态（已走过的路径） ──
    updateEdgeStatus(sourceId, targetId, status) {
        const key = `${sourceId}-${targetId}`;
        const path = this.edgeElements[key];
        if (!path) return;
        path.classed("edge-active", status === "passed")
            .classed("edge-failed", status === "failed");
    }

    // ── 自动居中 ──
    _fitToView(g) {
        const graph = g.graph();
        const svgRect = this.svg.node().getBoundingClientRect();
        const scale = Math.min(
            svgRect.width / (graph.width + 40),
            svgRect.height / (graph.height + 40),
            1.0
        );
        const tx = (svgRect.width - graph.width * scale) / 2;
        const ty = (svgRect.height - graph.height * scale) / 2;
        this.svg.call(
            this.zoom.transform,
            d3.zoomIdentity.translate(tx, ty).scale(scale)
        );
    }

    _typeIcon(type) {
        return { diagnose: "🔍", command: "⚡", condition: "🧠",
                 verify: "✅", rollback: "🔄", end: "🏁", human: "🛑" }[type] || "📌";
    }

    _truncate(s, n) {
        return s.length > n ? s.slice(0, n - 1) + "…" : s;
    }
}
```

### 2.7 CSS 动画定义

```css
/* ── 节点状态样式 ── */
.plan-node .node-bg {
    fill: var(--panel);
    stroke: var(--border);
    stroke-width: 1.5;
    transition: all 0.3s ease;
}

.plan-node.status-pending .node-bg { opacity: 0.5; }

.plan-node.status-running .node-bg {
    stroke: #fbbf24;
    stroke-width: 2.5;
    filter: drop-shadow(0 0 8px rgba(251,191,36,0.4));
}

.plan-node.status-passed .node-bg {
    stroke: #34d399;
    stroke-width: 2;
}

.plan-node.status-failed .node-bg {
    stroke: #ef4444;
    stroke-width: 2.5;
    filter: drop-shadow(0 0 6px rgba(239,68,68,0.3));
}

.plan-node.status-skipped .node-bg {
    opacity: 0.3;
    stroke-dasharray: 4 4;
}

.plan-node.status-skipped .node-title,
.plan-node.status-skipped .node-command {
    text-decoration: line-through;
    opacity: 0.5;
}

/* ── 风险色条 ── */
.risk-bar.risk-safe  { fill: #34d399; }
.risk-bar.risk-warn  { fill: #fbbf24; }
.risk-bar.risk-block { fill: #ef4444; }

/* ── 边样式 ── */
.plan-edge {
    stroke: #4b5563;
    stroke-width: 1.5;
    transition: stroke 0.3s ease, stroke-width 0.3s ease;
}
.plan-edge.edge-success { stroke: #34d399; }
.plan-edge.edge-failure { stroke: #f87171; stroke-dasharray: 6 3; }
.plan-edge.edge-active  { stroke: #34d399; stroke-width: 2.5; }
.plan-edge.edge-failed  { stroke: #ef4444; stroke-width: 2.5; }

.edge-label {
    fill: var(--muted);
    font-size: 11px;
}

/* ── 节点文字 ── */
.node-title {
    fill: var(--text);
    font-size: 13px;
    font-weight: 600;
}
.node-command {
    fill: var(--muted);
    font-size: 11px;
    font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
}
.node-tag {
    font-size: 10px;
    font-weight: 500;
}
.tag-risk-safe  { fill: #34d399; }
.tag-risk-warn  { fill: #fbbf24; }
.tag-risk-block { fill: #ef4444; }
.tag-grounded-true  { fill: #34d399; }
.tag-grounded-false { fill: #9ca3af; }

/* ── 呼吸灯（running 节点） ── */
@keyframes pulse {
    0%, 100% { opacity: 1; r: 6; }
    50%      { opacity: 0.4; r: 10; }
}
.pulse-anim { animation: pulse 1.2s ease-in-out infinite; }

/* ── 抖动（failed 节点） ── */
@keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%      { transform: translateX(-4px); }
    40%      { transform: translateX(4px); }
    60%      { transform: translateX(-3px); }
    80%      { transform: translateX(2px); }
}
.shake-anim { animation: shake 0.5s ease-in-out; }

/* ── 闪烁（awaiting approval） ── */
@keyframes blink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.3; }
}
.blink-anim { animation: blink 1s ease-in-out infinite; }

/* ── 边流动动画（running 节点的入边） ── */
@keyframes dash-flow {
    to { stroke-dashoffset: -20; }
}
.edge-flowing {
    stroke-dasharray: 8 4;
    animation: dash-flow 0.8s linear infinite;
}
```

---

## 三、区域 B：Agent 协作状态面板

### 3.1 视觉设计

```
┌──────────────────────────────────────┐
│ Agent 协作状态                        │
├──────────────────────────────────────┤
│                                      │
│ 🧠 Orchestrator                      │
│ ████████████████████████░░░░  80%   │
│ 已拆解为 3 个子任务                   │
│                                      │
│ 🔍 RAG Agent                ✅ 完成  │
│ ████████████████████████████  100%  │
│ 命中 3 篇文档，最佳: port-check.md   │
│                                      │
│ 🩺 Diag Agent               ✅ 完成  │
│ ████████████████████████████  100%  │
│ 诊断: EADDRINUSE on :8000           │
│                                      │
│ 📋 Planner Agent             🔄 执行中│
│ ██████████████░░░░░░░░░░░░░  52%   │
│ 正在生成执行计划图…                   │
│                                      │
│ 🛡️ Safety Agent              ⏳ 等待 │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░  0%    │
│ 等待 Planner 完成后开始预审           │
│                                      │
└──────────────────────────────────────┘
```

### 3.2 状态条组件

每个 Agent 状态条包含：

| 元素 | 说明 |
|------|------|
| 图标 + 名称 | 固定左侧 |
| 状态标签 | 右侧：⏳ 等待 / 🔄 执行中 / ✅ 完成 / ❌ 失败 |
| 进度条 | 渐变色填充，带动画 |
| 摘要文字 | 一行简短说明当前在做什么 / 结果是什么 |

进度条颜色：
- 等待中：`#4b5563`（灰色）
- 进行中：`#8b5cf6 → #60a5fa` 渐变（紫→蓝）+ 微光扫过动画
- 完成：`#34d399`（绿色）
- 失败：`#ef4444`（红色）

### 3.3 SSE 事件映射

```
后端 SSE 事件                → 前端更新

agent_start(orchestrator)   → 显示 Orchestrator 进度条，状态=执行中
agent_progress(rag, 50%)    → 更新 RAG Agent 进度到 50%
agent_done(rag, summary)    → RAG Agent 状态=完成，显示摘要
agent_done(diag, summary)   → Diag Agent 状态=完成
agent_start(planner)        → Planner 状态=执行中
plan_generated(plan_json)   → 渲染执行计划图到区域 A
agent_start(safety)         → Safety Agent 状态=执行中
agent_done(safety, audit)   → Safety Agent 完成，显示预审结果

node_start(node_id)         → 更新图上对应节点为 running
node_done(node_id, result)  → 更新节点为 passed/failed
need_approve(node_id)       → 更新节点为 awaiting_approval
plan_done(audit_report)     → 渲染审计报告到区域 C
```

### 3.4 进度条微光扫过动画

```css
@keyframes shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

.agent-progress-bar.in-progress {
    background: linear-gradient(
        90deg,
        #8b5cf6 0%,
        #60a5fa 40%,
        #c4b5fd 50%,     /* 亮光扫过 */
        #60a5fa 60%,
        #8b5cf6 100%
    );
    background-size: 200% 100%;
    animation: shimmer 2s ease-in-out infinite;
}
```

---

## 四、区域 C：审计报告 UI

### 4.1 审计报告卡视觉设计

```
┌──────────────────────────────────────┐
│ 📋 自动审计报告                       │
│ Plan: 端口 8000 排查与处理            │
│ 2025-07-15 14:23:01                  │
├──────────────────────────────────────┤
│                                      │
│ ┌──────────────────────────────────┐ │
│ │         总体评级                  │ │
│ │    ✅ PASS (2 warnings)          │ │
│ │                                  │ │
│ │  节点: 6  执行: 5  跳过: 1       │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ── 审计发现 ──────────────────────── │
│                                      │
│ ⚠️ [WARN] 最小权限                   │
│ ┌────────────────────────────────┐  │
│ │ 节点: #5 kill -9 <PID>        │  │
│ │                                │  │
│ │ 使用了 kill -9（强制终止），    │  │
│ │ 建议优先使用 kill -15。        │  │
│ │                                │  │
│ │ 📄 依据: port-check.md §3.2   │  │
│ └────────────────────────────────┘  │
│                                      │
│ ⚠️ [WARN] 知识依据                   │
│ ┌────────────────────────────────┐  │
│ │ 节点: #4 风险评估               │  │
│ │                                │  │
│ │ 该判断由 LLM 生成，未找到      │  │
│ │ 精确匹配的 Runbook 依据。      │  │
│ │                                │  │
│ │ 💡 建议: 团队可补充相关 SOP    │  │
│ └────────────────────────────────┘  │
│                                      │
│ ── 逐节点审计 ───────────────────── │
│                                      │
│ ✅ #1 诊断命令 — PASS (grounded)    │
│ ✅ #2 条件判断 — PASS               │
│ ✅ #3 进程识别 — PASS (safe)        │
│ ⚠️ #4 风险评估 — WARN (unverified) │
│ ⚠️ #5 kill 进程 — WARN (权限)       │
│ ✅ #6 验证 — PASS                   │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ [导出 JSON] [导出 MD] [分享链接] │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 4.2 总体评级视觉

| 评级 | 背景色 | 图标 | 边框 |
|------|--------|------|------|
| PASS | `rgba(52,211,153,0.1)` | ✅ | `#34d399` |
| PASS_WITH_WARNINGS | `rgba(251,191,36,0.1)` | ⚠️ | `#fbbf24` |
| FAIL | `rgba(239,68,68,0.1)` | ❌ | `#ef4444` |

### 4.3 审计发现卡样式

```css
.audit-finding {
    border-left: 3px solid;
    border-radius: 6px;
    padding: 12px;
    margin: 8px 0;
    background: rgba(255,255,255,0.03);
}
.audit-finding.severity-warn {
    border-left-color: #fbbf24;
}
.audit-finding.severity-fail {
    border-left-color: #ef4444;
    background: rgba(239,68,68,0.06);
}
.audit-finding.severity-info {
    border-left-color: #60a5fa;
}
```

### 4.4 导出功能

**JSON 导出**：直接序列化 AuditReport 对象。

**Markdown 导出**：

```markdown
# 审计报告：端口 8000 排查与处理

- 会话 ID: abc-123
- 时间: 2025-07-15 14:23:01
- 总体评级: ✅ PASS (2 warnings)
- 节点总数: 6 | 执行: 5 | 跳过: 1

## 审计发现

### ⚠️ [WARN] 最小权限 — 节点 #5

kill -9 <PID>：使用了强制终止，建议优先使用 kill -15。
依据：port-check.md §3.2

...

## 逐节点审计

| # | 节点 | 状态 | 说明 |
|---|------|------|------|
| 1 | 诊断命令 | ✅ PASS | grounded |
| 2 | 条件判断 | ✅ PASS | — |
...
```

**分享链接**：生成只读 URL（`/audit/{report_id}`），带过期时间。

---

## 五、整体页面布局与响应式

### 5.1 桌面端布局（≥1024px）

```
┌─────────────────────────────────────────────────────────────┐
│ Header: 品牌 + 模式切换 + 执行器 + 知识库 + LLM + 状态     │
├──────────────────────────┬──────────────────────────────────┤
│                          │ [Tab: 执行图 | Agent | 审计]     │
│                          ├──────────────────────────────────┤
│      xterm.js 终端       │                                  │
│      (flex: 1)           │   当前激活的 Tab 内容             │
│                          │   (flex: 1, overflow: auto)      │
│                          │                                  │
│                          │                                  │
│                          │                                  │
├──────────────────────────┴──────────────────────────────────┤
│ Footer: [🔍 查端口] [🐳 Docker] [🔧 Git] [📚 自定义]       │
└─────────────────────────────────────────────────────────────┘

左侧: 45% 宽度（终端）
右侧: 55% 宽度（Tab 切换三个区域）
```

### 5.2 右侧 Tab 切换

右侧面板顶部加 Tab 栏，三个 Tab 对应三个区域：

| Tab | 图标 | 内容 | 何时自动激活 |
|-----|------|------|-------------|
| **执行图** | 🗺️ | 执行计划图 DAG | 计划生成后自动切换 |
| **Agent** | 🤖 | Agent 协作状态面板 | 用户输入意图后自动切换 |
| **审计** | 📋 | 审计报告 + 历史回合 | 执行完成后自动切换 |

Tab 切换带滑动过渡动画（transform + opacity）。

当执行计划图生成时，"执行图" Tab 右上角出现红点提示（有新内容）。

### 5.3 移动端 / 窄屏（< 768px）

左右分栏改为上下堆叠：终端在上，Tab 面板在下，可折叠。

---

## 六、后端 SSE 推送协议

### 6.1 API Endpoint

```python
@app.get("/api/plan/{plan_id}/stream")
async def stream_plan(plan_id: str):
    """SSE 推送 Agent 进度和执行进度"""
    async def generate():
        async for event in orchestrator.run_with_events(plan_id):
            yield f"event: {event.type}\ndata: {json.dumps(event.data)}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")
```

### 6.2 事件类型定义

```python
# Agent 生命周期事件
SSEEvent("agent_start",    {"agent": "rag", "task": "检索端口占用相关文档"})
SSEEvent("agent_progress", {"agent": "rag", "percent": 50, "detail": "已检索 2/4 个索引分片"})
SSEEvent("agent_done",     {"agent": "rag", "summary": "命中 3 篇文档", "duration_ms": 320})
SSEEvent("agent_error",    {"agent": "rag", "error": "embedding API timeout"})

# 计划生成事件
SSEEvent("plan_generated",  {"plan": ExecutionPlan.to_dict()})  # 完整计划图 JSON
SSEEvent("plan_pre_audit",  {"audit": PreAuditResult.to_dict()})

# 执行进度事件
SSEEvent("node_start",      {"node_id": "n3", "command": "ps -p 1234"})
SSEEvent("node_stdout",     {"node_id": "n3", "chunk": "PID TTY TIME CMD\n1234 ..."})
SSEEvent("node_done",       {"node_id": "n3", "status": "passed", "exit_code": 0})
SSEEvent("node_failed",     {"node_id": "n3", "status": "failed", "stderr": "..."})
SSEEvent("node_skipped",    {"node_id": "n5b", "reason": "条件分支未命中"})
SSEEvent("need_approval",   {"node_id": "n5a", "reason": "Risk: WARN，需人工确认"})

# 审计事件
SSEEvent("audit_complete",  {"report": AuditReport.to_dict()})
SSEEvent("plan_done",       {"summary": "6 节点，5 执行，1 跳过，PASS with 2 warnings"})
```

### 6.3 前端 SSE 消费

```javascript
class PlanStreamClient {
    constructor(planId, handlers) {
        this.planId = planId;
        this.handlers = handlers; // { onAgentStart, onPlanGenerated, onNodeStart, ... }
        this.source = null;
    }

    connect() {
        this.source = new EventSource(`/api/plan/${this.planId}/stream`);

        this.source.addEventListener("agent_start", (e) => {
            const data = JSON.parse(e.data);
            this.handlers.onAgentStart?.(data);
        });

        this.source.addEventListener("plan_generated", (e) => {
            const data = JSON.parse(e.data);
            this.handlers.onPlanGenerated?.(data.plan);
        });

        this.source.addEventListener("node_start", (e) => {
            const data = JSON.parse(e.data);
            this.handlers.onNodeStart?.(data.node_id);
        });

        this.source.addEventListener("node_done", (e) => {
            const data = JSON.parse(e.data);
            this.handlers.onNodeDone?.(data.node_id, data.status);
        });

        this.source.addEventListener("need_approval", (e) => {
            const data = JSON.parse(e.data);
            this.handlers.onNeedApproval?.(data.node_id, data.reason);
        });

        this.source.addEventListener("audit_complete", (e) => {
            const data = JSON.parse(e.data);
            this.handlers.onAuditComplete?.(data.report);
        });

        this.source.addEventListener("plan_done", (e) => {
            const data = JSON.parse(e.data);
            this.handlers.onPlanDone?.(data);
            this.disconnect();
        });

        this.source.onerror = () => {
            this.handlers.onError?.("SSE 连接断开");
        };
    }

    disconnect() {
        if (this.source) {
            this.source.close();
            this.source = null;
        }
    }
}
```

---

## 七、完整交互流程时序

```
用户输入 "端口 8000 被占用"
    │
    │  POST /api/plan/generate
    ▼
┌─ 右侧自动切换到 [Agent] Tab ─────────────────────┐
│                                                   │
│  SSE: agent_start(orchestrator)                   │
│    → Orchestrator 进度条开始                       │
│                                                   │
│  SSE: agent_start(rag) + agent_start(diag)        │
│    → RAG 和 Diag 同时开始，进度条并行推进          │
│                                                   │
│  SSE: agent_done(rag, "命中 3 篇") + 100%         │
│  SSE: agent_done(diag, "EADDRINUSE") + 100%       │
│                                                   │
│  SSE: agent_start(planner) → 进度条开始            │
│  SSE: agent_progress(planner, 60%)                │
│                                                   │
│  SSE: plan_generated(plan_json)                   │
│    → 自动切换到 [执行图] Tab                       │
│    → PlanGraphRenderer.render(plan)               │
│    → 所有节点 status=pending                       │
│                                                   │
│  SSE: agent_start(safety) → Safety 预审           │
│  SSE: plan_pre_audit(result)                      │
│    → 图上方显示 "预审: ✅ 通过 (2 warnings)"       │
│    → 操作栏出现 [▶️ 开始执行] 按钮                 │
│                                                   │
└───────────────────────────────────────────────────┘

用户点击 [▶️ 开始执行]
    │
    │  POST /api/plan/{id}/execute
    ▼
┌─ 执行图实时追踪 ──────────────────────────────────┐
│                                                   │
│  SSE: node_start(n1) → 节点 1 变为 🟡 running     │
│  SSE: node_done(n1, passed) → 节点 1 变为 🟢       │
│  SSE: node_start(n2) → 条件判断…                  │
│  SSE: node_done(n2, passed) → 分支选择"有进程占用" │
│  SSE: node_skipped(n3b) → "无占用"分支灰化          │
│  SSE: node_start(n3a) → 识别进程…                  │
│  SSE: node_done(n3a, passed)                      │
│  SSE: node_start(n4) → 风险评估…                  │
│  SSE: node_done(n4, passed) → 选择"非关键进程"     │
│                                                   │
│  SSE: need_approval(n5a, "Risk: WARN")            │
│    → 节点 5a 变为 🔔 awaiting_approval             │
│    → 节点详情浮层自动弹出，显示确认按钮             │
│                                                   │
│  用户点击 [批准执行]                               │
│    POST /api/plan/{id}/node/n5a/approve            │
│                                                   │
│  SSE: node_start(n5a) → kill PID 执行中            │
│  SSE: node_done(n5a, passed)                      │
│  SSE: node_start(n6) → 验证端口释放…               │
│  SSE: node_done(n6, passed)                       │
│                                                   │
│  SSE: audit_complete(report)                      │
│    → 自动切换到 [审计] Tab                         │
│    → 渲染审计报告                                  │
│                                                   │
│  SSE: plan_done(summary)                          │
│                                                   │
└───────────────────────────────────────────────────┘
```

---

## 八、实现排期

| 天数 | 任务 | 产出 |
|------|------|------|
| Day 1 | 后端：ExecutionPlan 数据结构 + Planner Agent 生成 DAG JSON | 可通过 API 拿到计划图 JSON |
| Day 2 | 前端：PlanGraphRenderer 核心渲染（dagre + D3 + 节点/边绘制） | 静态 DAG 图可渲染 |
| Day 3 | 前端：节点状态动画 + 详情浮层 + 操作栏 | 可交互的计划图 |
| Day 4 | 后端：SSE 推送 + 逐节点执行引擎 | 可实时追踪执行进度 |
| Day 5 | 前端：SSE 消费 + 实时高亮 + Tab 切换 + Agent 面板 | 完整的实时执行追踪 |
| Day 6 | 后端：Safety Agent 审计逻辑 + 审计报告生成 | 自动审计 JSON 输出 |
| Day 7 | 前端：审计报告 UI + 导出功能 + 整体联调 | 完整可演示的流程 |

**最小可行版本（3 天）**：Day 1-3，可展示静态执行计划图 + 预审结果，已经足够在评委面前展示差异化。剩余天数补充实时追踪和审计。
