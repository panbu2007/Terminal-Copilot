# PostgreSQL 锁等待/死锁排查

适用场景：
- 应用查询长时间挂起，日志报 `ERROR: deadlock detected`
- `pg_stat_activity` 显示大量查询处于 `waiting` 状态
- UPDATE/DELETE 操作卡住无响应

常见原因：
- 多个事务以不同顺序锁定相同资源，形成死锁
- 长事务持有锁未提交，阻塞其他查询
- 未提交的 DDL 操作（如 ALTER TABLE）持有排他锁

步骤（最小可用）：

1) 查看当前等待锁的查询
```bash
psql -U postgres -c "
SELECT pid, now() - pg_stat_activity.query_start AS duration,
       query, state, wait_event_type, wait_event
FROM pg_stat_activity
WHERE state != 'idle'
  AND (now() - pg_stat_activity.query_start) > interval '5 seconds'
ORDER BY duration DESC;"
```

2) 查看锁等待关系（哪个 PID 在等哪个 PID）
```bash
psql -U postgres -c "
SELECT blocked_locks.pid AS blocked_pid,
       blocking_locks.pid AS blocking_pid,
       blocked_activity.query AS blocked_query,
       blocking_activity.query AS blocking_query
FROM pg_catalog.pg_locks blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks blocking_locks
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;"
```

3) 终止阻塞查询（温和方式：取消查询，不断连接）
```bash
psql -U postgres -c "SELECT pg_cancel_backend(<blocking_pid>);"
```

4) 终止阻塞查询（强制方式：断开连接）
```bash
psql -U postgres -c "SELECT pg_terminate_backend(<blocking_pid>);"
```

5) 查看死锁日志
```bash
# 死锁会记录在 PostgreSQL 日志中
sudo tail -100 /var/log/postgresql/postgresql-*.log | grep -i deadlock
```

6) 设置语句超时防止长时间锁等待
```bash
# 在 postgresql.conf 中设置全局超时
# statement_timeout = 30000   # 30 秒
# lock_timeout = 10000        # 等锁超时 10 秒
# 或在会话级别设置
psql -U postgres -c "SET statement_timeout = '30s';"
```

验证：
```bash
# 确认等待查询已消除
psql -U postgres -c "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock';"
```

注意事项：
- `pg_terminate_backend` 会强制断开连接，应用需要处理重连；优先使用 `pg_cancel_backend`
- 根本解决需优化事务顺序、缩短事务时长，避免在事务中做耗时操作

关键词：
- postgresql deadlock
- pg_stat_activity waiting
- pg_locks
- pg_cancel_backend
- pg_terminate_backend
- lock wait timeout postgres
- blocking query postgres
