# Linux 时区和时间同步问题

适用场景：
- 系统时间显示不正确（早/晚若干小时）
- 日志时间戳与实际时间不符
- HTTPS 证书验证失败（时间偏差过大）
- 分布式系统节点时间不一致

常见原因：
- 时区设置错误（如设置为 UTC 但期望为本地时区）
- NTP 同步服务未运行或 NTP 服务器不可达
- 虚拟机挂起/恢复后时间漂移

步骤（最小可用）：

1) 查看当前时间和时区
```bash
date
timedatectl status
```

2) 列出可用时区
```bash
timedatectl list-timezones | grep Asia
timedatectl list-timezones | grep Shanghai
```

3) 设置时区
```bash
# 设置为中国标准时间（CST, UTC+8）
sudo timedatectl set-timezone Asia/Shanghai
# 验证
date
timedatectl status
```

4) 检查 NTP 同步状态
```bash
timedatectl status | grep NTP
# 或查看 chrony（现代发行版常用）
chronyc tracking
chronyc sources -v
```

5) 启用 NTP 自动同步（systemd-timesyncd）
```bash
sudo timedatectl set-ntp true
systemctl status systemd-timesyncd
```

6) 安装并使用 chrony（推荐，精度更高）
```bash
sudo apt install -y chrony         # Debian/Ubuntu
# 或
sudo yum install -y chrony         # CentOS/RHEL
sudo systemctl enable chrony --now
chronyc tracking
```

7) 手动同步时间（应急，需停 NTP 服务）
```bash
sudo systemctl stop systemd-timesyncd
sudo ntpdate -u ntp.aliyun.com
sudo systemctl start systemd-timesyncd
```

8) 配置国内 NTP 服务器（提升同步速度和稳定性）
```bash
# 编辑 /etc/chrony.conf 或 /etc/ntp.conf
# 添加或替换 server 行：
# server ntp.aliyun.com iburst
# server ntp.tencent.com iburst
# server cn.pool.ntp.org iburst
sudo systemctl restart chrony
```

验证：
```bash
# 确认时区正确、NTP 已同步
timedatectl status
# 确认时间接近真实时间
date
```

注意事项：
- 修改时区只影响显示，不改变系统时钟（UTC 不变）
- 大幅调整时间（超过 1000 秒）时 NTP 默认拒绝同步，需先用 `ntpdate` 手动对齐

关键词：
- timedatectl set-timezone
- NTP sync linux
- chrony time sync
- date wrong timezone
- Asia/Shanghai timezone
- systemd-timesyncd
- ntpdate aliyun
