# Docker daemon 升级与回滚

适用场景：
- 需要升级 Docker Engine / daemon
- 升级后出现镜像拉取、网络、存储或容器异常
- 需要有明确回滚路径

症状：
- 升级后容器无法启动
- `docker info` 异常
- 网络或存储驱动行为变化

快速判断：

```bash
docker version
docker info
systemctl status docker --no-pager
```

修复步骤：

1. 升级前确认
- 当前版本
- 关键容器列表
- `daemon.json` 备份
- 存储驱动与数据目录

2. 执行升级
- 使用当前系统的标准包管理方式升级
- 升级后重启 Docker

```bash
systemctl restart docker
```

3. 检查服务与日志

```bash
systemctl status docker --no-pager
journalctl -u docker -n 200 --no-pager
docker info
```

4. 业务验证
- 关键容器是否能正常启动
- 镜像拉取、网络和卷挂载是否正常

回滚：
- 恢复旧版本包
- 恢复旧 `daemon.json`
- 重启 Docker 并验证关键容器

验证：
- `docker info` 正常
- 关键容器恢复
- 镜像拉取和网络正常

风险提示：
- 升级前必须备份 `daemon.json`
- 生产主机升级前要确认存储驱动兼容性

关键词：
- docker daemon upgrade
- docker rollback
- docker engine upgrade
- daemon json
- docker info
- docker 升级
- docker 回滚
- docker 守护进程

