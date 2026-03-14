# Open WebUI 安装与启动

适用场景：
- 需要部署 Open WebUI 作为本地或内网的 AI Web 控制台
- 需要连接 Ollama、vLLM 或 OpenAI-compatible API
- 需要最小化部署、验证、升级和回滚路径

症状：
- Open WebUI 无法启动
- Web 页面打不开
- 数据目录丢失
- 容器启动但无法保存配置

快速判断：

```bash
docker ps
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1:8080
```

官方参考：
- Open WebUI docs: https://docs.openwebui.com/
- Installation guide: https://docs.openwebui.com/

修复步骤：

1. 选定安装方式
- 开发或单机体验：`uv` 或 `pip`
- 服务器和可重复部署：优先 Docker 或 Docker Compose

2. Docker 单容器方式

如果本机已运行 Ollama，可使用带数据卷的最小命令：

```bash
docker run -d \
  --name open-webui \
  -p 3000:8080 \
  -v open-webui:/app/backend/data \
  --restart unless-stopped \
  ghcr.io/open-webui/open-webui:main
```

生产环境建议固定版本号，不要长期使用浮动标签：
- `ghcr.io/open-webui/open-webui:<RELEASE_VERSION>`
- `ghcr.io/open-webui/open-webui:<RELEASE_VERSION>-ollama`
- `ghcr.io/open-webui/open-webui:<RELEASE_VERSION>-cuda`

3. `uv` 方式

macOS / Linux：

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
DATA_DIR=~/.open-webui uvx --python 3.11 open-webui@latest serve
```

Windows PowerShell：

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
$env:DATA_DIR="C:\open-webui\data"
uvx --python 3.11 open-webui@latest serve
```

4. `pip` 方式

```bash
pip install open-webui
open-webui serve
```

5. 页面验证
- 默认访问：
  - Docker 场景常见是 `http://localhost:3000`
  - 纯 Python 场景常见是 `http://localhost:8080`

6. 数据目录规划
- 必须固定 `DATA_DIR` 或容器卷
- 不要把数据仅保存在临时容器层

回滚：
- Docker：

```bash
docker stop open-webui
docker rm open-webui
```

- `uv` / `pip`：
  - 停掉进程
  - 恢复旧版本
  - 保留数据目录后再重装

验证：
- `docker logs open-webui --tail 100`
- `curl -I http://127.0.0.1:3000`
- 浏览器可正常打开页面并完成首次初始化

风险提示：
- 生产环境不要长期使用 `:main`
- 一定要保留数据目录，否则配置和会话可能丢失
- 若通过反向代理对外提供服务，需额外配置 HTTPS、鉴权与来源控制

关键词：
- open webui install
- open-webui docker
- open-webui uv
- open-webui serve
- open-webui data dir
- open-webui 部署
- ai web 控制台
- open webui 启动

