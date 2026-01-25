# Docker 权限问题（permission denied / docker.sock）

适用场景：
- `Got permission denied while trying to connect to the Docker daemon socket`
- 访问 `/var/run/docker.sock` 报 permission denied

常见原因：
- 当前用户不在 `docker` 组（Linux）
- docker daemon 未启动
- 通过 SSH/CI 运行时权限/用户不同

步骤（最小可用，Linux）：

1) 确认 Docker 服务在运行
- `sudo systemctl status docker`

2) 临时方案（可用但不推荐长期）
- 在命令前加 `sudo`：`sudo docker ps`

3) 永久方案：把用户加入 docker 组
- `sudo usermod -aG docker $USER`
- 重新登录（或重启会话）后再试 `docker ps`

验证：
- `docker ps` 不再需要 sudo

回滚：
- `sudo gpasswd -d $USER docker`

关键词：
- docker.sock permission denied
- usermod -aG docker
- systemctl status docker
