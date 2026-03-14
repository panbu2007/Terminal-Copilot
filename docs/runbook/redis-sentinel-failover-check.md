# Redis Sentinel 故障切换检查

适用场景：
- 使用 Redis Sentinel 管理主从切换
- 需要确认 failover 是否正常
- 需要排查 Sentinel 选主、脑裂、切换后客户端不恢复

症状：
- 主节点故障后没有自动切换
- 切换后客户端仍连旧主
- Sentinel 之间看法不一致

快速判断：

```bash
redis-cli -p 26379 SENTINEL masters
redis-cli -p 26379 SENTINEL sentinels mymaster
redis-cli -p 26379 SENTINEL slaves mymaster
```

修复步骤：

1. 检查 Sentinel 数量与仲裁
- 是否有足够 Sentinel 存活
- quorum 是否合理

2. 检查主从状态
- 主库是否真的不可用
- 从库是否可提升

3. 检查 Sentinel 视图
- 各 Sentinel 是否看到相同主节点和从节点

4. 检查客户端
- 客户端是否通过 Sentinel 获取主地址
- 是否存在硬编码旧主地址

回滚：
- 如自动切换异常，可在受控窗口内按标准流程恢复原拓扑
- 回滚客户端配置到稳定入口

验证：
- 新主节点可写
- 从节点重新挂接
- 客户端连接恢复

风险提示：
- 客户端不支持 Sentinel 时，切换成功也可能业务仍异常
- 不要在网络抖动时轻易人工强切

关键词：
- redis sentinel
- redis failover
- sentinel masters
- redis master switch
- sentinel quorum
- redis 主从切换
- redis 高可用
- sentinel 排查

