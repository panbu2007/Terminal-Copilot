# Terminal Copilot

Terminal Copilot 的定位不是“另一个会生成命令的终端 AI”，而是一个面向终端场景的 AI 知识执行引擎。

它要解决的核心问题是终端 AI 的信任危机:

- AI 给了一条命令，用户敢不敢直接执行。
- AI 在生产环境里做了事，团队能不能事后追溯。
- 老员工的 Runbook 和操作经验，能不能变成新人的可执行流程。

Terminal Copilot 给出的答案是一个闭环:

- 知识资产化：把团队 Runbook 变成 AI 可检索、可引用的依据。
- 执行前可视化审查：把 AI 建议展开成可审查的 DAG 执行计划。
- 执行后自动审计：把每一步执行结果沉淀成结构化审计报告。

一句话概括:

> AI 不仅帮你做事，还能证明它为什么这样做、做了什么、结果是否可信。

## 产品定位

**Terminal Copilot: 终端场景的 AI 知识执行引擎**

把团队操作经验变成可检索、可执行、可审计的智能工作流。

相比 Claude Code、Warp 等通用终端 AI，Terminal Copilot 的差异不在“会不会生成命令”，而在于它围绕企业落地补上了信任与治理层：

- 它不只展示命令，而是展示完整执行路径、风险和回滚思路。
- 它不只执行命令，而是把执行前审查、执行中追踪、执行后审计串成闭环。
- 它不只依赖通用训练数据，而是允许团队把内部 Runbook 变成 AI 的依据层。

Web 形态在这里不是妥协，而是优势，因为可视化审查、团队协作、审计导出、权限控制都更适合在可共享的图形界面中完成。

## 行业痛点

### 1. AI 命令信任危机

用户最常见的问题不是“AI 会不会写命令”，而是“这条命令我敢不敢执行”。

Terminal Copilot 的应对方式：

- 在执行前生成 DAG 执行计划图。
- 展示节点关系、分支、风险等级、依据和审批点。
- 支持先审查、再批准、再执行，而不是直接把命令甩给用户。

### 2. AI 操作审计黑洞

很多 CLI 工具执行完即结束，缺少可回放、可归责、可导出的审计材料。

Terminal Copilot 的应对方式：

- 对计划执行过程发出结构化事件流。
- 在执行完成后生成 PASS/WARN/FAIL 审计报告。
- 支持导出 JSON/Markdown，便于复盘、交接和合规留痕。

### 3. 团队知识黑箱

通用终端 AI 通常不了解团队内部 SOP、故障处理经验和组织特定约束。

Terminal Copilot 的应对方式：

- 将 `docs/runbook/*.md` 作为运行时知识库。
- 支持前端上传自定义 Markdown runbook。
- 在检索结果中附带来源标注，让建议具备可追溯依据。

### 4. 新人培训瓶颈

给新人一个终端 AI，不等于教会他完整流程。

Terminal Copilot 的应对方式：

- 把 SOP 组织成 DAG 计划和逐步执行流。
- 支持验证节点、条件分支、审批等待和跳过。
- 让新人沿着标准化路径完成任务，而不是只拿到一条孤立命令。

## 三大核心能力

### 1. 知识资产化

- 组织 Runbook -> 检索层 -> AI 可引用依据。
- 当前默认知识源是 [docs/runbook](docs/runbook/) 下的 Markdown 文档。
- 基础检索由 [backend/app/rag.py](backend/app/rag.py) 提供 BM25 + 标题/关键词 rerank。
- 仓库还包含 [backend/app/rag_v2.py](backend/app/rag_v2.py) 的混合向量检索链路：embedding 可用时走向量检索 + 关键词检索 + RRF 融合，不可用时自动退化为关键词检索。
- 默认 embedding provider 为 Modelscope，默认模型是 `BAAI/bge-small-zh-v1.5`，也支持切换其他 provider/model。

### 2. 可视化执行计划

- [backend/app/planner.py](backend/app/planner.py) 负责规则优先的建议和执行计划生成。
- [frontend/static/app.js](frontend/static/app.js) 结合 D3 + dagre 渲染 DAG 执行计划图。
- 执行前可查看完整路径、风险、依据、审批点。
- 执行中可实时追踪节点状态、stdout/stderr、审批、跳过与取消。

