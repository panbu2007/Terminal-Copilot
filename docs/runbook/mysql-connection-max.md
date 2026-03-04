# MySQL 连接数满（Too many connections）处理

适用场景：
- 应用报错 `ERROR 1040 (HY000): Too many connections`
- MySQL 无法接受新连接，服务不可用
- 监控显示 MySQL 连接数持续接近上限

常见原因：
- `max_connections` 设置过低（默认 151）
- 应用连接池未正确关闭连接（连接泄漏）
- 大量长耗时查询占用连接未释放
- 突发流量导致连接数瞬间耗尽

步骤（最小可用）：

1) 查看当前连接数与上限
```bash
mysql -u root -p -e "SHOW VARIABLES LIKE 'max_connections';"
mysql -u root -p -e "SHOW STATUS LIKE 'Threads_connected';"
mysql -u root -p -e "SHOW STATUS LIKE 'Max_used_connections';"
```

2) 查看当前所有连接列表
```bash
mysql -u root -p -e "SHOW PROCESSLIST;"
# 或更详细
mysql -u root -p -e "SELECT id, user, host, db, command, time, state FROM information_schema.processlist ORDER BY time DESC LIMIT 50;"
```

3) 杀掉长时间空闲或阻塞的连接
```bash
# 杀掉特定连接
mysql -u root -p -e "KILL <connection-id>;"
# 批量杀掉 Sleep 超过 300 秒的连接（生成并执行）
mysql -u root -p -e "SELECT CONCAT('KILL ', id, ';') FROM information_schema.processlist WHERE command='Sleep' AND time > 300;" | mysql -u root -p
```

4) 临时提高连接数上限（立即生效，重启后失效）
```bash
mysql -u root -p -e "SET GLOBAL max_connections = 500;"
```

5) 永久修改连接数上限（修改配置文件）
```bash
sudo vim /etc/mysql/mysql.conf.d/mysqld.cnf
# 添加或修改：
# [mysqld]
# max_connections = 500
sudo systemctl restart mysql
```

6) 检查应用连接池配置
```bash
# 确认连接池 max_pool_size 合理，连接用完后能正确释放
# Python SQLAlchemy 示例：pool_size=10, max_overflow=20
```

验证：
```bash
mysql -u root -p -e "SHOW STATUS LIKE 'Threads_connected';"
# 确认连接数下降，应用能正常连接
```

注意事项：
- 提高 `max_connections` 会增加内存消耗（每个连接约 1MB），不能无限制调高
- 根本解决需排查连接泄漏，确保应用使用连接池并正确关闭连接

关键词：
- too many connections mysql
- max_connections
- SHOW PROCESSLIST
- mysql connection pool
- KILL connection
- Threads_connected
- ERROR 1040
