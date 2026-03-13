# ROCm 安装与基础检查

适用场景：
- 需要在 AMD GPU 机器上部署推理或训练环境
- 需要确认 ROCm 是否安装成功
- 需要判断 PyTorch / 推理框架是否能识别 ROCm

症状：
- AMD GPU 环境无法被框架识别
- 推理框架启动失败
- 依赖提示 ROCm 版本不兼容

快速判断：

```bash
rocminfo
clinfo
python -c "import torch; print(torch.__version__)"
```

修复步骤：

1. 确认硬件与系统兼容
- GPU 型号
- 内核版本
- 发行版版本

2. 安装 ROCm
- 优先按官方文档使用对应发行版的安装方式
- 不要混用多个来源的包

3. 验证基础命令

```bash
rocminfo
clinfo
```

4. 验证框架识别
- 使用目标框架做最小检测

回滚：
- 恢复到上一个稳定驱动和 ROCm 版本
- 清理冲突包后重装

验证：
- `rocminfo` 可输出设备信息
- 目标框架能识别 GPU

风险提示：
- ROCm 与内核、发行版和框架版本绑定较强
- 升级驱动或内核前要先确认兼容性

关键词：
- rocm install
- rocminfo
- amd gpu
- rocm check
- rocm pytorch
- gpu runtime
- rocm 兼容
- amd 推理

