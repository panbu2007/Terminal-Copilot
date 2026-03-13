# SAML 证书轮换

适用场景：
- 使用 SAML SSO 的系统需要轮换签名证书或加密证书
- 登录突然失败，怀疑是证书到期或元数据未同步

症状：
- SAML 登录失败
- IdP / SP 提示证书无效、签名校验失败
- 证书更新后只有部分系统恢复

快速判断：
- 证书是否到期
- IdP 和 SP 是否都加载了新证书
- 元数据是否重新同步

修复步骤：

1. 明确轮换对象
- IdP 签名证书
- SP 证书
- 加密证书

2. 提前准备重叠窗口
- 新旧证书并存一段时间更稳妥
- 不要让切换变成单点瞬时动作

3. 更新元数据
- 在 IdP 与 SP 两侧同步新的 metadata
- 确认实体 ID、ACS URL、证书指纹一致

4. 验证时间与缓存
- 浏览器 session、平台 metadata 缓存可能导致“部分成功、部分失败”

5. 切换后用测试账号验证
- 登录
- 登出
- 权限映射

回滚：
- 恢复旧证书与旧 metadata
- 在切换窗口内保留旧证书回退能力

验证：
- 测试用户登录成功
- 新证书已被 IdP / SP 双方识别
- 不再出现签名校验错误

风险提示：
- SAML 证书轮换失败经常导致全员无法登录
- 切换前必须保留管理员后门
- 元数据同步延迟是高频问题

关键词：
- saml certificate rotation
- saml metadata
- saml signature invalid
- sso certificate
- idp sp cert
- 单点登录证书
- saml 轮换
- metadata 同步

