# S3 / OSS 权限与连通性检查

适用场景：
- 应用无法访问对象存储
- 上传、下载、列目录、签名 URL 失败
- 需要区分问题在 AK/SK、权限策略、endpoint、桶策略还是网络

症状：
- 403 AccessDenied
- 连接超时
- 签名错误
- bucket 存在但操作失败

快速判断：
- 确认 endpoint、bucket、region 是否正确
- 确认 AK/SK 是否有效
- 确认对象存储网络出口可达

修复步骤：

1. 核对基础配置
- endpoint
- bucket 名称
- region
- access key / secret key

2. 检查权限
- 用户策略
- bucket policy
- 临时凭据是否过期

3. 检查网络
- DNS
- 出口网络
- 代理

4. 最小操作验证
- 列桶
- 上传一个最小对象
- 下载回读

回滚：
- 恢复上一个稳定 endpoint 和凭据
- 恢复旧策略版本

验证：
- 最小上传下载成功
- 应用恢复访问
- 不再出现签名或权限错误

风险提示：
- 不要把对象存储密钥写入仓库
- 策略过宽和策略过窄都可能带来问题
- 跨 region 和私网 endpoint 经常导致“配置看起来对，但就是连不上”

关键词：
- s3 access denied
- oss permission
- object storage connectivity
- bucket policy
- signed url
- endpoint region
- 对象存储权限
- s3 连接失败

