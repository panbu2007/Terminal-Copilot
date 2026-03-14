# GitLab / GitHub Webhook 调试

适用场景：
- Webhook 事件未触发下游服务
- 下游收到重复事件、签名校验失败或超时
- 需要区分问题在源平台、网络、签名还是接收端

症状：
- 推送代码后下游无反应
- 平台显示 webhook 失败
- 接收服务返回 4xx / 5xx

快速判断：
- 平台侧查看 webhook delivery 记录
- 接收端查看访问日志与错误日志
- 确认目标 URL、签名 secret、超时设置

修复步骤：

1. 先看平台 delivery 历史
- 状态码
- 请求体
- 重试情况

2. 看接收端日志
- 是否收到请求
- 是否签名校验失败
- 是否 JSON 解析失败

3. 手工重放最小请求
- 用 curl 模拟一个简单 POST
- 先验证网络，再验证签名逻辑

4. 检查反向代理与 HTTPS
- 是否被代理层拦截
- 是否证书或 SNI 异常

回滚：
- 恢复旧的 webhook URL 或旧 secret
- 暂时关闭问题 webhook，防止持续重试造成噪声

验证：
- 平台 delivery 成功
- 接收端业务处理成功
- 幂等逻辑能处理重试

风险提示：
- 不要在日志中输出完整 webhook secret
- Webhook 接收端需要幂等处理
- 公开暴露的接收端应校验签名和来源

关键词：
- webhook debug
- github webhook
- gitlab webhook
- webhook signature
- delivery failed
- webhook timeout
- 回调调试
- webhook 重放

