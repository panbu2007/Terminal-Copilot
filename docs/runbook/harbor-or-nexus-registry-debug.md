# Harbor / Nexus 制品仓库与镜像仓库排查

适用场景：
- Docker、CI 或部署系统无法拉取镜像
- Harbor 或 Nexus 无法登录、推送、拉取或显示制品
- 需要判断问题在认证、仓库权限、代理缓存还是网络

症状：
- `docker pull` 失败
- 登录仓库报认证错误
- 推送返回权限不足
- 代理仓库命中异常或上游同步失败

快速判断：

```bash
docker login REGISTRY
curl -I https://REGISTRY
```

修复步骤：

1. 先区分问题类型
- 登录失败：认证或证书问题
- 拉取失败：权限、网络、仓库路径或代理缓存问题
- 推送失败：权限、命名空间或仓库策略问题

2. 检查基础信息
- registry 地址
- 项目/命名空间
- 仓库路径
- 账号权限

3. 检查证书与 HTTPS
- 私有仓库常见问题是自签证书、证书链不完整或客户端不信任

4. 检查代理 / 缓存仓库
- 上游是否可达
- 缓存是否过期或同步失败
- 目标镜像 tag 是否实际存在

5. 检查服务日志
- Harbor：portal、core、registry、jobservice
- Nexus：应用日志、blob store、任务日志

回滚：
- 恢复上一个稳定仓库地址或认证方式
- 如刚改过代理上游或权限策略，恢复旧配置

验证：
- 可以成功登录
- 可以拉取目标镜像
- 推送或拉取在 CI 中恢复正常

风险提示：
- 不要把仓库管理员账号直接写入 CI
- 私有仓库证书问题常被误判为网络问题
- 删除 blob 或清理仓库前要先确认引用关系

关键词：
- harbor registry
- nexus registry
- docker pull failed
- docker login failed
- private registry
- image pull
- 镜像仓库排查
- 制品仓库

