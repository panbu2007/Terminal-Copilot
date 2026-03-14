# Torch 无法识别 CUDA

适用场景：
- 已安装 NVIDIA 驱动和 CUDA，但 PyTorch 仍显示 GPU 不可用
- 推理或训练服务启动时退回 CPU

症状：
- `torch.cuda.is_available()` 返回 `False`
- 程序提示找不到 CUDA device
- 安装了 GPU 版框架但仍走 CPU

快速判断：

```bash
nvidia-smi
python -c "import torch; print(torch.__version__); print(torch.cuda.is_available())"
```

修复步骤：

1. 先确认驱动正常
- `nvidia-smi` 必须正常

2. 确认 Python 环境中的 torch 版本
- 当前环境可能装的是 CPU 版 torch

3. 重新安装匹配版本
- 按 PyTorch 官方方式安装与当前驱动 / CUDA 兼容的版本

4. 检查环境污染
- 避免系统 Python、venv、conda 混装
- 确认当前执行的 `python` 与 `pip` 属于同一环境

回滚：
- 恢复到已验证可用的 torch 版本
- 重建虚拟环境，避免残留冲突包

验证：

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

风险提示：
- 驱动正常不代表 Python 环境正确
- 混用多个 Python 环境是高频问题

关键词：
- torch cuda not available
- pytorch gpu false
- torch cuda is_available false
- nvidia-smi ok but torch false
- gpu 不可用
- pytorch cuda
- cuda 检测
- torch 环境冲突

