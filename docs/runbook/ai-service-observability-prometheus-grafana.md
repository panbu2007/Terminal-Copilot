# AI 服务可观测性：Prometheus / Grafana 基础盘

适用场景：
- 需要为 AI 服务建立基础监控
- 需要观察延迟、错误率、资源使用、队列长度、GPU 使用情况
- 需要让值班排障不再只靠日志

症状：
- 服务出问题时，没有统一指标面板
- 无法回答“什么时候开始变慢”“是哪台机器异常”
- GPU 显存和请求延迟缺少历史趋势

快速判断：
- 是否已有 metrics endpoint
- 是否已有 Prometheus 抓取配置
- 是否已有 Grafana 面板

修复步骤：

1. 先定义最小指标集
- QPS
- 错误率
- 请求延迟
- 并发数
- 队列积压
- CPU / memory / GPU / disk

2. 暴露 metrics
- 业务服务提供 `/metrics`
- GPU 机器增加 GPU 指标采集

3. 配置 Prometheus 抓取
- 抓取目标
- 标签
- 抓取频率

4. 在 Grafana 做最小面板
- 服务可用性
- 请求延迟
- 错误率
- 资源使用
- GPU 使用

5. 配告警
- 服务不可用
- 错误率激增
- 延迟异常
- 显存过高

回滚：
- 暂时关闭有问题的抓取任务或告警规则
- 恢复上一个稳定 dashboard / rule 配置

验证：
- 指标可见
- 面板有数据
- 告警能触发并恢复

风险提示：
- 没有标签规范会导致后续指标失控
- 只做 dashboard 不做告警，值班收益有限
- 采集过密可能给高负载服务增加压力

关键词：
- prometheus
- grafana
- ai observability
- gpu metrics
- service latency
- error rate
- 可观测性
- 监控告警

