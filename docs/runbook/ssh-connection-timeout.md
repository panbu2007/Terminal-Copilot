# SSH 连接超时/断开排查

适用场景：
- `ssh user@host` 长时间无响应后报 `Connection timed out`
- SSH 连接建立后，一段时间不操作自动断开
- 报错 `Connection refused`、`No route to host`

常见原因：
- 服务器防火墙未开放 22 端口（或自定义 SSH 端口）
- sshd 服务未启动
- 网络中间设备（NAT/防火墙）断开空闲连接
- `~/.ssh/config` 或 `known_hosts` 配置问题

步骤（最小可用）：

1) 增加 ssh 调试输出定位问题
```bash
ssh -v user@host
# 或更详细
ssh -vvv user@host
```

2) 检查服务器 sshd 服务状态（在服务器上执行）
```bash
sudo systemctl status sshd
sudo systemctl start sshd
```

3) 检查服务器 SSH 端口是否监听
```bash
ss -ltnp | grep :22
```

4) 检查防火墙是否放行 SSH 端口
```bash
sudo ufw status | grep ssh
# 或
sudo firewall-cmd --list-ports | grep 22
```

5) 解决 SSH 会话超时断开（客户端配置心跳）
```bash
# 在 ~/.ssh/config 中添加：
cat >> ~/.ssh/config << 'EOF'
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
EOF
```

6) 服务器端配置 keepalive
```bash
# 编辑 /etc/ssh/sshd_config
sudo vim /etc/ssh/sshd_config
# 添加或修改：
# ClientAliveInterval 60
# ClientAliveCountMax 3
sudo systemctl reload sshd
```

7) 清理 known_hosts 中的过期主机记录
```bash
# 报 "Host key verification failed" 时
ssh-keygen -R <host-ip-or-hostname>
```

8) 指定私钥或跳过主机验证（调试用）
```bash
ssh -i ~/.ssh/id_rsa user@host
# 临时跳过主机验证（不推荐用于生产）
ssh -o StrictHostKeyChecking=no user@host
```

验证：
```bash
# 连接成功并保持
ssh -v user@host
# 连接后执行命令确认正常
uptime
```

注意事项：
- `ServerAliveInterval` 是客户端心跳配置，避免因 NAT 超时断开会话
- 修改 sshd_config 后必须 `reload sshd` 才能生效；不要 restart 以免中断现有连接

关键词：
- ssh connection timed out
- ssh connection refused
- ssh broken pipe
- ssh keepalive ServerAliveInterval
- sshd service
- ssh -v debug
- known_hosts
