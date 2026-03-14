# Nginx 反向代理与 HTTPS 部署

适用场景：
- 需要把本地服务通过 Nginx 对外发布
- 需要为 AI 面板、API 服务或内部工具加 HTTPS
- 需要排查 502、504、证书或上游连接问题

症状：
- 浏览器访问失败
- Nginx 返回 502 / 504
- 证书无效或续期失败
- 本机服务正常，但域名访问异常

快速判断：

```bash
nginx -t
systemctl status nginx --no-pager
curl -I http://127.0.0.1:UPSTREAM_PORT
curl -I https://your-domain.example
```

修复步骤：

1. 先确认上游服务正常

```bash
curl -fsS http://127.0.0.1:UPSTREAM_PORT/health
ss -ltnp | grep UPSTREAM_PORT
```

2. 编写最小反向代理配置

```nginx
server {
    listen 80;
    server_name your-domain.example;

    location / {
        proxy_pass http://127.0.0.1:UPSTREAM_PORT;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

3. 验证配置并重载

```bash
nginx -t
systemctl reload nginx
```

4. 启用 HTTPS
- 通过受信任证书工具签发证书
- 在 server 块中增加 443 配置
- 同时保留 HTTP 到 HTTPS 的跳转

5. 排查 502 / 504
- 确认上游进程是否存活
- 确认 `proxy_pass` 地址、端口、协议是否正确
- 查看错误日志：

```bash
tail -n 200 /var/log/nginx/error.log
```

6. 若代理 WebSocket
- 补充升级头：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

回滚：
- 恢复上一个稳定配置文件
- 执行：

```bash
nginx -t
systemctl reload nginx
```

- 如有必要先下掉新的 server 配置，恢复旧域名入口

验证：
- `nginx -t` 通过
- `systemctl status nginx` 正常
- 域名可访问
- HTTPS 握手成功
- 上游健康接口经域名转发可正常返回

风险提示：
- 不要在未验证 `nginx -t` 的情况下直接 reload
- 直接暴露没有鉴权的内部 AI 面板存在安全风险
- 证书、私钥和反代配置应纳入备份与审计

关键词：
- nginx reverse proxy
- nginx ssl
- nginx https
- nginx 502
- nginx 504
- proxy_pass
- 反向代理
- 证书部署
