# DNS 故障与内网连通性检查

适用场景：
- 服务访问外部域名或内部域名失败
- 应用报 `temporary failure in name resolution`、`no such host`
- 需要区分问题在 DNS、本机网络、代理还是上游服务

症状：
- 域名解析失败
- 同一服务有时能访问、有时失败
- IP 直连正常，但域名不通
- 容器内失败而宿主机正常

快速判断：

```bash
nslookup example.com
dig example.com
ping -c 1 example.com
curl -v https://example.com
```

修复步骤：

1. 区分解析问题与网络问题
- 如果 `nslookup` 都失败，优先看 DNS
- 如果域名能解析但连接超时，优先看网络路径、防火墙、代理

2. 检查本机 DNS 配置

```bash
cat /etc/resolv.conf
```

3. 检查容器或 Pod 内 DNS
- 容器和宿主机可能使用不同的 DNS 设置
- Kubernetes 里要同时看 CoreDNS 与 Pod DNS 策略

4. 检查内网域名
- 确认内网 DNS、服务发现或私有 Zone 是否正常
- 确认最近是否有记录变更或 TTL 缓存未刷新

5. 检查代理与出口网络
- 若依赖 HTTP/HTTPS 代理，确认代理设置与免代理列表
- 若目标服务只允许白名单出口 IP，确认出口未变化

回滚：
- 恢复上一份稳定 DNS 配置
- 恢复代理或网络策略变更
- 如是 CoreDNS 变更，回滚到上一个稳定配置

验证：
- 域名可稳定解析
- 目标服务可访问
- 容器和宿主机表现一致

风险提示：
- 不要把解析失败与应用故障混为一谈
- 修改 DNS 时要考虑整机或整集群影响
- 手工改 `/etc/hosts` 只能做临时止血，不是长期方案

关键词：
- dns failure
- no such host
- temporary failure in name resolution
- resolv.conf
- nslookup
- dig
- 内网解析
- dns 排查

