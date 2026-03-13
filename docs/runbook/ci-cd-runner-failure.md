# CI/CD Runner 故障排查

适用场景：
- GitHub Actions Runner、GitLab Runner 或自建 CI 执行器无法工作
- Job 卡在排队、拉取代码失败、执行脚本失败、权限错误
- 需要快速判断问题在 runner 主机、凭据、网络还是工作目录

症状：
- Job 长时间 pending
- Runner offline
- 拉取仓库失败
- 构建脚本执行时报权限、磁盘、依赖或网络错误

快速判断：

```bash
systemctl status runner-service --no-pager
journalctl -u runner-service -n 200 --no-pager
df -h
```

修复步骤：

1. 检查 runner 服务状态

```bash
systemctl status runner-service --no-pager
journalctl -u runner-service -n 200 --no-pager
```

2. 检查基础资源

```bash
df -h
free -h
ulimit -n
```

3. 检查网络与凭据
- 到代码平台的网络是否可达
- 注册 token、SSH key、PAT 是否过期
- 代理、证书、DNS 是否正常

4. 检查工作目录和缓存
- workspace 是否残留锁文件
- 缓存目录是否爆满
- 执行用户是否有写权限

5. 检查依赖环境
- Docker 是否可用
- Node / Python / Java / build tool 是否存在
- 版本是否与 pipeline 预期一致

回滚：
- 恢复最近稳定的 runner 配置
- 清理损坏的 workspace / cache 后重新注册或重启
- 若最近升级过 runner 版本，可退回旧版本

验证：
- runner 在线
- 能成功领取新任务
- 新任务可以完成最小 checkout 与 echo 步骤

风险提示：
- 不要在生产 runner 上长期积累未清理的 workspace
- 注册 token 泄露后应立即轮换
- Runner 如果带高权限 Docker socket，需要额外审计

关键词：
- ci runner failed
- gitlab runner failed
- github actions runner offline
- runner pending
- runner token expired
- runner disk full
- ci 故障
- 构建执行器

