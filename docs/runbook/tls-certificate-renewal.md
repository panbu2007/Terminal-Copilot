# TLS 证书续期与到期排查

适用场景：
- 域名 HTTPS 证书即将到期或已经到期
- 浏览器提示证书错误
- 自动续期失败，需要手动排查

症状：
- 浏览器提示证书过期、不受信任或域名不匹配
- API 客户端 TLS 握手失败
- 监控提示证书到期时间过近

快速判断：

```bash
openssl s_client -connect your-domain.example:443 -servername your-domain.example </dev/null 2>/dev/null | openssl x509 -noout -dates -issuer -subject
curl -Iv https://your-domain.example
```

修复步骤：

1. 先确认问题类型
- 证书过期
- 证书链不完整
- 域名不匹配
- 服务未 reload 到新证书

2. 检查当前证书文件与配置引用

```bash
nginx -t
grep -R \"ssl_certificate\" /etc/nginx
```

3. 执行续期
- 使用你当前证书管理方式完成续期
- 如果是自动化工具，先确认：
  - DNS 仍指向正确
  - 80/443 校验路径可用
  - API 凭据未过期

4. 续期后 reload 服务

```bash
systemctl reload nginx
systemctl reload apache2
```

5. 再次验证远端看到的证书

```bash
openssl s_client -connect your-domain.example:443 -servername your-domain.example </dev/null 2>/dev/null | openssl x509 -noout -dates
```

回滚：
- 如果新证书或新配置导致服务异常，恢复旧证书与旧配置
- 重新测试配置后再 reload

验证：
- 浏览器不再报证书错误
- `curl -Iv` 正常
- 到期时间已更新
- 证书链完整，域名匹配正确

风险提示：
- 不要只替换证书文件却忘记 reload 服务
- 多节点部署时，所有节点都要更新
- 通配符证书和多域名证书要确认覆盖范围

关键词：
- tls renewal
- certificate expired
- ssl cert renew
- openssl s_client
- https certificate
- 证书续期
- tls 过期
- ssl 证书错误

