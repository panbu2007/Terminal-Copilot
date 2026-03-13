# SSH 登录失败与应急访问

适用场景：
- SSH 无法登录生产或测试主机
- 需要区分问题在网络、账号、密钥、sshd 还是主机资源
- 需要建立最小化应急访问路径

症状：
- `Permission denied (publickey)`
- `Connection timed out`
- `Connection refused`
- 登录后立即断开

快速判断：

客户端侧：

```bash
ssh -v user@host
```

服务端侧：

```bash
systemctl status sshd --no-pager
journalctl -u sshd -n 200 --no-pager
ss -ltnp | grep :22
```

修复步骤：

1. 判断网络层还是认证层
- 超时：优先看网络、防火墙、安全组、路由
- `refused`：优先看 sshd 服务和监听端口
- `publickey denied`：优先看账号、authorized_keys、权限

2. 检查 sshd 服务

```bash
systemctl status sshd --no-pager
ss -ltnp | grep :22
```

3. 检查账号与密钥
- 用户是否存在
- `~/.ssh/authorized_keys` 是否正确
- 目录权限是否过宽

```bash
ls -ld ~/.ssh
ls -l ~/.ssh/authorized_keys
```

4. 检查边界网络
- 安全组是否放通 22
- 防火墙是否允许
- 跳板机 / VPN 是否正常

5. 应急访问
- 优先使用云控制台串口、控制台登录或跳板机
- 不要在慌乱中直接开启密码登录到公网

回滚：
- 恢复旧的 sshd 配置
- 恢复已验证可用的密钥
- 如修改过端口、防火墙、安全组，恢复到上一个稳定模板

验证：
- 能正常 SSH 登录
- `journalctl -u sshd` 不再出现对应报错
- 应急入口可用但未扩大暴露面

风险提示：
- 不要为图省事把 root 密码登录长期开到公网
- 修改 sshd 配置前要保留现有会话，避免把自己锁在门外
- 公钥权限错误是高频问题

关键词：
- ssh login failed
- permission denied publickey
- connection refused
- connection timed out
- ssh emergency access
- 跳板机
- sshd 故障
- 应急登录

