# Kubernetes Deployment 发布、Rollout 与回滚

适用场景：
- 使用 Kubernetes Deployment 发布新版本
- 需要跟踪 rollout 状态、失败原因和回滚路径
- 需要判断问题在镜像、探针、配置还是资源约束

症状：
- `kubectl apply` 成功但业务不可用
- `rollout status` 长时间不完成
- Pod 持续 `CrashLoopBackOff` 或 `ImagePullBackOff`
- 新版本上线后需要快速回滚

快速判断：

```bash
kubectl get deploy,pod -n NAMESPACE
kubectl rollout status deployment/NAME -n NAMESPACE
kubectl describe deployment NAME -n NAMESPACE
```

修复步骤：

1. 发布前确认
- 当前镜像 tag
- 当前 Deployment revision
- 回滚版本是否明确

2. 发布

```bash
kubectl apply -f deployment.yaml
```

或直接改镜像：

```bash
kubectl set image deployment/NAME CONTAINER=IMAGE:TAG -n NAMESPACE
```

3. 跟踪 rollout

```bash
kubectl rollout status deployment/NAME -n NAMESPACE
kubectl get pods -n NAMESPACE -w
```

4. 如 rollout 卡住
- 看 Pod 状态：

```bash
kubectl describe pod POD_NAME -n NAMESPACE
kubectl logs POD_NAME -n NAMESPACE --tail=200
```

- 常见原因：
  - 探针失败
  - 镜像拉取失败
  - 配置缺失
  - 资源不足

5. 查看历史版本

```bash
kubectl rollout history deployment/NAME -n NAMESPACE
```

回滚：

```bash
kubectl rollout undo deployment/NAME -n NAMESPACE
```

如需指定版本：

```bash
kubectl rollout undo deployment/NAME --to-revision=REVISION -n NAMESPACE
```

验证：
- `kubectl rollout status` 成功
- 新 Pod 全部 Ready
- Service / Ingress 业务验证通过
- 错误率恢复到正常水平

风险提示：
- 不要使用不可追溯的浮动镜像 tag
- 回滚前确认数据库迁移是否兼容
- 探针、ConfigMap、Secret 变更常导致“镜像没问题但业务不可用”

关键词：
- kubectl rollout
- kubectl rollback
- deployment undo
- k8s deploy
- rollout status
- crashloop rollback
- kubernetes 发布
- kubernetes 回滚

