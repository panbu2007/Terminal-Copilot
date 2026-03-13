# Kubernetes PVC Pending 与 StorageClass 排查

适用场景：
- PVC 长时间 `Pending`
- Pod 因卷未绑定无法启动
- 需要判断问题在 StorageClass、PV、CSI 驱动还是容量不足

症状：
- `kubectl get pvc` 显示 `Pending`
- Pod 因卷不可用而卡住
- 动态供给没有生效

快速判断：

```bash
kubectl get pvc,pv -A
kubectl describe pvc NAME -n NAMESPACE
kubectl get storageclass
```

修复步骤：

1. 检查 StorageClass
- 名称是否正确
- 是否设置为默认
- provisioner 是否可用

2. 检查 PVC 描述
- 看事件：
  - 没有可用 PV
  - provisioner 不存在
  - 资源不足
  - zone / topology 不匹配

3. 检查 CSI 驱动
- 驱动 Pod 是否正常
- 控制器日志是否报错

4. 检查容量与访问模式
- 请求容量是否过大
- `ReadWriteOnce` / `ReadWriteMany` 是否与后端能力一致

回滚：
- 恢复到上一个稳定 StorageClass
- 恢复旧 PVC 模板或部署配置

验证：
- PVC 进入 `Bound`
- Pod 可正常启动
- 挂载路径在容器内可用

风险提示：
- PVC 问题常被误判为应用启动问题
- 动态供给失败时，先看事件，再看 CSI
- 存储类变更要评估全局影响

关键词：
- pvc pending
- storageclass
- pv bound
- csi driver
- kubernetes storage
- volume pending
- 持久卷排查
- pvc 故障

