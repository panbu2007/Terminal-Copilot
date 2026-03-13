# Kubernetes CoreDNS 排查

适用场景：
- Pod 内域名解析失败
- 集群内服务名不可解析
- 需要判断问题在 CoreDNS、上游 DNS、网络策略还是节点网络

症状：
- Pod 内报 `no such host`
- Service 域名解析超时
- 只有部分 namespace 或部分节点异常

快速判断：

```bash
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system deploy/coredns --tail=200
kubectl exec -it POD -n NAMESPACE -- nslookup kubernetes.default
```

修复步骤：

1. 检查 CoreDNS Pod 状态
- 是否 Running
- 是否频繁重启

2. 检查日志
- 看上游转发失败、插件错误、配置错误

3. 检查 ConfigMap

```bash
kubectl get configmap coredns -n kube-system -o yaml
```

4. 检查 Pod 内解析
- 对集群内服务名和外部域名分别测试

5. 检查网络层
- 节点网络
- NetworkPolicy
- kube-proxy / CNI 状态

回滚：
- 恢复上一个稳定 CoreDNS ConfigMap
- 回滚最近的网络策略或 CNI 变更

验证：
- Pod 内可解析 `kubernetes.default`
- 外部域名和集群服务名都恢复正常

风险提示：
- CoreDNS 变更影响整个集群
- 修改 ConfigMap 前要留存旧版本

关键词：
- coredns debug
- kubernetes dns
- pod no such host
- coredns configmap
- cluster dns
- 集群解析
- kube-system dns
- coredns 排查

