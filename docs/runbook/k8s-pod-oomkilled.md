# Kubernetes Pod OOMKilled（内存溢出被杀）排查

适用场景：
- `kubectl get pods` 显示状态 `OOMKilled`
- Pod 容器退出码为 `137`（SIGKILL 信号）
- `kubectl describe pod` 中 `Last State: Terminated Reason: OOMKilled`

常见原因：
- 容器 `resources.limits.memory` 设置过低
- 应用存在内存泄漏，占用持续增长
- 突发流量导致内存峰值超过限制

步骤（最小可用）：

1) 确认 OOMKilled 状态
```bash
kubectl describe pod <pod-name> -n <namespace> | grep -A10 "Last State"
kubectl describe pod <pod-name> -n <namespace> | grep -A5 "OOMKilled"
```

2) 查看当前内存限制配置
```bash
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.containers[*].resources}'
```

3) 查看节点内存压力
```bash
kubectl top nodes
kubectl top pods -n <namespace>
# 需要 metrics-server 已安装
```

4) 查看崩溃前日志
```bash
kubectl logs <pod-name> -n <namespace> --previous
```

5) 临时调高内存限制（应急）
```bash
kubectl set resources deployment <deploy-name> \
  -n <namespace> \
  --limits=memory=512Mi \
  --requests=memory=256Mi
```

6) 编辑 Deployment 永久修改
```bash
kubectl edit deployment <deploy-name> -n <namespace>
# 修改 resources.limits.memory 和 resources.requests.memory
```

验证：
```bash
kubectl get pods -n <namespace> -w
# 确认 Pod 不再出现 OOMKilled，运行稳定
kubectl top pods -n <namespace>
```

回滚：
```bash
kubectl rollout undo deployment/<deploy-name> -n <namespace>
```

注意事项：
- `kubectl top` 需要集群安装 `metrics-server`，否则报 `error: Metrics API not available`
- 临时调高限制只是应急；根本解决需定位内存泄漏或优化代码

关键词：
- OOMKilled
- out of memory
- pod killed memory limit
- kubectl top pods
- resources limits memory
- exit code 137
