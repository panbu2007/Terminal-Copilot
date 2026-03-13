# Nexus Blob Store 磁盘满排查

适用场景：
- Nexus 制品库磁盘空间不足
- 推送制品失败、清理任务失败、仓库响应异常
- 需要区分问题在 blob store、磁盘、清理策略还是数据库

症状：
- Nexus 无法上传新制品
- UI 或 API 报空间不足
- 宿主机磁盘打满

快速判断：

```bash
df -h
du -sh /nexus-data/*
```

修复步骤：

1. 先确认哪个磁盘或目录满了
- 宿主机磁盘
- 挂载卷
- blob store 目录

2. 检查 Nexus blob store
- 哪个仓库增长最快
- 是否有代理缓存堆积
- 是否长期未执行清理策略

3. 检查日志
- 看是否有写入失败、任务失败、索引失败

4. 执行清理
- 先使用平台内置清理策略和任务
- 不要直接删除 blob 文件，除非非常明确其影响

5. 扩容或迁移
- 若仓库持续增长，评估扩容卷或调整存储策略

回滚：
- 恢复上一个稳定 blob store 配置
- 若清理策略误删，按备份或快照恢复

验证：
- 磁盘空间恢复
- 上传、下载恢复正常
- 清理任务运行成功

风险提示：
- 手工删除 blob 文件极易造成元数据与实际文件不一致
- 先确认“删什么”比“马上清空间”更重要
- 私有仓库故障会放大为整个 CI/CD 故障

关键词：
- nexus blob store
- nexus disk full
- nexus cleanup
- artifact storage full
- repository storage
- 制品库磁盘满
- nexus 清理
- blob store 排查

