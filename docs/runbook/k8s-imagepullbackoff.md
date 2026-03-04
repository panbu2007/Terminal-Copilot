# Kubernetes ImagePullBackOff 镜像拉取失败排查

适用场景：
- Pod 状态显示 `ImagePullBackOff` 或 `ErrImagePull`
- `kubectl describe pod` 报 `Failed to pull image`
- 镜像仓库需要认证或网络不通

常见原因：
- 镜像名称/标签写错（typo、tag 不存在）
- 私有仓库未配置 `imagePullSecrets`
- 节点无法访问镜像仓库（网络/防火墙）
- 仓库 rate limit 超额（Docker Hub 匿名限速）

步骤（最小可用）：

1) 查看详细错误信息
```bash
kubectl describe pod <pod-name> -n <namespace> | grep -A10 "Events:"
```

2) 确认镜像名称和标签是否正确
```bash
# 检查 Deployment 中的镜像配置
kubectl get deployment <deploy-name> -n <namespace> -o jsonpath='{.spec.template.spec.containers[*].image}'
```

3) 手动在节点上尝试拉取（排查网络问题）
```bash
# SSH 到对应节点后执行
docker pull <image-name>:<tag>
# 或 crictl pull（containerd 环境）
crictl pull <image-name>:<tag>
```

4) 配置私有仓库认证 Secret
```bash
kubectl create secret docker-registry regcred \
  --docker-server=<registry-server> \
  --docker-username=<username> \
  --docker-password=<password> \
  --docker-email=<email> \
  -n <namespace>
```

5) 在 Pod/Deployment 中引用 imagePullSecrets
```bash
kubectl patch deployment <deploy-name> -n <namespace> -p \
  '{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"regcred"}]}}}}'
```

6) 修改为可访问的镜像源（如使用国内镜像）
```bash
# 编辑 Deployment 将镜像地址改为镜像加速地址
kubectl set image deployment/<deploy-name> \
  <container-name>=<mirror-registry>/<image>:<tag> \
  -n <namespace>
```

验证：
```bash
kubectl get pods -n <namespace> -w
# Pod 状态应变为 Running，不再出现 ImagePullBackOff
kubectl describe pod <pod-name> -n <namespace> | grep "Successfully pulled image"
```

回滚：
```bash
kubectl rollout undo deployment/<deploy-name> -n <namespace>
```

注意事项：
- 镜像 tag 使用 `latest` 可能导致拉取到意料之外的版本，生产环境建议固定版本号
- Docker Hub 匿名拉取限制为每 6 小时 100 次，建议登录或使用镜像加速

关键词：
- ImagePullBackOff
- ErrImagePull
- Failed to pull image
- imagePullSecrets
- docker-registry secret
- image not found
