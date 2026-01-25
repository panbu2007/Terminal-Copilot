# Terminal Copilot（Web 终端智能副驾）

Terminal Copilot 将“命令行靠记忆 + 反复试错”的工作方式升级为“意图驱动 + 可执行建议 + 可验证闭环”的任务流：在 Web 终端中输入一句话或上下文，即可得到下一步命令（含 why/risk/rollback/verify），支持一键执行，并将过程沉淀到右侧任务流时间线。

## 特性

- **结构化建议**：命令 + 解释（why）+ 风险（risk）+ 回滚（rollback）+ 验证（verify）。
- **可执行闭环**：建议 → 执行 → 校验 → 下一步建议，自动形成回合时间线。
- **可解释依据（RAG）**：从仓库内 runbook 文档检索引用，建议可附带 snippet + source。
- **安全护栏**：对高风险命令进行 block/warn/confirm，避免误操作。
- **双执行器**：`simulate`（安全演示）与 `local`（真实执行）可切换。
- **LLM 可选增强**：未配置 Token 时可用规则建议；配置 Token 后自动启用 LLM 增强。
- **跨平台建议**：平台相关命令以“后端/执行器运行环境”为准生成（例如 Linux 环境输出 `ss/lsof`，不会被浏览器 OS 误导）。

## Demo 视频（仓库内 4 段）

- 端口占用（1）：[端口占用1.mp4](./端口占用1.mp4)
- 端口占用（2）（不同系统适配）：[端口占用2.mp4](./端口占用2.mp4)
- Docker 换源：[docker换源.mp4](./docker换源.mp4)
- 纠错与修复：[纠错与修复.mp4](./纠错与修复.mp4)

## 快速开始（本地）

后端使用 FastAPI 同时托管 API 与静态前端（无需 Node.js）。

### 1) 安装依赖

Windows PowerShell：

```bash
python -m venv .venv
.venv\Scripts\pip install -r backend\requirements.txt
```

Linux/macOS：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
```

### 2) 启动

开发模式（热重载）：

```bash
python -m uvicorn backend.app.main:app --reload --port 8000
```


### 3) 访问

- `http://localhost:8000`（或 `http://localhost:7860`）
- 健康检查：`/api/health`

## 配置

### 执行器

- `TERMINAL_COPILOT_EXECUTOR=local`（默认）
- `TERMINAL_COPILOT_EXECUTOR=simulate`

### LLM（ModelScope OpenAI-compatible）

- Token：`MODELSCOPE_ACCESS_TOKEN`（优先级最高）
- Token（兼容）：`TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN`
- 模型：`TERMINAL_COPILOT_MODELSCOPE_MODEL`（默认 `Qwen/Qwen2.5-Coder-32B-Instruct`）
- 代理开关：`TERMINAL_COPILOT_LLM_ENABLED=auto|true|false`（默认 `auto`）

### RAG

- `TERMINAL_COPILOT_RAG_TOPK`：粗召回候选数（默认 10）

### 版本指纹（可选）

- `TERMINAL_COPILOT_BUILD_ID`：用于后端启动日志输出版本指纹（便于线上排查是否跑到最新镜像）

## 架构概览

```
Browser
  ├─ xterm.js：终端输入/输出 + 行内编辑
  ├─ 建议卡：命令/why/risk/rollback/verify + 引用依据
  └─ 时间线：按回合聚合 Plan / Execute / Verify / Next

FastAPI (backend/app/main.py)
  ├─ /api/suggest   Planner(规则/LLM) + RAG 引用
  ├─ /api/execute   Executor(simulate/local) + Policy + Verifier
  ├─ /api/interrupt 中断（local best-effort）
  └─ SessionStore   steps/events/导出回放
```

## 文档

- 演示脚本：
  - [docs/demo-1-docker-mirror.md](docs/demo-1-docker-mirror.md)
  - [docs/demo-2-fix-typo.md](docs/demo-2-fix-typo.md)
  - [docs/demo-3-cross-platform.md](docs/demo-3-cross-platform.md)
  - [docs/judge-script.md](docs/judge-script.md)
- Runbook（可被 RAG 引用）：[docs/runbook/](docs/runbook/)
- 项目说明（比赛提交版）：[作品项目说明文档.md](作品项目说明文档.md)

## Docker 部署

构建：

```bash
docker build -t terminal-copilot .
```

运行（默认容器端口 7860）：

```bash
docker run --rm -p 7860:7860 terminal-copilot
```

## ModelScope 创空间

创空间环境通常使用 `python app.py` 启动，本项目已提供入口，并兼容 `PORT` 注入。

## 安全与隐私

- 前端 Token 可保存在浏览器会话（sessionStorage）。
- 后端支持将 Token 落盘到 `.secrets/modelscope_access_token.txt`（已加入 gitignore），或完全使用环境变量注入。
- 代码层面提供命令风险分级与二次确认流程，降低误操作概率。

## FAQ

- 依赖缺失（`No module named uvicorn`）：[docs/runbook/python-venv-uvicorn.md](docs/runbook/python-venv-uvicorn.md)
- 端口占用（`Address already in use`）：[docs/runbook/port-check.md](docs/runbook/port-check.md)
- Docker 权限（`permission denied docker.sock`）：[docs/runbook/docker-permission-denied.md](docs/runbook/docker-permission-denied.md)
- Git 不是仓库（`not a git repository`）：[docs/runbook/git-not-a-repo.md](docs/runbook/git-not-a-repo.md)
