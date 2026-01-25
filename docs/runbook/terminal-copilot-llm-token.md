# Terminal Copilot：LLM Token 配置

适用场景：
- 页面提示 “未配置 Token：请在「LLM设置」中配置 Token 以启用 AI 功能”
- /api/llm/status 返回 `has_token=false`

## 配置方式

### 方式 A：页面右上角「LLM设置」（推荐）

- 在页面点击「LLM设置」
- 粘贴 ModelScope Access Token
- 保存后后端会写入本地文件：`.secrets/modelscope_access_token.txt`

### 方式 B：环境变量

- `MODELSCOPE_ACCESS_TOKEN`
- `TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN`

环境变量优先级通常更高，适合部署环境。

## 如何清空 Token（用于测试）

- 删除文件：`.secrets/modelscope_access_token.txt`
- 如果你曾设置过环境变量，也需要同时清除环境变量
- 前端标签页内可能缓存 token（sessionStorage）：关闭标签页即可清除

## 验证

- 打开 `/api/llm/status`：`has_token=true` 表示后端已配置
- 页面启动提示条消失，且控制台会显示 LLM 状态行
