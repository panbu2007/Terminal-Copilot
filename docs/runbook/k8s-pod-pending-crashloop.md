# Kubernetes Pod Pending 与 CrashLoop 排查

适用场景：
- Pod 长时间 `Pending`
- Pod 反复 `CrashLoopBackOff`
- 需要快速定位是调度、镜像、配置、探针还是资源问题

症状：
- `kubectl get pods` 显示 `Pending`
- `kubectl get pods` 显示 `CrashLoopBackOff`
- 服务已发布但没有可用实例

快速判断：

```bash
kubectl get pods -A
kubectl describe pod POD_NAME -n NAMESPACE
kubectl logs POD_NAME -n NAMESPACE --tail=200
```

修复步骤：

1. 如果是 `Pending`
- 查看调度失败原因：
  - CPU / memory 不足
  - 节点选择器不匹配
  - 污点 / 容忍不匹配
  - PVC 未绑定

2. 如果是 `CrashLoopBackOff`
- 查看容器日志
- 查看上次退出码
- 检查启动命令、配置、依赖连接、探针

3. 检查配置对象
- ConfigMap
- Secret
- ServiceAccount
- 卷挂载

4. 检查资源与镜像
- 镜像是否存在
- 节点资源是否足够
- 拉取镜像是否受限

5. 检查探针
- 就绪探针、存活探针、启动探针是否过严
- 应用初始化时间是否大于探针窗口

回滚：
- 回滚 Deployment 到上一个稳定版本
- 恢复旧镜像、旧配置、旧探针

验证：
- Pod 进入 `Running`
- Ready 状态正常
- 业务健康检查通过

风险提示：
- 不要只看 `kubectl get pods`，必须结合 `describe` 和 `logs`
- `CrashLoopBackOff` 常常是配置、依赖或探针问题，不一定是应用代码
- 回滚前确认变更是否涉及数据库或消息协议

关键词：
- pod pending
- crashloopbackoff
- kubectl describe pod
- kubectl logs
- pod not ready
- k8s 调度失败
- 探针失败
- kubernetes 故障

