# ComfyUI 安装与启动

适用场景：
- 需要在本机安装 ComfyUI 进行图像工作流实验
- 需要在 Windows、macOS 或 Linux 上完成最小安装与启动
- 需要建立后续安装自定义节点与模型的基础环境

症状：
- ComfyUI 无法启动
- Python 环境冲突
- 依赖安装失败
- 启动后页面打不开

快速判断：

```bash
python --version
git --version
```

官方参考：
- ComfyUI docs: https://docs.comfy.org/
- Manual install: https://docs.comfy.org/get_started/manual_install
- Comfy CLI: https://docs.comfy.org/comfy-cli/getting-started

修复步骤：

1. 选择安装方式
- Windows：可优先使用 Desktop
- Linux/macOS：可手动安装或使用 `comfy-cli`

2. `comfy-cli` 方式

```bash
pip install comfy-cli
comfy install
comfy launch
```

3. 手动安装方式

```bash
python -m venv .venv
source .venv/bin/activate
git clone https://github.com/comfyanonymous/ComfyUI.git
cd ComfyUI
pip install -r requirements.txt
python main.py
```

4. 模型目录规划
- 将 checkpoint、LoRA、VAE 等模型目录固定下来
- 需要共享模型路径时，可按官方文档使用 `extra_model_paths.yaml`

5. 页面验证
- 启动后访问本机页面
- 完成一次最小工作流加载与运行

回滚：
- 停掉进程
- 删除虚拟环境
- 恢复旧版本代码或旧模型目录映射

验证：
- 命令能启动
- 页面可打开
- 最小工作流能运行

风险提示：
- ComfyUI 及其自定义节点依赖变化快，建议与系统 Python 隔离
- 自定义节点安装前先确认来源可信
- 大模型和大工作流会带来较高 GPU 显存占用

关键词：
- comfyui install
- comfyui launch
- comfy-cli
- comfyui manual install
- comfyui desktop
- comfyui python
- 图像工作流
- comfyui 启动

