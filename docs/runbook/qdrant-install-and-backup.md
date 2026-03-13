# Qdrant 安装与快照备份

适用场景：
- 需要部署 Qdrant 作为向量数据库
- 需要完成最小安装、健康检查和快照备份
- 需要为 RAG 系统准备可恢复的备份路径

症状：
- Qdrant 服务无法启动
- 6333 端口不可达
- 数据目录未持久化
- 需要导出或恢复 collection snapshot

快速判断：

```bash
docker ps
curl http://127.0.0.1:6333
```

官方参考：
- Installation: https://qdrant.tech/documentation/guides/installation/
- Snapshots: https://qdrant.tech/documentation/concepts/snapshots/
- Create & restore snapshot tutorial: https://qdrant.tech/documentation/tutorials/create-snapshot/

修复步骤：

1. 最小 Docker 安装

```bash
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant
```

2. 验证服务

```bash
curl http://127.0.0.1:6333
```

3. 确认数据持久化
- 必须挂载 `/qdrant/storage`
- 不要仅使用临时容器层

4. 创建 collection 快照
- 单节点场景可直接对目标 collection 创建 snapshot
- 分布式场景要按节点分别处理

5. 备份策略
- 小规模自建：定期导出 snapshot 文件并异地存储
- 云上部署：优先使用平台内置 backup 能力或标准化 snapshot 任务

6. 恢复前确认
- snapshot 与目标集群 minor version 兼容
- 恢复期间业务影响和停机窗口明确

回滚：
- 恢复上一个可用 snapshot
- 恢复旧容器、旧数据卷或旧配置
- 对恢复影响范围做业务确认

验证：
- `curl http://127.0.0.1:6333` 正常
- collection 可访问
- snapshot 文件已生成并可归档

风险提示：
- 没有持久化卷时，容器删除会丢数据
- 恢复 snapshot 前要确认版本兼容性
- 分布式集群恢复要考虑节点级别快照和一致性

关键词：
- qdrant install
- qdrant docker
- qdrant snapshot
- qdrant backup
- qdrant restore
- 向量数据库
- qdrant 6333
- qdrant 持久化

