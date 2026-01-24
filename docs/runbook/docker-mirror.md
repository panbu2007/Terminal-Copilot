# Docker 换源（daemon.json）

常见路径：`/etc/docker/daemon.json`

典型流程（systemd）：
1) 修改配置后：`sudo systemctl daemon-reload`
2) 重启 Docker：`sudo systemctl restart docker`
3) 验证：`docker info`，查看 `Registry Mirrors` 字段

注意：重启 Docker 可能影响正在运行的容器。
