# Terminal Copilot（Web 终端智能副驾）

面向比赛的 AI 应用：把“记忆驱动的命令行”升级为“意图驱动的工作流”，在 Web 终端里提供下一步命令补全、步骤化执行、输出校验与安全护栏。

## 电梯稿（30 秒）

Terminal Copilot 把“用户敲命令 → 报错/卡住 → 搜索/问人 → 再敲命令”的低效循环，变成“输入一次 → 立刻得到下一步可执行建议（含 why/risk/rollback/verify）→ 一键执行 → 自动校验”的闭环。
它面向新同学/学生/运维新人：在不改变原有命令行习惯的前提下，用任务流时间线把零散命令串成可回放、可验收的工作流。

## 架构（简图）

```
Browser
	├─ xterm.js 终端输入/输出
	├─ 右侧任务流时间线（回合追加，不覆盖）
	└─ LLM 设置（仅前端会话存 Token；后端落盘到 .secrets 可选）
				│
				▼
FastAPI (backend/app/main.py)
	├─ /api/suggest   Planner(规则) + LLM fallback + Self-heal + RAG 引用
	├─ /api/execute   Executor(simulate/local) + Policy 护栏 + Verifier 校验
	├─ /api/interrupt Ctrl+C 中断（local best-effort）
	└─ SessionStore   steps/events/导出回放
				│
				▼
Local Executor (subprocess one-shot, supports cwd/cd)
```

## 评分点映射（主赛道常见维度）

| 评分维度 | 我们的落点 | 你可以怎么演示 |
| --- | --- | --- |
| 场景价值 | 新同学/运维新人“下一步该做什么” | Demo 1/2/3 任选，强调闭环与可验收 |
| 用户体验 | xterm 终端 + 回合时间线 + 一键执行 | 连续执行 2-3 条命令，右侧持续追加 |
| 工具整合 | Policy/Verifier/RAG/LLM fallback | 展示 warn 二次确认、校验步骤、引用依据 |
| 技术前瞻 | 结构化建议字段 + 轻量多 Agent 标签 | 建议卡展示 agent/why/risk/rollback/verify |
| 材料完整 | export 回放 + docs/demo 脚本 | 一键导出 events.json 作为“可回放证据” |

## 本地启动（开发）

> 本项目当前采用 **Python + FastAPI** 一体化启动，并由后端直接托管静态前端（不依赖 Node.js）。

1) 安装依赖

```bash
python -m venv .venv
# Windows PowerShell
.venv\Scripts\pip install -r backend\requirements.txt
```

2) 启动后端（同时托管前端）

```bash
.venv\Scripts\python -m uvicorn backend.app.main:app --reload --port 8000
```

3) 打开页面

- http://localhost:8000
- 健康检查：http://localhost:8000/api/health

## 魔搭创空间部署（建议）

创空间通常会用 `python app.py` 启动服务，本项目已提供入口：

```bash
python app.py
```

默认监听 `0.0.0.0:7860`（也兼容平台注入的 `PORT` 环境变量）。

执行器模式：
- 默认：`TERMINAL_COPILOT_EXECUTOR=local`
- 可切回：`TERMINAL_COPILOT_EXECUTOR=simulate`

建议引擎：
- 默认规则 Planner（零依赖）。
- 可选开启 ModelScope LLM fallback：默认 `auto`，当本地配置了 Token 即自动启用。
	- 页面右上角「LLM设置」可写入本地 `.secrets/modelscope_access_token.txt`
	- 也可用环境变量 `MODELSCOPE_ACCESS_TOKEN`（优先级更高）
	- 默认模型：`Qwen/Qwen2.5-Coder-32B-Instruct`（可用 `TERMINAL_COPILOT_MODELSCOPE_MODEL` 覆盖）

## Docker 部署（最小可用）

本仓库提供根目录 `Dockerfile`，后端用 FastAPI 直接托管静态前端（无需 Node.js）。

构建：

```bash
docker build -t terminal-copilot .
```

运行（默认监听 7860，可按需改端口映射）：

```bash
docker run --rm -p 7860:7860 terminal-copilot
```

容器内默认执行器为 `local`（在容器里真实执行命令，演示更接近“真终端”），同时 UI 仍可一键切回 `simulate`。

## Demo 脚本

见 docs 目录：
- Demo1：Docker 换源工作流（编辑配置→自动给出 reload/restart/验证）
- Demo2：纠错（缺参数/拼写错误→最小修复命令）
- Demo3：跨平台分支（Linux/macOS/Windows 给出不同路径）
