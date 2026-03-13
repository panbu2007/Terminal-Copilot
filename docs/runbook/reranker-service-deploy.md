# Reranker 服务部署与验证

适用场景：
- 需要为 RAG 增加 reranker 层，提升结果排序质量
- 需要部署本地或远程 reranker 服务
- 需要验证 reranker 接口与检索链路兼容

症状：
- 检索召回有结果，但排序明显不准
- reranker 接口超时
- 返回分数格式不符合现有链路

快速判断：
- 确认 reranker 模型名
- 确认输入格式是否为 query + documents
- 确认输出是否包含 score / sorted indices

修复步骤：

1. 明确部署方式
- 云 API
- 本地 Python 推理
- 独立容器服务

2. 最小验证
- 选择一条 query 和 3 到 5 条候选文档
- 调用 reranker，确认排序结果符合直觉

3. 接口约束
- query 长度限制
- documents 数量限制
- 超时策略
- 批量调用方式

4. 接入检索链路
- 先在 top-k 候选上做 rerank
- 不要一开始就对全量文档做 rerank

回滚：
- 恢复到 keyword / embedding 原始排序
- 关闭 reranker 开关，回到上一版检索链路

验证：
- reranker 调用成功
- top-k 结果排序更合理
- 整体延迟仍在可接受范围

风险提示：
- reranker 适合精排，不适合替代召回
- 候选集过大时延迟会明显上升
- 模型切换后要重新评估排序质量与性能

关键词：
- reranker service
- rerank deploy
- query documents score
- rag rerank
- cross encoder
- 精排服务
- reranker 验证
- 检索排序

