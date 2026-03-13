# Windows 域加入与 AD 登录排查

适用场景：
- Windows 主机需要加入 Active Directory 域
- 域用户无法登录、策略未下发或域控制器不可达
- 需要区分问题在 DNS、时间同步、域控连通性还是账号权限

症状：
- 域加入失败
- 域用户登录失败
- 提示找不到域控制器
- 域加入后组策略未生效

快速判断：

```powershell
systeminfo | findstr /B /C:"Domain"
nltest /dsgetdc:YOURDOMAIN
whoami
```

修复步骤：

1. 先确认 DNS
- Windows 加域首先依赖域 DNS
- 客户端 DNS 应指向域控或企业 DNS，不应先指向公网 DNS

2. 检查时间同步
- Kerberos 对时间偏差敏感

```powershell
w32tm /query /status
```

3. 检查域控可达性

```powershell
nltest /dsgetdc:YOURDOMAIN
Test-NetConnection dc.example.com -Port 389
Test-NetConnection dc.example.com -Port 88
```

4. 执行域加入
- 在系统设置或 PowerShell 中完成域加入
- 域加入前确认：
  - 账号有加域权限
  - 主机名符合规范

5. 登录排查
- 若域用户无法登录，检查：
  - 账号是否被禁用
  - 组策略是否限制登录
  - 域控制器和客户端时间是否一致

回滚：
- 将机器移出域，恢复到工作组
- 恢复旧 DNS 和本地登录方式

验证：
- `systeminfo` 显示正确域名
- 域用户可登录
- 组策略可刷新：

```powershell
gpupdate /force
```

风险提示：
- 不要在 DNS 未确认前盲目加域
- 时间同步异常会导致很多看似“账号错误”的问题
- 域管理员凭据不要长期保存在普通终端上

关键词：
- windows ad join
- domain join failed
- ad login failed
- nltest
- kerberos time skew
- windows domain
- 域加入
- 域登录故障

