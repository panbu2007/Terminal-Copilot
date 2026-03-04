# Redis 内存满处理

适用场景：
- 应用写入 Redis 报错 `OOM command not allowed when used memory > 'maxmemory'`
- Redis 拒绝写入新数据
- 监控显示 Redis `used_memory` 接近或超过 `maxmemory`

常见原因：
- `maxmemory` 设置过低或未设置（无限制但物理内存耗尽）
- 大量 key 未设置 TTL（过期时间），数据无限积累
- `maxmemory-policy` 为 `noeviction`，内存满后直接拒绝写入

步骤（最小可用）：

1) 查看当前内存使用情况
```bash
redis-cli info memory | grep -E "used_memory_human|maxmemory_human|maxmemory_policy"
```

2) 查看 maxmemory 配置
```bash
redis-cli config get maxmemory
redis-cli config get maxmemory-policy
```

3) 查找大 key（占用内存多的 key）
```bash
# 扫描大 key（不阻塞，生产安全）
redis-cli --bigkeys
# 或查看所有 key 数量
redis-cli dbsize
```

4) 临时调整 maxmemory（立即生效）
```bash
# 设置为 2GB
redis-cli config set maxmemory 2gb
```

5) 修改淘汰策略（允许自动驱逐旧数据）
```bash
# allkeys-lru：所有 key 中淘汰最近最少使用的（通用推荐）
redis-cli config set maxmemory-policy allkeys-lru
# volatile-lru：仅在设置了 TTL 的 key 中淘汰
redis-cli config set maxmemory-policy volatile-lru
```

6) 手动清理过期/无用 key
```bash
# 清空所有 key（谨慎！）
redis-cli flushdb        # 清空当前数据库
redis-cli flushall       # 清空所有数据库

# 批量删除匹配的 key（示例：删除 session: 前缀）
redis-cli --scan --pattern "session:*" | xargs redis-cli del
```

7) 永久修改配置文件
```bash
sudo vim /etc/redis/redis.conf
# 修改：
# maxmemory 2gb
# maxmemory-policy allkeys-lru
sudo systemctl restart redis
```

验证：
```bash
redis-cli info memory | grep used_memory_human
# 测试写入
redis-cli set test_key test_value
redis-cli get test_key
```

注意事项：
- `flushdb` / `flushall` 不可逆，务必确认数据已备份或为缓存数据（可重建）
- 生产环境推荐使用 `allkeys-lru` 或 `volatile-lru` 策略，避免 `noeviction` 导致服务不可用

关键词：
- redis OOM command not allowed
- maxmemory redis
- redis memory full
- allkeys-lru eviction policy
- redis --bigkeys
- redis flushdb
- redis config set maxmemory
