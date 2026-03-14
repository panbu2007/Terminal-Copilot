# Aider 安装与模型配置

适用场景：
- 需要在本地终端安装 Aider 作为代码助手
- 需要把 Aider 连接到 OpenAI-compatible、Anthropic 或本地模型服务
- 启动时报依赖错误、命令不存在或模型配置错误

症状：
- `aider` 命令不存在
- 启动时报 Python 依赖错误
- 提示 API key 缺失
- 模型能配置但无法完成对话

快速判断：

```bash
command -v aider
aider --version
git status
```

官方参考：
- Install: https://aider.chat/docs/install.html
- Troubleshooting: https://aider.chat/docs/troubleshooting/aider-not-found.html
- Dependency issues: https://aider.chat/docs/troubleshooting/imports.html

修复步骤：

1. 安装 Aider

推荐安装方式之一：

```bash
curl https://aider.chat/install.sh | sh
```

如果系统已有 Python，也可使用：

```bash
pip install aider-install
aider-install
```

也可以考虑隔离安装：

```bash
pipx install aider-chat
```

2. 验证命令

```bash
aider --version
```

3. 进入 Git 仓库

```bash
git status
```

如果不是仓库，先初始化或进入已有仓库目录

4. 配置模型与密钥
- 根据使用的提供商设置对应环境变量
- 如果使用 OpenAI-compatible API，确保：
  - base URL 正确
  - model 名称正确
  - token 已生效

示例思路：
- 云模型：设置厂商 API Key
- 本地模型：配置到本地兼容接口，例如代理层或 OpenAI-compatible 网关

5. 最小验证

```bash
aider README.md
```

如果只是检查模型是否能连通，可先让它解释一个小文件而不是直接改代码

回滚：
- 卸载当前安装方式对应的包
- 恢复旧版本或切回更稳定的安装方式
- 删除错误的环境变量或 shell 配置

验证：
- `aider --version` 正常输出
- 在 Git 仓库内可启动
- 模型请求能返回，不再提示 key 缺失或模型不可用

风险提示：
- Aider 会修改工作区文件，首次使用建议先在测试仓库验证
- 不要在未理解权限范围时把高权限目录直接交给 agent
- 优先在 Git 仓库中使用，便于回滚和审计

关键词：
- aider install
- aider api key
- aider model
- aider not found
- aider dependency
- aider git repo
- terminal coding assistant
- aider 配置

