# SGLang 安装与服务启动

适用场景：
- 需要在 GPU 机器上部署 SGLang 推理服务
- 需要准备 OpenAI-compatible 接口或高吞吐推理服务
- 安装时报 FlashInfer、CUDA_HOME、torch 兼容问题

症状：
- `sglang` 命令不存在
- 安装时报 `CUDA_HOME environment variable is not set`
- 启动时报依赖缺失或模型加载失败

快速判断：

```bash
nvidia-smi
python --version
echo $CUDA_HOME
```

官方参考：
- Install SGLang: https://docs.sglang.ai/start/install.html

修复步骤：

1. 先准备隔离环境

```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
```

2. 按官方建议安装

```bash
pip install uv
uv pip install "sglang[all]>=0.4.9.post4"
```

3. 如果遇到 `CUDA_HOME` 报错
- 显式设置 CUDA 安装目录：

```bash
export CUDA_HOME=/usr/local/cuda
```

- 或按官方建议先安装匹配 torch 版本的 FlashInfer，再安装 SGLang

4. 启动最小服务
- 按当前版本的启动方式加载一个小模型并监听本机端口
- 生产环境建议显式设置 host、port 和模型路径

5. 验证接口
- 通过服务的 HTTP 接口做最小请求
- 若接 OpenAI-compatible 客户端，确认基础路径与模型名一致

回滚：
- 停掉 SGLang 进程或 service
- 删除当前虚拟环境，恢复旧版本
- 恢复旧模型路径或旧启动参数

验证：
- 命令可执行
- 服务进程正常
- 最小请求成功返回

风险提示：
- SGLang、torch、FlashInfer 兼容关系变化快，优先参考官方安装文档
- 生产环境建议用容器或固定版本环境，减少依赖漂移
- 不要未经鉴权把推理端口直接暴露到公网

关键词：
- sglang install
- sglang cuda
- flashinfer
- CUDA_HOME
- sglang serve
- sglang model
- 推理服务
- openai compatible

