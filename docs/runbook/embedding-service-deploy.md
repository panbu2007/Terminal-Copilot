# Embedding 服务部署与验证

适用场景：
- 需要为 RAG 或检索系统部署独立 embedding 服务
- 需要统一管理 embedding 模型、接口和调用验证
- 需要在云接口与本地 embedding 服务之间切换

症状：
- 检索系统无法获取向量
- embedding API 超时或返回格式不兼容
- 模型升级后向量维度变化导致检索异常

快速判断：
- 确认模型名称
- 确认接口 URL
- 确认返回向量维度

修复步骤：

1. 明确部署方式
- 云 API
- 本地 Python 服务
- 本地容器化服务

2. 最小验证
- 对固定文本做一次 embedding
- 记录：
  - 模型名
  - 接口地址
  - 向量维度
  - 超时参数

3. 接口契约确认
- 请求字段
- 响应字段
- 批量输入格式
- 错误码与重试策略

4. 接入检索系统前
- 确认新旧向量维度一致
- 如果模型切换，考虑重建索引

回滚：
- 恢复到上一个 embedding 模型和接口
- 如果维度变化影响索引，回滚索引版本

验证：
- 单条文本 embedding 成功
- 检索系统可正常调用
- 返回维度与索引预期一致

风险提示：
- embedding 模型切换常常需要重建索引
- 不同服务的返回格式不兼容时，要先做适配层
- 不要把 API Key 直接写进调用脚本

关键词：
- embedding service
- embedding api
- vector dimension
- embedding deploy
- rag embedding
- 向量服务
- embedding 验证
- 向量检索

