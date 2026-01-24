# Docker daemon.json 修改后怎么验证

当你编辑了 `/etc/docker/daemon.json`（如配置 registry mirror）后，一般需要让 Docker 重新加载配置并验证：

1) 重启 Docker 服务（不同系统命令不同）
- systemd：`sudo systemctl restart docker`

2) 验证配置是否生效
- `docker info`
- 重点关注输出中的 `Registry Mirrors` 字段

风险：重启 Docker 会影响正在运行的容器。
