# Open WebUI 连接 Ollama 与 vLLM

适用场景：
- 已完成 Open WebUI 安装，需要接入本地或远程推理后端
- 需要让 Open WebUI 连接 Ollama
- 需要让 Open WebUI 连接 OpenAI-compatible 服务，例如 vLLM

症状：
- Open WebUI 页面能打开，但没有模型可用
- 提示连接失败
- 容器里的 Open WebUI 无法访问宿主机上的 Ollama
- OpenAI-compatible 连接成功但推理时报模型不存在

快速判断：

```bash
curl http://127.0.0.1:11434/api/tags
curl http://127.0.0.1:8000/v1/models
docker ps
```

官方参考：
- Open WebUI Quick Start: https://docs.openwebui.com/getting-started/quick-start/
- Open WebUI Starting with Ollama: https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-ollama/
- Open WebUI Starting with OpenAI: https://docs.openwebui.com/getting-started/quick-start/starting-with-openai
- Open WebUI connection troubleshooting: https://docs.openwebui.com/troubleshooting/connection-error

修复步骤：

1. 连接 Ollama
- 如果 Open WebUI 与 Ollama 在同一台主机上，先确认：

```bash
curl http://127.0.0.1:11434/api/tags
```

- 在 Open WebUI 中进入连接设置，使用 Ollama 协议连接
- 如果 WebUI 运行在容器里，而 Ollama 在宿主机：
  - Linux 常见方案：使用 host network
  - 或显式配置 `OLLAMA_BASE_URL`

参考思路：

```bash
docker run -d \
  --network=host \
  -v open-webui:/app/backend/data \
  -e OLLAMA_BASE_URL=http://127.0.0.1:11434 \
  --name open-webui \
  --restart always \
  ghcr.io/open-webui/open-webui:main
```

2. 连接 vLLM
- 先确认 vLLM 已启动并返回模型列表：

```bash
curl http://127.0.0.1:8000/v1/models
```

- 在 Open WebUI 中使用 OpenAI-compatible 方式接入
- Base URL 示例：

```text
http://127.0.0.1:8000/v1
```

- 模型名必须与 vLLM 暴露出的模型标识一致

3. 处理常见连接失败
- Ollama 侧：
  - 检查 `OLLAMA_HOST`
  - 检查 11434 监听地址
  - 检查容器到宿主机的网络可达性
- vLLM 侧：
  - 检查 8000 监听地址和 `/v1/models`
  - 检查代理或防火墙
  - 检查模型是否真正加载完成

4. 推理验证
- 在 Open WebUI 里新建会话并选择模型
- 若使用推理模型，按官方建议配置对应解析器或模型展示方式

回滚：
- 移除错误连接配置
- 恢复到上一个可用后端
- 如果是容器网络问题，恢复上一个稳定容器参数

验证：
- Open WebUI 中能看到模型
- 可以发起一次最小对话
- 后端服务日志中能看到对应请求

风险提示：
- 容器里的 WebUI 访问宿主机服务是高频问题点
- Ollama 与 vLLM 的连接方式不同，不要混用协议
- 若对外开放 Open WebUI，必须额外做鉴权、HTTPS 和网络限制

关键词：
- open webui ollama
- open webui vllm
- openai compatible
- ollama base url
- open-webui connection error
- open webui 模型连接
- vllm connection
- ollama 11434

