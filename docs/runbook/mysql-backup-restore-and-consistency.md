# MySQL 备份、恢复与一致性检查

适用场景：
- 需要执行 MySQL 逻辑备份或物理备份
- 需要恢复到测试环境或生产回滚环境
- 需要确认备份是否可用、恢复后数据是否一致

症状：
- 备份文件存在，但不确定是否可恢复
- 恢复后表缺失、数据不一致、外键异常
- 需要在变更前建立可靠回滚点

快速判断：

```bash
mysql -e "show databases;"
mysqldump --version
```

修复步骤：

1. 明确备份类型
- 逻辑备份：适合中小规模、跨版本可读性较好
- 物理备份：适合大规模和快速恢复

2. 逻辑备份最小示例

```bash
mysqldump -uUSER -p --single-transaction --routines --triggers DB_NAME > backup.sql
```

3. 恢复到测试环境验证

```bash
mysql -uUSER -p DB_NAME < backup.sql
```

4. 一致性检查
- 核对核心表行数
- 核对关键业务查询
- 核对字符集、时区、存储引擎、触发器与过程

5. 生产回滚前确认
- 恢复窗口
- 锁影响
- binlog 与复制链路影响

回滚：
- 恢复最近稳定备份
- 若误恢复到生产，需要先隔离写流量再恢复

验证：
- 备份文件可成功导入
- 核心表数据量符合预期
- 关键查询结果正确

风险提示：
- 没有恢复演练的备份不算有效备份
- 逻辑备份在大库上耗时较长
- 恢复到生产前必须评估增量数据丢失风险

关键词：
- mysql backup
- mysqldump
- mysql restore
- mysql consistency
- logical backup
- 数据恢复
- 回滚点
- mysql 备份恢复

