# Secrets 轮换与环境变量审计

适用场景：
- 需要轮换 API Key、数据库密码、Webhook Token、SSH 密钥
- 需要确认应用当前实际加载了哪些 secrets
- 需要减少配置漂移和泄露风险

症状：
- 已经修改了新 key，但应用仍在使用旧值
- 同一个服务在文件、环境变量、systemd、容器中存在多份配置
- 无法确认线上到底加载了哪一个 token
- 怀疑 secrets 已泄露或被错误提交

快速判断：

```bash
systemctl show -p Environment service-name
docker inspect container-name
printenv | grep -E 'KEY|TOKEN|SECRET'
```

修复步骤：

1. 列出 secrets 来源
- 环境变量
- `.env` 文件
- systemd `Environment=` / `EnvironmentFile=`
- 容器环境变量
- 密钥管理系统
- 应用本地 secrets 目录

2. 确认优先级
- 明确应用实际读取顺序
- 记录“谁覆盖谁”
- 避免同一个 secret 同时存在于多处

3. 执行轮换
- 先创建新 secret
- 修改应用配置引用到新 secret
- 重启或 reload 服务
- 验证业务正常
- 再删除旧 secret

4. 审计历史泄露面
- 检查 shell 历史、日志、CI 输出、配置仓库、聊天记录、截图
- 对已泄露的 secret，不要只删除展示位置，必须真正轮换

5. 核对服务实际加载值
- 不直接打印完整 secret
- 只比对长度、前后缀、时间戳或版本号

6. 对高敏感 secret 建立最小权限
- API Key 仅授予需要的范围
- 生产与测试分离
- 个人 key 与服务 key 分离

回滚：
- 保留旧 secret 的短期可回退窗口
- 若新 secret 引发故障，恢复旧版本配置并重启服务
- 回滚后继续排查新 secret 的权限、格式和依赖方同步情况

验证：
- 应用健康检查通过
- 新 token 生效，旧 token 失效
- 配置源唯一且清晰
- 日志中不再出现旧 token 相关报错

风险提示：
- 不要把完整 secret 打到日志、终端历史或工单系统
- 轮换要考虑所有依赖方，不然容易造成级联故障
- 聊天工具里出现过的 key 默认按已泄露处理

关键词：
- secrets rotation
- env audit
- api key rotate
- token audit
- environment variable audit
- secret 泄露
- 密钥轮换
- 配置审计

