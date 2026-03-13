# Redis 持久化与内存淘汰检查

适用场景：
- Redis 内存接近上限
- 需要确认持久化策略和淘汰策略是否正确
- 需要排查数据丢失、写入失败或 key 被驱逐

症状：
- Redis 报内存不足
- 写入失败
- 重启后数据丢失
- 命中率下降、key 被频繁淘汰

快速判断：

```bash
redis-cli INFO memory
redis-cli INFO persistence
redis-cli CONFIG GET maxmemory
redis-cli CONFIG GET maxmemory-policy
```

修复步骤：

1. 检查内存现状
- 查看已用内存、峰值内存、碎片率

2. 检查淘汰策略
- 核对 `maxmemory`
- 核对 `maxmemory-policy`
- 判断是否符合业务预期：
  - 缓存型业务可接受淘汰
  - 强状态业务不能随意淘汰

3. 检查持久化
- AOF 是否开启
- RDB 是否开启
- 最近一次持久化是否成功

4. 如果出现写入失败
- 检查是否触发 `noeviction`
- 检查磁盘是否已满
- 检查后台持久化是否报错

5. 如果频繁淘汰 key
- 减少无界缓存
- 增加 TTL 管理
- 调整内存上限和淘汰策略

回滚：
- 恢复旧的 `maxmemory` 和淘汰策略
- 恢复旧持久化配置
- 重启前确认业务影响

验证：
- `INFO persistence` 无持续报错
- 写入恢复正常
- 淘汰和命中率符合预期

风险提示：
- 不同业务类型对淘汰策略容忍度完全不同
- 未启用合适持久化时，重启可能造成数据损失
- 调整内存策略前要明确 Redis 在系统中的职责

关键词：
- redis persistence
- redis maxmemory
- redis eviction
- redis aof
- redis rdb
- redis noeviction
- redis 内存淘汰
- redis 持久化

