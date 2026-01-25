# Docker daemon.json 示例（镜像源 / 日志 / 实验项）

适用场景：
- 需要配置镜像源（registry-mirrors）
- 调整 Docker daemon 的行为

文件位置（Linux）：
- `/etc/docker/daemon.json`

示例 1：配置 registry mirrors

```json
{
  "registry-mirrors": [
    "https://mirror.example.com"
  ]
}
```

示例 2：配置日志驱动与大小限制（避免磁盘被日志打爆）

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

让配置生效：
- `sudo systemctl daemon-reload`
- `sudo systemctl restart docker`

验证：
- `docker info`（检查 Mirrors）
- `sudo systemctl status docker --no-pager`

回滚：
- 备份并恢复修改前的 `daemon.json`

关键词：
- daemon.json registry-mirrors
- docker log-opts max-size
- systemctl restart docker
