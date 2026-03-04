# curl 调试 HTTP 请求问题

适用场景：
- HTTP/HTTPS 请求失败，需要查看详细请求/响应头
- 排查 API 接口是否正常返回、SSL 是否有问题
- 需要发送带认证、自定义 Header 或 Body 的请求

常见原因：
- 服务未启动或端口未监听
- SSL 证书问题（过期、自签名）
- 请求头/Body 格式错误导致接口返回 4xx
- 代理或 DNS 解析问题

步骤（最小可用）：

1) 基础连通性测试（显示响应码）
```bash
curl -I https://example.com
# -I 只请求 HEAD，显示响应头
```

2) 显示详细请求和响应信息
```bash
curl -v https://example.com
# -v 显示完整握手、请求头、响应头
```

3) 发送 POST 请求（JSON Body）
```bash
curl -X POST https://api.example.com/endpoint \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"key": "value"}' \
  -v
```

4) 忽略 SSL 证书验证（自签名证书调试用）
```bash
curl -k https://example.com
# 等价于 --insecure，仅用于调试
```

5) 跟随重定向
```bash
curl -L https://example.com
```

6) 保存响应体到文件
```bash
curl -o response.json https://api.example.com/data
```

7) 指定超时时间
```bash
curl --connect-timeout 10 --max-time 30 https://example.com
```

8) 通过代理发送请求
```bash
curl -x http://proxy-host:3128 https://example.com
```

9) 查看详细 DNS + TCP + TLS 各阶段耗时
```bash
curl -w "\n\nDNS: %{time_namelookup}s\nConnect: %{time_connect}s\nTLS: %{time_appconnect}s\nTotal: %{time_total}s\n" \
  -o /dev/null -s https://example.com
```

10) 发送 form 表单数据
```bash
curl -X POST https://example.com/login \
  -F "username=admin" \
  -F "password=secret"
```

验证：
```bash
# 确认接口返回 2xx 状态码
curl -s -o /dev/null -w "%{http_code}" https://example.com/api/health
```

注意事项：
- `-k`（忽略 SSL）仅用于本地调试，生产环境务必验证证书
- 使用 `-v` 时密码/Token 会出现在终端，注意不要截图分享

关键词：
- curl -v debug
- curl POST JSON
- curl SSL certificate
- curl response code
- curl timeout
- curl -I headers
- http request debug
