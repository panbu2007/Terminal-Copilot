# Kubernetes Ingress 503 / 504 排查

适用场景：
- Ingress 暴露的服务返回 503 或 504
- 域名可以解析，但业务访问失败
- 需要判断问题在 Ingress Controller、Service、Pod 还是上游应用

症状：
- 浏览器报 503 / 504
- Ingress 有地址，但请求失败
- Pod 健康检查通过率异常

快速判断：

```bash
kubectl get ingress -A
kubectl describe ingress NAME -n NAMESPACE
kubectl get svc,pod -n NAMESPACE
```

修复步骤：

1. 确认 Ingress 规则
- host
- path
- backend service 名称和端口

2. 检查 Service

```bash
kubectl describe svc NAME -n NAMESPACE
kubectl get endpoints NAME -n NAMESPACE
```

- 如果 endpoints 为空，通常是 selector 或 Pod 就绪问题

3. 检查 Pod 与探针
- Pod 是否 Ready
- 应用是否真的监听目标端口

4. 检查 Ingress Controller 日志
- 看是否报 upstream unavailable、timeout、SSL 或路由错误

5. 检查超时
- 若上游本身响应慢，504 更常见
- 需要同时看应用日志和 Ingress 超时配置

回滚：
- 恢复上一个稳定 Ingress 配置
- 恢复旧 Service selector、端口或旧版本 Pod

验证：
- 域名访问恢复
- Ingress controller 日志恢复正常
- 上游服务健康检查通过

风险提示：
- 503 常见是没有可用后端
- 504 常见是上游慢或网络超时
- 只改 Ingress 而不检查 Service / Pod，容易误判

关键词：
- ingress 503
- ingress 504
- kubernetes ingress
- service endpoints empty
- upstream unavailable
- ingress timeout
- 域名访问失败
- k8s 网关故障

