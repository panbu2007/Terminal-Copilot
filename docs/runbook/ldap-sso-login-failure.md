# LDAP / SSO 登录失败排查

适用场景：
- 企业系统接入 LDAP、OAuth、OIDC、SAML 后登录失败
- 用户反馈无法登录、循环跳转、鉴权成功但没有权限
- 需要判断问题在身份源、回调地址、时间偏差还是权限映射

症状：
- 登录页反复跳转
- 鉴权成功后返回 401 / 403
- 部分用户可登录，部分用户失败
- 新增用户无法拿到角色

快速判断：
- 身份源是否可达
- 回调 URL 是否匹配
- 时间同步是否正常
- 用户属性和组映射是否正确

修复步骤：

1. 确认认证类型
- LDAP
- OAuth / OIDC
- SAML

2. 检查基础配置
- issuer / LDAP server 地址
- client id / secret
- redirect URI / ACS URL
- scope、claim、group mapping

3. 检查系统时间
- 令牌、SAML 断言和 session 很依赖时间同步

```bash
date
timedatectl
```

4. 检查用户属性映射
- 邮箱
- 用户名
- UID
- 组 / 角色映射

5. 查看认证日志
- IdP 日志
- 应用日志
- 反向代理日志

回滚：
- 恢复上一个稳定的身份源配置
- 暂时切回本地管理员登录入口

验证：
- 测试用户能完成登录
- 角色和权限映射正确
- 回调链路不再循环

风险提示：
- SSO 故障往往是“登录看似成功但授权失败”
- 修改回调地址和组映射前要保留管理员后门
- 不要在日志中打印完整令牌和断言内容

关键词：
- ldap login failed
- sso login failed
- oidc redirect uri
- saml login
- oauth callback
- group mapping
- 单点登录故障
- 身份认证排查

