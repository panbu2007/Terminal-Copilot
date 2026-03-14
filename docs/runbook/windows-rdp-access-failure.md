# Windows RDP 访问失败排查

适用场景：
- Windows 服务器无法通过远程桌面连接
- 需要判断问题在服务、防火墙、网络、证书还是账号权限

症状：
- RDP 客户端连接超时
- 提示目标计算机拒绝连接
- 登录界面出现但账号无法进入桌面

快速判断：

```powershell
Test-NetConnection SERVER_IP -Port 3389
qwinsta
```

修复步骤：

1. 检查网络与端口
- 先确认 3389 是否可达
- 确认安全组、防火墙和跳板链路正常

2. 检查远程桌面服务

```powershell
Get-Service TermService
```

3. 检查系统是否启用远程桌面
- 确认目标主机允许 RDP
- 确认目标账号有远程登录权限

4. 检查本机防火墙

```powershell
Get-NetFirewallRule -DisplayGroup "Remote Desktop"
```

5. 检查会话与资源
- 目标机是否资源耗尽
- 是否存在挂死会话或许可限制

回滚：
- 恢复上一个稳定的 RDP、防火墙和组策略配置
- 如最近改过端口或网络策略，恢复旧配置

验证：
- `Test-NetConnection` 成功
- 可正常进入远程桌面

风险提示：
- 不要为了排障把 RDP 无限制暴露到公网
- 先保留控制台或带外入口，避免把自己锁在门外

关键词：
- windows rdp failed
- remote desktop failed
- rdp port 3389
- termservice
- 远程桌面
- 3389 不通
- windows 登录失败
- rdp 排查

