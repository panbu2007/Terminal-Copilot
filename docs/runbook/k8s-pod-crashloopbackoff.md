# Kubernetes Pod CrashLoopBackOff 排查

适用场景：
- `kubectl get pods` 显示状态为 `CrashLoopBackOff`
- Pod 反复重启，无法正常运行
- `kubectl describe pod` 显示 `Back-off restarting failed container`

常见原因：
- 容器启动命令错误或程序崩溃退出
- 配置文件缺失、环境变量未注入
- 依赖服务（数据库、API）尚未就绪
- 镜像内应用运行出现 panic/OOM

步骤（最小可用）：

1) 查看 Pod 状态与重启次数
```bash
kubectl get pods -n <namespace>
kubectl get pod <pod-name> -n <namespace> -o wide
```

2) 查看 Pod 事件与最近失败原因
```bash
kubectl describe pod <pod-name> -n <namespace>
```

3) 查看当前容器日志（正在运行或刚崩溃的）
```bash
kubectl logs <pod-name> -n <namespace>
# 查看上一次崩溃的日志
kubectl logs <pod-name> -n <namespace> --previous
```

4) 进入容器调试（如果能短暂运行）
```bash
kubectl exec -it <pod-name> -n <namespace> -- /bin/sh
```

5) 检查环境变量与 ConfigMap/Secret 挂载
```bash
kubectl get configmap -n <namespace>
kubectl describe configmap <cm-name> -n <namespace>
kubectl get secret -n <namespace>
```

6) 临时修改重启策略或命令（调试用）
```bash
# 编辑 Deployment 将 command 改为 sleep 调试
kubectl edit deployment <deploy-name> -n <namespace>
```

验证：
```bash
# Pod 状态变为 Running 且重启次数不再增长
kubectl get pod <pod-name> -n <namespace> -w
kubectl describe pod <pod-name> -n <namespace> | grep -A5 "State:"
```

回滚：
```bash
# 回滚 Deployment 到上一版本
kubectl rollout undo deployment/<deploy-name> -n <namespace>
kubectl rollout status deployment/<deploy-name> -n <namespace>
```

注意事项：
- `--previous` 标志只能查看上一次崩溃的日志，如已重启多次部分日志会丢失
- 先看日志再操作，避免盲目重建 Pod 掩盖根因

关键词：
- CrashLoopBackOff
- kubectl logs --previous
- pod restart loop
- kubectl describe pod
- back-off restarting failed container
