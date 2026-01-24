# 端口占用检查（跨平台）

同一个意图“检查端口是否被占用”，不同系统命令不同：

- Windows：`netstat -ano | findstr :8000`
- Linux：`ss -ltnp | grep :8000`
- macOS：`lsof -nP -iTCP:8000 -sTCP:LISTEN`

建议：拿到 PID 后再定位进程名（Windows 可结合任务管理器/PowerShell）。
