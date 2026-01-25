# Docker 拉取镜像失败（pull failed / timeout / connection reset）

适用场景：
- `docker pull ...` 很慢、超时、`connection reset`、`TLS handshake timeout`
- `i/o timeout`、`dial tcp ...: i/o timeout`

常见原因：
- 网络访问 Docker Hub 不稳定/被限速
- DNS/代理配置不正确
- daemon 未配置 registry mirrors

步骤（最小可用）：

1) 看清错误（记录关键信息）
- 关注：域名、端口、timeout、TLS、reset

2) 检查镜像源是否配置
- `docker info`
- 找 `Registry Mirrors` 字段是否存在

3) 配置/更新镜像源（Linux 常见）
- 编辑：`/etc/docker/daemon.json`
- 配置 `registry-mirrors`

4) 让配置生效
- `sudo systemctl daemon-reload`
- `sudo systemctl restart docker`

验证：
- `docker info` 的 `Registry Mirrors` 出现你配置的地址
- 再次 `docker pull hello-world` 成功

回滚：
- 恢复 `daemon.json` 到修改前内容
- 重启 docker 服务

关键词：
- docker pull timeout
- TLS handshake timeout
- connection reset
- registry mirrors
