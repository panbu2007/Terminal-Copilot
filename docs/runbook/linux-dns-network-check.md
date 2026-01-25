# Linux 网络/DNS 排查（解析/连通性/代理）

适用场景：
- `Temporary failure in name resolution`
- 拉包/拉镜像超时、TLS 错误、连接重置

步骤（只读优先）：

1) DNS 解析
- `getent hosts example.com`

2) 基本连通性
- `curl -I https://example.com --max-time 10`

3) 代理环境变量（如果你在公司/比赛环境有代理）
- `env | grep -i proxy`

验证：
- DNS 能解析到 IP
- curl 能返回 HTTP 响应头

回滚：
- 清理代理环境变量（如误配置）

关键词：
- name resolution
- getent hosts
- curl -I
- proxy env
