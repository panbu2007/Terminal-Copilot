# PostgreSQL 主从与复制状态检查

适用场景：
- 需要判断 PostgreSQL 主库与只读副本是否正常
- 需要排查复制延迟、复制中断、只读节点未同步
- 需要发布前确认复制链路健康

症状：
- 只读副本数据落后
- 报表、检索或读流量节点查询结果不一致
- 复制延迟升高
- 主从角色判断混乱

快速判断：

主库：

```bash
psql -c "select client_addr,state,sync_state,write_lag,flush_lag,replay_lag from pg_stat_replication;"
```

副本：

```bash
psql -c "select pg_is_in_recovery();"
psql -c "select now() - pg_last_xact_replay_timestamp() as replay_delay;"
```

修复步骤：

1. 先确认角色
- 主库：`pg_is_in_recovery()` 应为 `false`
- 副本：`pg_is_in_recovery()` 应为 `true`

2. 在主库检查复制连接
- 查看 `pg_stat_replication`
- 关注：
  - 连接是否存在
  - `state`
  - `sync_state`
  - 各类 lag

3. 在副本检查回放状态
- 回放时间是否推进
- WAL 是否持续接收

4. 若延迟过高
- 检查网络
- 检查主库写入压力
- 检查副本 I/O 和磁盘
- 检查长查询是否阻塞回放

5. 若复制中断
- 核对复制槽、认证、磁盘、WAL 保留与版本兼容问题

回滚：
- 若最近做过参数或连接串调整，恢复旧配置
- 如副本已不可恢复，按标准流程重新拉起副本

验证：
- 主库能看到副本连接
- 副本回放时间正常推进
- 延迟回落到可接受范围

风险提示：
- 不要在未确认角色前把写请求打到副本
- 复制问题可能掩盖数据一致性风险
- 重建副本前要明确数据源和业务窗口

关键词：
- postgres replication
- pg_stat_replication
- pg_is_in_recovery
- postgres replica lag
- 主从检查
- 复制延迟
- 只读副本
- postgresql 复制

