# 部署说明（魔搭创空间）

## 目标
- 应用可直接启动并对外提供 Web UI。
- 默认使用 `local` 执行器（在运行环境内真实执行命令）。

## 启动命令
推荐使用仓库根目录的入口：

```bash
python app.py
```

端口：
- 默认 `7860`
- 若平台注入 `PORT`，将自动使用该端口

## 环境变量
- `TERMINAL_COPILOT_EXECUTOR`
  - `local`（默认）
  - `simulate`（可选）

- `TERMINAL_COPILOT_MAX_SUGGESTIONS`（可选）
  - 建议列表最多返回多少条（默认 `6`）。

## 可选：接入 ModelScope LLM（Planner 引擎）

Planner 默认是规则/意图触发（零依赖）。如果你希望在“自然语言意图”上更智能，可以开启 ModelScope API-Inference（OpenAI 兼容接口）作为 fallback：

- 默认模式是 `auto`：只要检测到本地已配置 Token，就会自动启用 LLM fallback。
- 配置 Token 的方式：
  - 推荐：在页面右上角点「LLM设置」，粘贴 Token（会写入本地 `.secrets/modelscope_access_token.txt`）
  - 或手动写文件：`.secrets/modelscope_access_token.txt`

- 配置模型ID：
  - 推荐：在「LLM设置」里填写模型ID（会写入本地 `.secrets/modelscope_model.txt`）
  - 或手动写文件：`.secrets/modelscope_model.txt`

- `TERMINAL_COPILOT_LLM_ENABLED=1`（可选，强制开启；`0` 强制关闭；默认 `auto`）
- `MODELSCOPE_ACCESS_TOKEN=<你的 token>`（可选，环境变量方式；优先级高于本地文件）
- `TERMINAL_COPILOT_MODELSCOPE_MODEL=Qwen/Qwen2.5-Coder-32B-Instruct`（可选）
- `TERMINAL_COPILOT_MODELSCOPE_BASE_URL=https://api-inference.modelscope.cn/v1/`（可选）

## 现场 Demo 快捷指令
在 Web 终端输入（以 `?` 开头只生成建议不执行）：
- `?docker 换源`
- `?端口 8000 被占用吗`
- `?git checkout 拼写错了`

然后点击右侧“执行”，即可走完：建议 → 执行 → 校验（步骤面板会显示校验摘要）。
