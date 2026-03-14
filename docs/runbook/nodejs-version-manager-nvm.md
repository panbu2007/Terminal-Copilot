# Node.js 版本切换与 nvm 排查

适用场景：
- 机器上有多个 Node.js 版本，需要按项目切换
- 构建脚本要求特定 Node 版本
- `node -v` 与预期不一致，或 `npm install` 因版本过低/过高失败

症状：
- `node -v` 不符合项目要求
- 同一台机器不同 shell 输出不同版本
- CI、开发机、服务器的 Node 版本不一致
- `npm`, `pnpm`, `yarn` 行为异常

快速判断：

```bash
node -v
npm -v
command -v node
echo $PATH
```

修复步骤：

1. 先确认项目要求
- 查看 `.nvmrc`
- 查看 `package.json` 中的 `engines`
- 查看 CI 配置中的 Node 版本

2. 使用 nvm 切换版本

```bash
nvm ls
nvm install 20
nvm use 20
```

如果项目有 `.nvmrc`：

```bash
nvm use
```

3. 检查 shell 初始化
- 确认 `~/.bashrc`、`~/.zshrc` 等是否正确加载 nvm
- 避免同时存在系统 Node、包管理器 Node、nvm Node 相互覆盖

4. 若版本仍不对
- 检查是否有全局 PATH 覆盖
- 检查 CI / systemd / cron 是否没有加载交互式 shell 配置

回滚：
- 切回上一个稳定版本：

```bash
nvm use VERSION
```

- 如需移除错误版本：

```bash
nvm uninstall VERSION
```

验证：
- `node -v` 与项目要求一致
- `npm -v` 正常
- 重新安装依赖或运行构建脚本通过

风险提示：
- 不要混用多个 Node 发行来源而不清楚 PATH 优先级
- 服务化环境往往不会自动加载用户 shell 配置
- 大版本切换前要确认 lockfile 和 native addon 兼容性

关键词：
- nvm use
- node version
- node mismatch
- node engines
- npm version
- nodejs version manager
- node 版本切换
- nvm 排查

