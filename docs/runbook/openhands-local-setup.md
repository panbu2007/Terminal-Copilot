# OpenHands 本地运行与最小验证

适用场景：
- 需要在本机或受控环境中运行 OpenHands
- 需要为 OpenHands 配置模型提供商、工作目录和本地运行时
- 需要了解本地运行模式的安全边界

症状：
- OpenHands 无法启动
- 模型配置缺失
- Docker 或本地运行时不可用
- 本地运行时权限过大、不确定风险边界

快速判断：

```bash
docker --version
python --version
tmux -V
```

官方参考：
- Local setup: https://docs.all-hands.dev/usage/local-setup
- Local runtime: https://docs.all-hands.dev/usage/runtimes/local

修复步骤：

1. 先决定运行模式
- Docker / 容器运行：默认更稳妥
- Local Runtime：仅在受控环境、CI 或明确理解风险时使用

2. 准备前置条件
- 模型提供商、模型名、API Key
- 可写工作目录
- Linux / macOS：准备 `tmux`
- Windows：准备 PowerShell；本地运行时仅支持 CLI/headless 场景

3. 使用官方推荐方式完成本地启动
- 按官方 local setup 文档执行
- 启动前确认工作目录权限、网络出口和模型配置

4. 如果使用 Local Runtime
- 明确设置对应运行时配置
- Local Runtime 没有沙箱隔离，agent 可以直接访问和修改本机文件
- 只在测试环境、受控目录和低风险主机上使用

5. 最小验证
- 先在单独测试目录中运行
- 只执行读取类任务，例如：
  - 查看目录
  - 解释代码
  - 生成建议而不直接改生产文件

回滚：
- 停掉 OpenHands 进程或容器
- 清理临时工作目录
- 删除测试用 token、环境变量或本地配置
- 若使用 Local Runtime，确认没有残留后台会话和 tmux session

验证：
- 进程或容器状态正常
- Web/CLI 可以打开
- 能完成一次最小任务
- 测试目录下的读写行为符合预期

风险提示：
- Local Runtime 无沙箱，是高风险模式
- 不要在生产主机、敏感目录或带高权限凭据的环境直接使用本地运行时
- 首次接入先使用单独工作目录和最小权限账号

关键词：
- openhands local setup
- openhands local runtime
- openhands install
- openhands docker
- openhands tmux
- ai agent sandbox
- openhands 权限
- 本地运行时

