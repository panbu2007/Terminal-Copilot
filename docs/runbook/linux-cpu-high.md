# Linux CPU 100% 排查（top/perf）

适用场景：
- 系统响应极慢，`top` 显示 CPU 使用率接近 100%
- 某个进程持续占用大量 CPU
- 系统负载（Load Average）持续偏高

常见原因：
- 某个进程出现死循环或 busy-wait
- 病毒/挖矿程序占用 CPU
- 大量并发请求导致应用线程耗尽
- 内核线程（如 kworker）异常

步骤（最小可用）：

1) 查看整体 CPU 使用情况（实时）
```bash
top
# 按 P 键按 CPU 使用率排序
# 按 1 键查看每个 CPU 核心
```

2) 找出 CPU 占用最高的进程
```bash
# 静态快照，适合脚本
ps aux --sort=-%cpu | head -20
```

3) 查看进程的线程 CPU 占用
```bash
# -H 显示线程，-p 指定 PID
top -H -p <pid>
```

4) 查看进程详情（命令行、父进程）
```bash
ps -p <pid> -o pid,ppid,user,cmd,%cpu,%mem
cat /proc/<pid>/cmdline | tr '\0' ' '
```

5) 使用 perf 分析热点函数（需要 linux-tools 包）
```bash
sudo apt install -y linux-tools-$(uname -r)   # Debian/Ubuntu
# 采样 30 秒，分析 CPU 热点
sudo perf top -p <pid>
# 或记录到文件后分析
sudo perf record -g -p <pid> sleep 30
sudo perf report
```

6) 查看系统调用（strace）
```bash
sudo strace -p <pid> -c -f
# -c 统计各系统调用次数，-f 跟踪子线程
```

7) 查看是否有异常进程（挖矿等）
```bash
# 检查进程的网络连接
sudo ss -tnp | grep <pid>
# 检查进程打开的文件
sudo lsof -p <pid> | head -30
```

8) 终止 CPU 占用高的进程（确认后）
```bash
kill -15 <pid>   # 温和终止
kill -9 <pid>    # 强制终止（最后手段）
```

验证：
```bash
# 确认 CPU 使用率恢复正常
top
# 或用 vmstat 查看系统整体
vmstat 1 5
```

注意事项：
- 杀进程前先确认进程身份，避免误杀系统关键进程
- `perf` 对内核版本有依赖，确保 `linux-tools` 版本与内核版本一致

关键词：
- cpu 100 percent
- top cpu usage
- high cpu linux
- ps aux sort cpu
- perf top
- process cpu spike
- load average high
