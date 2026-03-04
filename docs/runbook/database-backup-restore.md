# 数据库备份与恢复常用命令

适用场景：
- 需要备份 MySQL / PostgreSQL / Redis 数据库
- 数据库损坏或误操作需要恢复
- 迁移数据库到新服务器

常见原因（需要备份/恢复的场景）：
- 上线前数据快照（回滚保障）
- 定期备份防止数据丢失
- 开发/测试环境数据同步

步骤（最小可用）：

### MySQL 备份与恢复

```bash
# 备份单个数据库
mysqldump -u root -p <database_name> > backup_$(date +%Y%m%d).sql

# 备份所有数据库
mysqldump -u root -p --all-databases > all_backup_$(date +%Y%m%d).sql

# 备份并压缩（节省空间）
mysqldump -u root -p <database_name> | gzip > backup_$(date +%Y%m%d).sql.gz

# 恢复数据库
mysql -u root -p <database_name> < backup_20240101.sql
# 恢复压缩备份
gunzip < backup_20240101.sql.gz | mysql -u root -p <database_name>

# 仅备份表结构（不含数据）
mysqldump -u root -p --no-data <database_name> > schema.sql
```

### PostgreSQL 备份与恢复

```bash
# 备份单个数据库（文本格式）
pg_dump -U postgres <database_name> > backup_$(date +%Y%m%d).sql

# 备份为自定义二进制格式（支持并行恢复）
pg_dump -U postgres -Fc <database_name> > backup_$(date +%Y%m%d).dump

# 备份所有数据库（含角色、表空间）
pg_dumpall -U postgres > all_backup_$(date +%Y%m%d).sql

# 恢复文本格式
psql -U postgres -d <database_name> < backup_20240101.sql

# 恢复二进制格式（支持并行 -j 参数）
pg_restore -U postgres -d <database_name> -j 4 backup_20240101.dump
```

### Redis 备份与恢复

```bash
# 手动触发 RDB 快照
redis-cli BGSAVE
# 查看 RDB 文件路径
redis-cli config get dir
redis-cli config get dbfilename

# 备份 RDB 文件
cp /var/lib/redis/dump.rdb /backup/redis_dump_$(date +%Y%m%d).rdb

# 恢复：停止 Redis，替换 dump.rdb，启动 Redis
sudo systemctl stop redis
sudo cp /backup/redis_dump_20240101.rdb /var/lib/redis/dump.rdb
sudo chown redis:redis /var/lib/redis/dump.rdb
sudo systemctl start redis
```

验证：
```bash
# MySQL：确认表数量
mysql -u root -p <database_name> -e "SHOW TABLES;" | wc -l

# PostgreSQL：确认表数量
psql -U postgres -d <database_name> -c "\dt" | grep -c "public"

# Redis：确认 key 数量
redis-cli dbsize
```

注意事项：
- 备份文件包含敏感数据，务必存放在权限受限的目录并加密传输
- 大型数据库备份期间会有性能影响，建议在低峰期执行

关键词：
- mysqldump backup restore
- pg_dump pg_restore
- redis BGSAVE dump.rdb
- database backup
- database migration
- sql backup file
