# Linux 僵尸进程处理

适用场景：
- `ps aux` 中看到进程状态为 `Z`（Zombie）
- `top` 显示 zombie 进程数量持续增加
- 系统进程表项被占满，无法创建新进程

常见原因：
- 子进程已退出，但父进程未调用 `wait()` 回收其退出状态
- 父进程本身已退出，子进程成为孤儿再变为僵尸（理论上 init 会回收）
- 应用程序 bug：创建大量子进程但未正确处理 SIGCHLD 信号

步骤（最小可用）：

1) 查找僵尸进程
```bash
ps aux | awk '{if ($8=="Z") print}'
# 或
ps aux | grep defunct
```

2) 查看僵尸进程数量
```bash
# top 右上角显示 zombie 数量
top
# 或
ps aux | awk '{print $8}' | grep -c Z
```

3) 查看僵尸进程的父进程（PPID）
```bash
ps -eo pid,ppid,stat,cmd | awk '{if ($3~/Z/) print}'
# 僵尸进程本身不能被杀；需要处理其父进程
```

4) 向父进程发送 SIGCHLD 信号（促使父进程回收子进程）
```bash
kill -SIGCHLD <parent-pid>
```

5) 如果父进程无响应，终止父进程（父进程退出后 init 会回收僵尸）
```bash
# 温和终止
kill -15 <parent-pid>
# 强制终止
kill -9 <parent-pid>
```

6) 确认 init/systemd 会自动接管并清理
```bash
# init (PID 1) 会回收孤儿进程
# 杀掉僵尸的父进程后，僵尸应自动消失
ps aux | grep defunct
```

验证：
```bash
# 确认僵尸进程数量为 0
top | head -5 | grep zombie
ps aux | awk '{if ($8=="Z") print}' | wc -l
```

注意事项：
- 僵尸进程本身不占 CPU 和内存，但占用进程表项（PID）；大量僵尸进程可能耗尽 PID 空间
- 不能直接 `kill -9` 僵尸进程，只能通过终止其父进程来清理

关键词：
- zombie process linux
- defunct process
- ps aux Z state
- kill SIGCHLD
- parent process zombie
- process table full
- zombie PID
