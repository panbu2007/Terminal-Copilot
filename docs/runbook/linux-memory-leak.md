# Linux 内存泄漏/OOM 排查

适用场景：
- 系统内存随时间持续增长，最终触发 OOM Killer
- `/var/log/syslog` 或 `dmesg` 出现 `Out of memory: Kill process`
- 某进程内存占用异常高

常见原因：
- 应用程序未释放已分配的内存（内存泄漏）
- 缓存未设置上限，无限积累
- JVM/Python 垃圾回收配置不当

步骤（最小可用）：

1) 查看系统内存整体使用
```bash
free -h
# 重点关注 available 列（真实可用内存）
```

2) 查看内存占用最高的进程
```bash
ps aux --sort=-%mem | head -20
# 或用 top，按 M 键按内存排序
top
```

3) 查看 OOM Killer 日志（哪些进程被杀过）
```bash
sudo dmesg | grep -i "oom\|killed process\|out of memory"
sudo journalctl -k | grep -i "oom"
```

4) 监控进程内存变化趋势
```bash
# 每 5 秒打印一次进程内存（RSS，单位 KB）
while true; do
  ps -p <pid> -o pid,rss,vsz,cmd --no-headers
  sleep 5
done
```

5) 使用 smem 查看详细内存使用（如已安装）
```bash
sudo apt install -y smem
smem -r -s rss | head -20
```

6) 查看进程的内存映射详情
```bash
cat /proc/<pid>/status | grep -E "VmRSS|VmSize|VmSwap"
# 查看内存段映射
pmap -x <pid> | tail -5
```

7) 使用 valgrind 检测 C/C++ 程序内存泄漏（开发环境）
```bash
valgrind --leak-check=full ./my_program
```

8) 配置 OOM 优先级（让非关键进程先被杀）
```bash
# 值越高越容易被 OOM Killer 选中（范围 -1000~1000）
echo 500 | sudo tee /proc/<pid>/oom_score_adj
```

9) 临时增加 Swap 空间缓解（应急）
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
# 确认 swap 已启用
free -h
```

验证：
```bash
# 内存使用不再持续增长
watch -n5 'free -h && ps aux --sort=-%mem | head -5'
```

注意事项：
- Swap 是应急措施，频繁使用 Swap 会严重拖慢系统；根本需修复内存泄漏
- OOM Killer 被触发时系统已非常紧张，应在内存达到 80% 时提前预警处理

关键词：
- out of memory linux
- OOM killer
- memory leak linux
- free -h
- ps aux mem
- dmesg killed process
- /proc/pid/status VmRSS
