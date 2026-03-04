# MySQL 慢查询排查

适用场景：
- 数据库响应缓慢，接口超时
- 监控显示 MySQL CPU 或 I/O 高
- 需要找出并优化耗时 SQL

常见原因：
- 查询未使用索引（全表扫描）
- 查询数据量过大（缺少分页或条件过滤）
- 连接查询（JOIN）未建立合适索引
- 锁等待导致查询积压

步骤（最小可用）：

1) 查看当前正在执行的慢查询
```bash
mysql -u root -p -e "SHOW PROCESSLIST;"
# 关注 Time 列较大、State 为 Sending data 或 Copying to tmp table 的行
```

2) 开启慢查询日志（立即生效）
```bash
mysql -u root -p -e "SET GLOBAL slow_query_log = 1;"
mysql -u root -p -e "SET GLOBAL long_query_time = 1;"   # 超过 1 秒记录
mysql -u root -p -e "SHOW VARIABLES LIKE 'slow_query_log_file';"
```

3) 查看慢查询日志
```bash
sudo tail -100 /var/log/mysql/mysql-slow.log
# 使用 mysqldumpslow 汇总分析
mysqldumpslow -s t -t 10 /var/log/mysql/mysql-slow.log
# -s t 按时间排序，-t 10 显示前 10 条
```

4) 用 EXPLAIN 分析具体 SQL
```bash
mysql -u root -p -e "EXPLAIN SELECT * FROM orders WHERE user_id = 100;"
# 关注：type（ALL 表示全表扫描）、key（使用的索引）、rows（扫描行数）
```

5) 为慢查询字段添加索引
```bash
mysql -u root -p -e "ALTER TABLE orders ADD INDEX idx_user_id (user_id);"
# 验证索引已生效
mysql -u root -p -e "SHOW INDEX FROM orders;"
```

6) 使用 Performance Schema 分析（MySQL 5.7+）
```bash
mysql -u root -p << 'EOF'
SELECT digest_text, count_star, avg_timer_wait/1e12 avg_sec
FROM performance_schema.events_statements_summary_by_digest
ORDER BY avg_timer_wait DESC
LIMIT 10;
EOF
```

验证：
```bash
# 再次 EXPLAIN 确认使用了索引
mysql -u root -p -e "EXPLAIN SELECT * FROM orders WHERE user_id = 100;"
# type 应变为 ref 或 const，rows 大幅减少
```

注意事项：
- 生产环境添加索引前评估表大小，大表加索引会锁表较长时间，建议用 `pt-online-schema-change` 工具
- 慢查询日志磁盘写入有额外开销，排查完成后可关闭 `SET GLOBAL slow_query_log = 0`

关键词：
- mysql slow query
- slow_query_log
- mysqldumpslow
- EXPLAIN mysql
- full table scan
- mysql index missing
- long_query_time
