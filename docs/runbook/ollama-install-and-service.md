# Ollama 安装、启动与服务验证

适用场景：
- 需要在本机或服务器部署 Ollama，提供本地模型推理服务
- 需要验证 Ollama 是否已启动，并确认 API 可访问
- 需要为 Open WebUI、Aider、Continue 或其他 OpenAI-compatible 客户端准备本地模型入口

症状：
- `ollama` 命令不存在
- 模型无法运行
- `http://127.0.0.1:11434` 无法访问
- 其他工具提示无法连接 Ollama

快速判断：

```bash
command -v ollama
ollama -v
curl http://127.0.0.1:11434/api/tags
```

官方参考：
- Ollama docs: https://docs.ollama.com/
- Quickstart: https://docs.ollama.com/quickstart
- API: https://docs.ollama.com/api

修复步骤：

1. 安装 Ollama

Linux：

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

macOS / Windows：
- 从官方页面下载安装包并完成安装

2. 验证命令可用

```bash
ollama -v
```

3. 启动服务

如果系统安装后已自动注册服务，先检查：

```bash
systemctl status ollama --no-pager
```

如果没有 systemd service，可直接前台启动：

```bash
ollama serve
```

4. 拉取并运行一个最小模型

```bash
ollama pull qwen3:latest
ollama run qwen3:latest
```

5. 验证 API 是否可用

```bash
curl http://127.0.0.1:11434/api/tags
curl http://127.0.0.1:11434/api/generate -d '{
  "model": "qwen3:latest",
  "prompt": "Say OK",
  "stream": false
}'
```

6. 如果需要对外提供服务
- 优先使用反向代理
- 不建议直接把 11434 裸露到公网
- 生产环境优先加鉴权、限流和来源限制

回滚：
- 如果是包安装，按官方方式卸载
- 如果是 systemd service，停止并禁用服务：

```bash
systemctl stop ollama
systemctl disable ollama
```

- 清理模型缓存前先确认磁盘和业务影响

验证：
- `ollama -v` 正常输出版本
- `curl http://127.0.0.1:11434/api/tags` 返回模型列表
- `ollama run qwen3:latest` 可以完成一次最小对话

风险提示：
- 首次拉取模型会占用较大磁盘空间和带宽
- GPU 机器需要额外确认驱动与 CUDA/ROCm 环境
- 不要默认把本地推理端口直接暴露到公网

关键词：
- ollama install
- ollama service
- ollama serve
- ollama api
- ollama 11434
- ollama pull
- 本地模型服务
- ollama 启动

