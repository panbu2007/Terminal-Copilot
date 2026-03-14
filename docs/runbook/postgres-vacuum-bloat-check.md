# PostgreSQL VACUUM 与膨胀检查

适用场景：
- PostgreSQL 表膨胀严重
- autovacuum 跟不上
- 更新删除频繁导致空间和性能问题

症状：
- 表体积持续增长
- 查询变慢
- autovacuum 日志异常
- 磁盘使用升高但数据量并未明显增加

快速判断：
- 检查 autovacuum 状态
- 检查热点表体积与死元组数量

修复步骤：

1. 检查死元组和热点表
- 识别更新删除频繁的大表

2. 检查 autovacuum 参数
- 频率
- 阈值
- worker 数量

3. 对问题表做针对性处理
- 调整表级 autovacuum 参数
- 在业务窗口内执行 `VACUUM`
- 必要时评估 `VACUUM FULL` 或重建

4. 检查长事务
- 长事务会阻碍清理

回滚：
- 恢复旧参数
- 如果变更过于激进，回到原始 autovacuum 配置

验证：
- 膨胀趋势下降
- 死元组减少
- 查询性能恢复

风险提示：
- `VACUUM FULL` 会锁表
- 不要在高峰期对大表做高风险整理操作

关键词：
- postgres vacuum
- autovacuum
- table bloat
- dead tuples
- vacuum full
- postgres 膨胀
- 数据库维护
- postgresql vacuum

