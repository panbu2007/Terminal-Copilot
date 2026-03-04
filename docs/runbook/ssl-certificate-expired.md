# SSL 证书过期处理

适用场景：
- 浏览器显示"您的连接不是私密连接"或证书无效警告
- curl 报错 `SSL certificate problem: certificate has expired`
- HTTPS 请求失败，证书到期导致服务不可用

常见原因：
- Let's Encrypt 或商业证书未及时续期
- 证书续期脚本/定时任务失效
- 系统时间不正确导致证书被判定为过期

步骤（最小可用）：

1) 检查证书到期时间
```bash
# 检查本地证书文件
openssl x509 -in /etc/letsencrypt/live/<domain>/cert.pem -noout -dates
# 检查远端服务器证书
echo | openssl s_client -connect <domain>:443 -servername <domain> 2>/dev/null | openssl x509 -noout -dates
```

2) 手动续期 Let's Encrypt 证书（Certbot）
```bash
# 确认 certbot 已安装
certbot --version
# 测试续期（dry run，不实际更改）
sudo certbot renew --dry-run
# 正式续期
sudo certbot renew
```

3) 续期后重载 Web 服务（Nginx / Apache）
```bash
sudo systemctl reload nginx
# 或
sudo systemctl reload apache2
```

4) 检查并修复自动续期定时任务
```bash
# Certbot 通常通过 systemd timer 或 cron 自动续期
systemctl list-timers | grep certbot
# 或查看 cron
crontab -l | grep certbot
sudo crontab -l | grep certbot
```

5) 手动为 Nginx 申请新证书（首次或域名变更）
```bash
sudo certbot --nginx -d <domain> -d www.<domain>
```

6) 检查系统时间（时间错误会导致证书判断异常）
```bash
date
timedatectl status
```

验证：
```bash
# 确认证书日期已更新
echo | openssl s_client -connect <domain>:443 2>/dev/null | openssl x509 -noout -dates
# curl 测试 HTTPS 不再报错
curl -v https://<domain>/
```

注意事项：
- Let's Encrypt 证书有效期为 90 天，建议 Certbot 自动续期定时任务在到期前 30 天触发
- 续期后必须重载 Web 服务才能使新证书生效

关键词：
- SSL certificate expired
- certbot renew
- let's encrypt certificate
- openssl x509 dates
- HTTPS certificate invalid
- certificate has expired
