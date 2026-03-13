# vLLM 安装、CUDA 核对与服务启动

适用场景：
- 需要在 GPU 机器上部署 vLLM 提供 OpenAI-compatible 推理服务
- 需要核对 CUDA、PyTorch 与 vLLM 的兼容关系
- 需要最小化完成安装、启动和服务验证

症状：
- `vllm` 命令不存在
- 安装时报 CUDA / torch / wheel 兼容错误
- 服务启动失败或模型加载失败
- 其他客户端无法连接 vLLM 接口

快速判断：

```bash
nvidia-smi
python --version
python -c "import torch; print(torch.__version__)"
```

官方参考：
- vLLM installation: https://docs.vllm.ai/en/latest/getting_started/installation/
- vLLM quickstart: https://docs.vllm.ai/en/latest/getting_started/quickstart.html

修复步骤：

1. 先确认基础条件
- 操作系统：优先 Linux
- Python：官方文档当前支持 3.9 到 3.12
- GPU：确认驱动、CUDA、显卡算力满足要求

2. 使用干净环境安装

推荐先创建隔离环境：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -U pip
```

3. 安装 vLLM

标准安装：

```bash
pip install vllm
```

如果本机 CUDA / torch 组合与官方默认 wheel 不一致：
- 优先查官方安装文档对应版本说明
- 再决定使用特定 wheel 或源码编译

4. 启动最小服务

```bash
vllm serve Qwen/Qwen2.5-1.5B-Instruct
```

5. 验证服务

```bash
curl http://127.0.0.1:8000/v1/models
```

6. 如果需要固定监听地址和端口
- 按 vLLM 当前版本参数显式指定 host / port
- 生产环境建议只监听内网，再通过反向代理暴露

7. 如果接 Open WebUI 或其他 OpenAI-compatible 客户端
- Base URL 指向 vLLM 的 `/v1`
- 确认模型名与服务中实际加载的模型一致

回滚：
- 停掉 vLLM 进程或 service
- 删除当前虚拟环境，恢复旧版本
- 如果模型缓存过大，确认业务影响后再清理

验证：
- `python -c "import vllm; print(vllm.__version__)"`
- `curl http://127.0.0.1:8000/v1/models`
- 通过兼容客户端完成一次最小请求

风险提示：
- vLLM 与 CUDA / PyTorch 兼容问题很多，优先使用干净环境
- GPU 显存不足会导致加载失败或频繁 OOM
- 不要未经鉴权把 vLLM 服务直接暴露到公网

关键词：
- vllm install
- vllm cuda
- vllm serve
- vllm openai compatible
- vllm torch mismatch
- vllm 模型服务
- gpu 推理服务
- vllm 启动