### 3. 自动审计

- [backend/app/agents/safety_agent.py](backend/app/agents/safety_agent.py) 会对建议和执行计划做安全分析。
- [backend/app/plan_executor.py](backend/app/plan_executor.py) 在计划执行后汇总结构化审计报告。
- 前端 Audit 面板支持展示总体结论、逐节点状态、Safety Analysis 和建议动作。
- 当前前端支持将审计结果导出为 JSON 或 Markdown。

## 当前能力

- 真实 Web 终端：通过 `/ws/terminal/{session_id}` 提供 PTY WebSocket 终端体验。
- AI 建议流：`/api/suggest/stream` 通过 SSE 推送多 Agent 协作进度和最终建议。
- 多 Agent 协作：orchestrator 协调 diag/rag/executor/safety 四类 Agent。
- 规则优先规划：规则路径始终可用，未配置 LLM 时也能提供结构化建议。
- DAG 执行计划：支持生成、流式执行、节点审批、跳过、取消和执行后审计。
- 风险护栏：`policy.py` 将命令分为 `safe`、`warn`、`block`。
- 自动校验：`verifier.py` 会为部分场景追加验证步骤。
- Runbook 管理：运行时检索仓库 runbook，并支持上传自定义知识文档。
- 审计与导出：保留执行时间线、计划事件和审计报告，支持导出。

## 技术栈

- 后端：FastAPI、Pydantic v2、Uvicorn
- 前端：原生 HTML/CSS/JavaScript，无构建步骤
- 终端：xterm.js
- 图可视化：D3、dagre
- 检索：本地 Markdown Runbook 检索 + 可选混合向量 RAG

仓库根目录的 [requirements.txt](requirements.txt) 当前只有：

- `fastapi`
- `uvicorn[standard]`
- `pydantic`

## 项目结构

```text
terminal_copilot/
├─ app.py                       # Hosted 环境入口
├─ backend/app/main.py          # FastAPI 主入口与核心 API
├─ backend/app/models.py        # Pydantic 模型
├─ backend/app/planner.py       # 规则建议与计划生成
├─ backend/app/plan_executor.py # 计划执行与 SSE 事件 + 审计汇总
├─ backend/app/policy.py        # 风险分级
├─ backend/app/verifier.py      # 执行后校验
├─ backend/app/rag.py           # 关键词/BM25 Runbook 检索
├─ backend/app/rag_v2.py        # 混合向量 RAG + RRF 融合
├─ backend/app/local_secrets.py # 本地 secrets 持久化
├─ backend/app/agents/          # 多 Agent 协作
├─ backend/app/executor/        # local / simulate 执行器
├─ frontend/index.html          # 前端入口
├─ frontend/static/app.js       # 前端主逻辑
├─ frontend/static/styles.css   # 样式
├─ docs/runbook/                # 运行时知识库
└─ scripts/deploy_server.*      # 部署脚本
```

## 快速开始

### 1. 安装依赖

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

Linux/macOS:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. 本地启动

开发模式：

```bash
python -m uvicorn backend.app.main:app --reload --port 8000
```

Hosted 风格入口：

```bash
python app.py
```

### 3. 访问

- 首页：`http://127.0.0.1:8000`
- 健康检查：`http://127.0.0.1:8000/api/health`

`/api/health` 当前会返回这些关键信息：

- `status`
- `executor`
- `persist_client_state`
- `pty_supported`

## 主要接口

### 会话与终端

- `GET /api/health`
- `GET /api/executor/status`
- `POST /api/executor/mode`
- `POST /api/sessions/new`
- `GET /api/sessions/new`
- `GET /api/sessions/{session_id}`
- `GET /api/sessions/{session_id}/events`
- `GET /api/sessions/{session_id}/export`
- `WS /ws/terminal/{session_id}`

### 建议与执行

- `POST /api/suggest`
- `POST /api/suggest/stream`
- `POST /api/execute`
- `POST /api/interrupt`

### 执行计划

