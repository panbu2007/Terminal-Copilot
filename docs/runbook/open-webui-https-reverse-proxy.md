# Open WebUI HTTPS 反向代理

适用场景：
- 需要通过域名和 HTTPS 暴露 Open WebUI
- 需要让 Open WebUI 放在 Nginx / 反向代理后面
- 需要排查 HTTPS、WebSocket、上游转发问题

症状：
- HTTP 能访问，HTTPS 不通
- 页面能打开但对话或流式请求异常
- 反向代理后静态资源或 API 路径异常

快速判断：

```bash
curl -I http://127.0.0.1:3000
nginx -t
curl -Iv https://your-domain.example
```

修复步骤：

1. 先确认 Open WebUI 本机可用

```bash
curl -I http://127.0.0.1:3000
```

2. 配置 Nginx 反向代理
- 指向 Open WebUI 上游端口
- 保留 Host、真实来源 IP、协议头

3. 若需要流式/实时功能
- 确认代理配置支持 WebSocket / 长连接

4. 配置 HTTPS
- 正确加载证书与私钥
- HTTP 跳转到 HTTPS

5. 检查浏览器控制台和代理日志
- 静态资源路径
- 反代头
- 证书与混合内容问题

回滚：
- 恢复旧反代配置
- 临时回到 HTTP 或内网访问方式

验证：
- 域名 HTTPS 正常
- 页面可登录
- 对话、模型连接和流式功能正常

风险提示：
- 对外暴露 Open WebUI 必须配置鉴权和 HTTPS
- 代理层若未正确转发升级头，实时能力会异常
- 不要跳过 `nginx -t` 直接 reload

关键词：
- open webui https
- open-webui reverse proxy
- open webui nginx
- open webui websocket
- ai panel https
- webui 反代
- https 部署
- open webui 域名

