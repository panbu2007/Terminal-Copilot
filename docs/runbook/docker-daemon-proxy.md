# Docker 代理配置（daemon.json / HTTP(S)_PROXY）

适用场景：
- 公司/比赛网络需要代理才能访问外网
- Docker 拉镜像失败但 curl 访问正常，怀疑 Docker 没走代理

常见原因：
- Docker daemon 不读取用户 shell 的代理环境变量
- daemon/systemd 需要单独配置 proxy

步骤（最小可用，Linux）：

1) 确认当前环境变量（仅参考）
- `env | grep -i proxy`

2) 推荐：通过 systemd 为 docker 配置代理
- 创建目录：`sudo mkdir -p /etc/systemd/system/docker.service.d`
- 写入配置：`sudo tee /etc/systemd/system/docker.service.d/http-proxy.conf <<'EOF'
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:7890"
Environment="HTTPS_PROXY=http://127.0.0.1:7890"
Environment="NO_PROXY=localhost,127.0.0.1,::1"
EOF`

3) 生效
- `sudo systemctl daemon-reload`
- `sudo systemctl restart docker`

验证：
- `sudo systemctl show --property=Environment docker` 能看到 proxy
- `docker pull hello-world` 成功

回滚：
- 删除该 conf 文件
- `daemon-reload` + `restart`

关键词：
- docker proxy
- docker.service.d http-proxy.conf
- systemctl show Environment
