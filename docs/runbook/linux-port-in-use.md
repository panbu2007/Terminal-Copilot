# Linux 端口占用排查（ss → PID → 进程信息）

适用场景：
- `Address already in use`
- 服务起不来，怀疑端口被占

步骤（最小可用）：

1) 查端口监听与 PID
- `ss -ltnp | grep :8000`

2) 进一步确认进程信息
- `ps -p <PID> -o pid,ppid,user,cmd --no-headers`

3) 结束进程（谨慎，优先温和）
- `kill <PID>`
- 若无效再 `kill -9 <PID>`

验证：
- 重新 `ss -ltnp | grep :8000` 无输出
- 服务重新启动成功

回滚：
- 无（杀进程不可逆）；建议确认 PID 再操作

关键词：
- ss -ltnp
- Address already in use
- kill pid
