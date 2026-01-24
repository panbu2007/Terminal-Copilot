# Terminal Copilot（Web 终端智能副驾）

面向比赛的 AI 应用：把“记忆驱动的命令行”升级为“意图驱动的工作流”，在 Web 终端里提供下一步命令补全、步骤化执行、输出校验与安全护栏。

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
