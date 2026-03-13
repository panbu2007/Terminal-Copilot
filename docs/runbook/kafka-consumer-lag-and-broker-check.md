# Kafka 消费积压与 Broker 状态检查

适用场景：
- 需要排查 Kafka topic 消费积压
- 需要判断问题在 consumer、broker、网络还是分区不均
- 需要在事故中快速确认消息系统是否是瓶颈

症状：
- consumer lag 持续上升
- 消费延迟明显
- producer 正常写入，但下游处理变慢
- broker 报磁盘、ISR、网络或 leader 问题

快速判断：
- 查看 consumer lag
- 查看 broker 状态
- 查看 topic 分区与 leader 分布

修复步骤：

1. 先确认积压范围
- 哪个 topic
- 哪个 consumer group
- 是全部分区还是局部分区

2. 检查 consumer
- 进程是否存活
- 是否频繁 rebalance
- 是否因为下游依赖慢而卡住

3. 检查 broker
- 磁盘是否接近打满
- 网络是否异常
- ISR 是否缩小
- 是否存在 leader 偏斜

4. 检查分区设计
- 分区数是否过少
- 热 key 是否导致单分区热点
- 消费端并发是否跟不上

回滚：
- 若最近做过 consumer 发布或配置变更，回滚到上一版本
- 恢复上一个稳定的消费并发和批处理参数

验证：
- lag 开始下降
- 消费吞吐恢复
- broker 不再报异常

风险提示：
- 强行跳 offset 会造成数据丢失或业务不一致
- 仅扩 consumer 数量不一定能解决单分区热点
- broker 磁盘和网络问题会引发更大范围故障

关键词：
- kafka lag
- consumer lag
- broker check
- kafka backlog
- kafka rebalance
- message queue
- 消费积压
- kafka 故障

