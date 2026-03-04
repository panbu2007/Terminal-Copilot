# Linux 文件描述符限制（too many open files）

适用场景：
- 应用报错 `Too many open files`
- `ulimit -n` 显示限制较低（默认 1024）
- 高并发服务（Nginx、数据库、Node.js）达到 fd 上限后崩溃或拒绝连接

常见原因：
- 系统或进程的文件描述符（fd）软限制过低
- 应用未正确关闭文件/socket，导致 fd 泄漏
- 高并发连接数超过默认限制

步骤（最小可用）：

1) 查看当前 fd 限制（当前 shell/用户）
```bash
ulimit -n       # 软限制
ulimit -Hn      # 硬限制
```

2) 查看系统全局 fd 限制
```bash
cat /proc/sys/fs/file-max
cat /proc/sys/fs/file-nr   # 已用 / 可用 / 最大
```

3) 查看指定进程当前打开的 fd 数量
```bash
ls /proc/<pid>/fd | wc -l
# 或
lsof -p <pid> | wc -l
```

4) 临时调高当前 shell 的 fd 限制（只影响当前会话）
```bash
ulimit -n 65536
# 验证
ulimit -n
```

5) 永久修改用户级 fd 限制
```bash
sudo vim /etc/security/limits.conf
# 添加以下行（替换 <username> 或用 * 代表所有用户）：
# <username>  soft  nofile  65536
# <username>  hard  nofile  65536
# *           soft  nofile  65536
# *           hard  nofile  65536
```

6) 永久修改系统全局 fd 上限
```bash
sudo vim /etc/sysctl.conf
# 添加：
# fs.file-max = 1000000
sudo sysctl -p
```

7) 为 systemd 服务单独设置 fd 限制
```bash
# 编辑服务文件
sudo systemctl edit nginx.service
# 在 [Service] 段添加：
# LimitNOFILE=65536
sudo systemctl daemon-reload
sudo systemctl restart nginx
```

8) 验证 systemd 服务实际 fd 限制
```bash
cat /proc/$(pgrep nginx | head -1)/limits | grep "open files"
```

验证：
```bash
# 确认限制已生效
ulimit -n
# 应用不再报 "Too many open files"
journalctl -u <service-name> -n 50 | grep -i "too many"
```

注意事项：
- `/etc/security/limits.conf` 的修改对通过 PAM 启动的进程有效；systemd 服务需用 `LimitNOFILE`
- 重新登录 shell 后 `limits.conf` 的修改才生效；systemd 服务需 `restart` 才生效

关键词：
- too many open files
- ulimit -n
- file descriptor limit
- LimitNOFILE systemd
- fs.file-max
- /etc/security/limits.conf nofile
- fd exhausted
