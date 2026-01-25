# Terminal Copilot（Web 终端智能副驾）

面向比赛的 AI 应用：把“记忆驱动的命令行”升级为“意图驱动的工作流”，在 Web 终端里提供下一步命令补全、步骤化执行、输出校验与安全护栏。

## 电梯稿（30 秒）

Terminal Copilot 把“用户敲命令 → 报错/卡住 → 搜索/问人 → 再敲命令”的低效循环，变成“输入一次 → 立刻得到下一步可执行建议（含 why/risk/rollback/verify）→ 一键执行 → 自动校验”的闭环。
它面向新同学/学生/运维新人：在不改变原有命令行习惯的前提下，用任务流时间线把零散命令串成可回放、可验收的工作流。

## 项目亮点

- **闭环工作流**：建议不仅给命令，还给 why/risk/rollback/verify，并支持一键执行与结果校验。
- **可解释依据（RAG）**：从本地 runbook Markdown 检索引用，建议可附带“依据片段 + 来源文件（source）”，做到可追溯。
- **“宁缺毋滥”的引用策略**：短 query 更严格、长 query 更宽松，避免跑偏引用；并对关键词/标题命中做轻量 rerank。
- **安全护栏**：Policy 对危险命令提示与二次确认；Verifier 对输出做验证步骤。
- **面向比赛部署**：后端 FastAPI 直接托管静态前端（不依赖 Node.js）；可在 Linux 环境运行与演示。
- **开箱即用的 Token 引导**：启动/页面会提示“去 LLM 设置配置 Token”，避免“装好跑不起来”。

## 能做到什么（能力清单）

- 在 Web 终端里输入意图/上下文，获得结构化的下一步建议（命令 + 解释 + 风险 + 回滚 + 验证）。
- 一键执行建议命令（simulate/local 两种执行器），输出写回终端，并同步写入右侧“任务流时间线”。
- 对常见故障场景（依赖缺失、端口占用、权限问题、Docker/Git 常见坑等）给出可引用 runbook 的依据。
- 在未配置 LLM Token 时仍可用（规则 Planner 零依赖），配置后自动启用 LLM fallback。

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

## 评委 3 分钟看懂（高分作品演示脚本）

推荐直接按脚本演示：
- [docs/judge-script.md](docs/judge-script.md)

演示目标（用最少操作证明三件事）：
- 不是“命令词典/补全”，而是**可执行的下一步工作流**
- 每一步有**结构化解释**（why/risk/rollback/verify）+ **可追溯引用依据**（RAG）+ **安全护栏**（Policy）
- 过程形成**任务流时间线**（回合追加、不覆盖）并可**导出回放**

## 主场景与可复现任务流（建议选 2 条做闭环）

你可以把产品定位为：解决“新手不敢下手/不知道下一步/怕误操作”的终端工作流问题；同时给老手提供套路化提效。

推荐任务流（每条都按 Plan → Execute → Verify → Next → 总结）：
- 端口占用排查：`Address already in use` / `端口 8000 被占用吗`
- Python 依赖修复：`No module named uvicorn`
- Git 常见误操作/拼写修复：`git chekcout main`

仓库内可引用依据（runbook）：
- [docs/runbook/port-in-use-8000.md](docs/runbook/port-in-use-8000.md)
- [docs/runbook/linux-port-in-use.md](docs/runbook/linux-port-in-use.md)
- [docs/runbook/python-venv-uvicorn.md](docs/runbook/python-venv-uvicorn.md)
- [docs/runbook/git-not-a-repo.md](docs/runbook/git-not-a-repo.md)

## 指标化收益（建议在演示里讲出来）

为了更像“高分作品”，建议在 Demo 里做轻量对比并口播指标（不需要复杂埋点也能讲清楚）：
- 完成一次任务的时间（例如 60s 内闭环 1 条）
- 复制粘贴次数（从“搜命令”变成“一键执行/插入”）
- 试错次数/错误率（有 verifier/自愈后明显减少）

## 路线图（按评分标准倒推）

如果要继续冲高分，优先级建议按“评委能感知的体验”排序：

