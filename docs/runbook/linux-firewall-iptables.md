# Linux iptables/firewall 防火墙规则管理

适用场景：
- 服务端口通但外部访问不通，怀疑防火墙拦截
- 需要开放或关闭特定端口
- `iptables` 或 `firewalld`/`ufw` 规则管理

常见原因：
- 默认 INPUT 链策略为 DROP，新增端口未放行
- firewalld/ufw 开启后未为服务添加规则
- Docker 修改了 iptables 规则导致冲突

步骤（最小可用）：

### 方法一：使用 ufw（Ubuntu/Debian 常用）

```bash
# 查看当前规则状态
sudo ufw status verbose

# 开放端口
sudo ufw allow 8080/tcp
sudo ufw allow 443/tcp

# 关闭端口
sudo ufw deny 8080/tcp

# 启用/禁用 ufw
sudo ufw enable
sudo ufw disable

# 删除规则
sudo ufw delete allow 8080/tcp
```

### 方法二：使用 firewalld（CentOS/RHEL/Fedora 常用）

```bash
# 查看当前区域和规则
sudo firewall-cmd --list-all

# 开放端口（立即生效 + 永久）
sudo firewall-cmd --add-port=8080/tcp --permanent
sudo firewall-cmd --reload

# 关闭端口
sudo firewall-cmd --remove-port=8080/tcp --permanent
sudo firewall-cmd --reload

# 查看所有区域
sudo firewall-cmd --get-active-zones
```

### 方法三：直接使用 iptables

```bash
# 查看当前规则（含行号）
sudo iptables -L INPUT -n -v --line-numbers

# 允许特定端口
sudo iptables -A INPUT -p tcp --dport 8080 -j ACCEPT

# 拒绝特定端口
sudo iptables -A INPUT -p tcp --dport 8080 -j DROP

# 删除规则（按行号）
sudo iptables -D INPUT <line-number>

# 保存规则（Debian/Ubuntu）
sudo iptables-save | sudo tee /etc/iptables/rules.v4
# 保存规则（CentOS/RHEL）
sudo service iptables save
```

验证：
```bash
# 从外部测试端口是否可达
nc -zv <server-ip> 8080
# 或使用 curl
curl -v telnet://<server-ip>:8080

# 查看最终生效规则
sudo iptables -L INPUT -n -v
sudo ufw status
```

注意事项：
- 修改 INPUT 链之前确认 SSH 端口（默认 22）已放行，否则会锁死服务器
- 不建议同时使用 `ufw`、`firewalld` 和裸 `iptables`，会相互干扰

关键词：
- iptables rule
- ufw allow port
- firewalld add port
- open port linux
- firewall port not accessible
- iptables -L INPUT