- `POST /api/plan/generate`
- `POST /api/plan/{plan_id}/execute`
- `GET /api/plan/{plan_id}/stream`
- `POST /api/plan/{plan_id}/node/{node_id}/approve`
- `POST /api/plan/{plan_id}/node/{node_id}/skip`
- `POST /api/plan/{plan_id}/cancel`

### LLM 与知识库

- `GET /api/llm/status`
- `POST /api/llm/token`
- `POST /api/llm/config`
- `POST /api/llm/test`
- `GET /api/runbooks`
- `POST /api/runbooks`
- `DELETE /api/runbooks/{filename}`

## 执行与安全模型

- 执行器支持 `simulate` 和 `local` 两种模式，前端可切换。
- `api_execute` 会在服务端维护每个 session 的 `cwd`，并将 `cd` 作为内建行为处理。
- 本地执行默认受 `TERMINAL_COPILOT_LOCAL_ROOT` 约束，防止 `cd` 越界。
- 风险命令先经过 `policy.py`，必要时触发确认或直接拦截。
- 计划生成后支持 pre-audit，执行结束后会汇总 execution audit。

## 多 Agent 与执行闭环

`/api/suggest/stream` 的当前行为：

1. 先尝试规则建议。
2. 如果已配置 LLM，则由 orchestrator 协调 `diag_agent`、`rag_agent`、`executor_agent`、`safety_agent`。
3. 通过 SSE 向前端连续推送 Agent 进度事件。
4. 返回最终建议列表和步骤数据。

执行计划由 `planner.py` 生成，`plan_executor.py` 负责：

- 节点生命周期事件
- 命令输出流式推送
- 审批等待
- 跳过/取消
- 自动审计报告

这对应产品上的完整闭环：

1. 先用知识库给出有依据的建议。
2. 再把建议展开成可审查的执行计划。
3. 最后把执行结果汇总成可导出的审计材料。

## Runbook 知识库

- 运行时知识来源目录是 [docs/runbook](docs/runbook/)。
- 当前仓库内有大量 Markdown runbook，可直接参与运行时检索。
- 前端支持上传和管理自定义 runbook。
- `rag.py` 与 `rag_v2.py` 对文档加载和向量缓存都有缓存机制，更新知识库后通常需要重启服务。

## LLM 与本地 Secrets

- 本地配置由 [backend/app/local_secrets.py](backend/app/local_secrets.py) 管理。
- Token、Provider、Base URL、Model 等信息会写入 `.secrets/` 下的本地文件。
- `.secrets/` 不应提交到版本库。
- 当未配置 Token 时，系统仍可使用规则引擎与 Runbook 检索工作。

## 部署

仓库内已经包含跨平台部署脚本示例：

- [scripts/deploy_server.ps1](scripts/deploy_server.ps1)
- [scripts/deploy_server.sh](scripts/deploy_server.sh)

实际生产环境中的主机地址、账号、路径、服务名等部署细节不应出现在公开 `README` 中，建议通过环境变量、私有运维文档或 CI/CD 配置管理。

Windows 上可直接执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy_server.ps1
```

Linux/macOS 上可执行：

```bash
bash scripts/deploy_server.sh
```

## Docker

仓库包含 [Dockerfile](Dockerfile)，可用于容器化运行：

```bash
docker build -t terminal-copilot .
docker run --rm -p 7860:7860 terminal-copilot
```

容器默认通过 `python app.py` 启动，并监听 `PORT` 或默认端口 `7860`。

## 文档入口

- Runbook 知识库：[docs/runbook](docs/runbook/)
- 项目说明文档：[作品项目说明文档.md](作品项目说明文档.md)

## Demo 视频

- [端口占用1.mp4](./端口占用1.mp4)
- [端口占用2.mp4](./端口占用2.mp4)
- [docker换源.mp4](./docker换源.mp4)
- [纠错与修复.mp4](./纠错与修复.mp4)

## 开发说明

- 这是一个无前端构建步骤的项目，修改前端时直接编辑源文件即可。
- `frontend/static/app.js` 体量较大，适合做定点修改而不是整文件重写。
- 当前仓库没有自动化测试；改动后建议至少启动服务并验证受影响接口或页面路径。
- 如果你修改了 Runbook、执行逻辑或计划流，请同时检查前后端事件格式是否仍然兼容。