用户体验（Infinite UI / 任务流时间线）
- 右侧按回合分组展示：Plan（AI）→ Execute（系统）→ Verify（系统/规则）→ Next（AI）
- 长输出默认折叠，支持展开/下载；stderr 与失败 badge 高亮

终端交互（不做 PTY 也能加分）
- ↑↓ 历史回填
- Ctrl+C best-effort 中断（local）

结构化建议 + 可解释引用 + 失败自愈
- schema 更严格（JSON + 校验 + 轻量修复重试）
- exit_code != 0 时输出 2-4 步诊断链 + 验证命令

轻量 Multi-Agent 分工（技术前瞻加分项）
- Planner/Safety/Verifier 分工，并在 UI 与导出 events 中标注来源

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

如果页面提示 “Token 未配置”，点击右上角「LLM设置」粘贴 Token 即可启用 AI 建议功能。

## 配置（环境变量）

执行器：
- `TERMINAL_COPILOT_EXECUTOR=local`（默认）
- `TERMINAL_COPILOT_EXECUTOR=simulate`

LLM（ModelScope OpenAI-compatible）：
- Token：`MODELSCOPE_ACCESS_TOKEN`（优先级最高）
- Token（兼容）：`TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN`
- 模型：`TERMINAL_COPILOT_MODELSCOPE_MODEL`（默认 `Qwen/Qwen2.5-Coder-32B-Instruct`）

RAG（本地 Markdown 检索）：
- `TERMINAL_COPILOT_RAG_TOPK`：粗召回候选数（默认 10），越大覆盖越广但可能更噪；越小更稳但可能漏。

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

## RAG 设计（依据从哪里来、为什么不跑偏）

数据来源（本地仓库内 Markdown）：
- 主语料：`docs/runbook/**/*.md`（高频故障/运维操作的“可执行说明书”）
- 辅助语料：`docs/*.md`（精选；会排除 demo 与评测脚本类文档，避免噪音引用）

检索与排序策略（轻量、无外部依赖）：
- 分词后对正文/标题/“关键词”段落做计分；关键词/标题命中会加权。
- 先按主评分粗排取 TopK，再对关键词/标题做轻量 rerank。
- 采用自适应阈值：短 query 更谨慎（更高门槛），长 query 更容易返回依据。
- 引用会带 `source`（相对路径），前端展示出来，便于演示“依据可追溯”。

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
- [docs/demo-1-docker-mirror.md](docs/demo-1-docker-mirror.md)：Docker 换源工作流（编辑配置→自动给出 reload/restart/验证）
- [docs/demo-2-fix-typo.md](docs/demo-2-fix-typo.md)：纠错（缺参数/拼写错误→最小修复命令）
- [docs/demo-3-cross-platform.md](docs/demo-3-cross-platform.md)：跨平台分支（Linux/macOS/Windows 给出不同路径）

## VS Code 一键运行（推荐）

项目内置了 VS Code Tasks：
- 安装依赖：读取 `backend/requirements.txt`
- 启动服务：`uvicorn backend.app.main:app --reload --port 8000`

Task 会优先使用 VS Code 当前选择的 Python 解释器，减少“依赖装对了但跑错解释器”的问题。

## 安全与隐私

- 前端 Token 仅保存在浏览器会话（sessionStorage），不会写入仓库。
- 后端可选将 Token 落盘到本地 `.secrets/modelscope_access_token.txt`（便于部署环境复用），也可完全用环境变量注入。
- 建议：不要把 Token 提交到版本库；生产部署用环境变量更稳妥。

## FAQ / 排错

- 启动报 `No module named uvicorn`：见 [docs/runbook/python-venv-uvicorn.md](docs/runbook/python-venv-uvicorn.md)
- 端口占用（`Address already in use`）：见 [docs/runbook/port-in-use-8000.md](docs/runbook/port-in-use-8000.md) / [docs/runbook/linux-port-in-use.md](docs/runbook/linux-port-in-use.md) / [docs/runbook/port-check.md](docs/runbook/port-check.md)
- Docker 权限（`permission denied docker.sock`）：见 [docs/runbook/docker-permission-denied.md](docs/runbook/docker-permission-denied.md)
- Git 不是仓库（`not a git repository`）：见 [docs/runbook/git-not-a-repo.md](docs/runbook/git-not-a-repo.md)
