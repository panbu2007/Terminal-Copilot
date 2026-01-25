# 端口被占用：8000（定位 PID → 结束 → 验证）

适用场景：
- 启动服务报 `Address already in use` / `bind: address already in use`
- 端口 8000 被占用

步骤（Windows）：

1) 查占用与 PID
- `netstat -ano | findstr :8000`

2)（可选）确认进程
- `tasklist | findstr <PID>`

3) 结束进程（谨慎）
- `taskkill /PID <PID> /F`

步骤（Linux）：

1) 查占用与 PID
- `ss -ltnp | grep :8000`

2) 结束进程（谨慎）
- `kill -9 <PID>`（优先尝试不带 -9）

步骤（macOS）：

1) 查占用
- `lsof -nP -iTCP:8000 -sTCP:LISTEN`

2) 结束
- `kill <PID>`

验证：
- 再次执行端口检查命令，8000 不再 LISTEN
- 服务能成功启动

回滚：
- 无（杀进程不可逆）；建议优先找对 PID 再操作

关键词：
- Address already in use
- netstat 8000
- ss -ltnp
- lsof 8000
