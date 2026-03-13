# Terminal Copilot

Terminal Copilot 是一个由 FastAPI 提供后端、静态网页提供前端的 Web 终端智能副驾。它把“在终端里自己排查、试错、切换命令和查文档”的流程，收敛成一个可交互、可执行、可审计的辅助界面。

当前项目已经不只是简单的“命令建议器”，而是一个同时包含真实终端、规则规划、多 Agent 协作、知识库检索、执行计划图、风险拦截和执行审计的完整原型。

## 当前能力

- 真实 Web 终端：通过 `/ws/terminal/{session_id}` 提供 PTY WebSocket 终端体验。
- AI 建议流：`/api/suggest/stream` 通过 SSE 推送多 Agent 协作进度和最终建议。
- 规则优先规划：`backend/app/planner.py` 负责规则式建议与执行计划生成。
- 执行计划模式：支持生成 DAG 计划、流式执行、节点审批、跳过、取消和审计报告。
- 安全护栏：`policy.py` 对命令分级为 `safe`、`warn`、`block`，高风险命令需要确认或直接拦截。
- 自动校验：`verifier.py` 会对部分执行结果追加验证步骤。
- Runbook 知识库：运行时检索 `docs/runbook/*.md`，并支持前端上传自定义 Markdown runbook。
- LLM 可选增强：未配置 Token 时走规则路径；配置后可启用多 Agent 协作和模型增强建议。
- 前端可视化：包含 D3 + dagre 执行计划图、Agent 协作面板、Audit & History 面板、建议置信度徽标和新手引导卡片。

## 技术栈

- 后端：FastAPI、Pydantic v2、Uvicorn
- 前端：原生 HTML/CSS/JavaScript，无构建步骤
- 终端：xterm.js
- 图可视化：D3、dagre
- 知识检索：本地 Markdown runbook 检索

依赖非常轻量，仓库根目录的 [requirements.txt](/C:/pb/programs/terminal_copilot/requirements.txt) 当前只有：

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
├─ backend/app/plan_executor.py # 计划执行与 SSE 事件
├─ backend/app/policy.py        # 风险分级
├─ backend/app/verifier.py      # 执行后校验
├─ backend/app/rag.py           # Runbook 检索
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

`/api/health` 当前会返回以下关键信息：

- `status`
- `executor`
- `persist_client_state`
- `pty_supported`

## 主要接口

### 会话与终端

- `GET /api/health`
- `GET /api/executor/status`
- `POST /api/executor/mode`
- `POST /api/session/new`
- `GET /api/session/new`
- `GET /api/session/{session_id}`
- `GET /api/session/{session_id}/events`
- `GET /api/export/{session_id}`
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
- `api_execute` 会在服务端维护每个 session 的 `cwd`，并将 `cd` 作为内建行为处理，而不是单独起子进程。
- 本地执行默认受 `TERMINAL_COPILOT_LOCAL_ROOT` 约束，防止 `cd` 越界。
- 风险命令先经过 `policy.py`，必要时触发确认或拦截。
- 执行完成后可能由 `verifier.py` 补充验证步骤，并写入时间线与审计面板。

## 多 Agent 与规划流程

`/api/suggest/stream` 的当前行为是：

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

## Runbook 知识库

- 运行时知识来源目录是 [docs/runbook](/C:/pb/programs/terminal_copilot/docs/runbook)。
- 当前仓库内约有 52 篇 Markdown runbook。
- 前端支持上传和管理自定义 runbook。
- `rag.py` 对文档加载有缓存，更新 runbook 后通常需要重启服务让检索内容刷新生效。

## LLM 与本地 Secrets

- 本地配置由 [backend/app/local_secrets.py](/C:/pb/programs/terminal_copilot/backend/app/local_secrets.py) 管理。
- Token、Provider、Base URL、Model 等信息会写入 `.secrets/` 下的本地文件。
- `.secrets/` 不应提交到版本库。
- 当未配置 Token 时，系统仍可使用规则引擎与 runbook 检索工作。

## 部署

仓库内已经包含面向当前 Linux 服务器的部署脚本：

- [scripts/deploy_server.ps1](/C:/pb/programs/terminal_copilot/scripts/deploy_server.ps1)
- [scripts/deploy_server.sh](/C:/pb/programs/terminal_copilot/scripts/deploy_server.sh)

默认目标信息：

- 主机：`root@47.100.65.191`
- 应用目录：`/opt/terminal_copilot`
- systemd 服务：`terminal-copilot`
- 健康检查：`curl http://127.0.0.1:8000/api/health`

常用命令：

```bash
systemctl status terminal-copilot --no-pager
journalctl -u terminal-copilot -n 200 --no-pager
systemctl restart terminal-copilot
```

Windows 上可直接执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy_server.ps1
```

Linux/macOS 上可执行：

```bash
bash scripts/deploy_server.sh
```

## Docker

仓库包含 [Dockerfile](/C:/pb/programs/terminal_copilot/Dockerfile)，可用于容器化运行：

```bash
docker build -t terminal-copilot .
docker run --rm -p 7860:7860 terminal-copilot
```

容器默认通过 `python app.py` 启动，并监听 `PORT` 或默认端口 `7860`。

## 文档入口

- [docs/deployment.md](/C:/pb/programs/terminal_copilot/docs/deployment.md)
- [docs/judge-script.md](/C:/pb/programs/terminal_copilot/docs/judge-script.md)
- [docs/demo-1-docker-mirror.md](/C:/pb/programs/terminal_copilot/docs/demo-1-docker-mirror.md)
- [docs/demo-2-fix-typo.md](/C:/pb/programs/terminal_copilot/docs/demo-2-fix-typo.md)
- [docs/demo-3-cross-platform.md](/C:/pb/programs/terminal_copilot/docs/demo-3-cross-platform.md)
- [docs/2026-03-04-final-iteration-deliverables.md](/C:/pb/programs/terminal_copilot/docs/2026-03-04-final-iteration-deliverables.md)
- [作品项目说明文档.md](/C:/pb/programs/terminal_copilot/作品项目说明文档.md)

## Demo 视频

- [端口占用1.mp4](/C:/pb/programs/terminal_copilot/端口占用1.mp4)
- [端口占用2.mp4](/C:/pb/programs/terminal_copilot/端口占用2.mp4)
- [docker换源.mp4](/C:/pb/programs/terminal_copilot/docker换源.mp4)
- [纠错与修复.mp4](/C:/pb/programs/terminal_copilot/纠错与修复.mp4)

## 开发说明

- 这是一个无前端构建步骤的项目，修改前端时直接编辑源文件即可。
- `frontend/static/app.js` 体量较大，适合做定点修改而不是整文件重写。
- 当前仓库没有自动化测试；改动后建议至少启动服务并验证受影响接口或页面路径。
- 如果你修改了 runbook、执行逻辑或计划流，请同时检查前后端事件格式是否仍然兼容。
