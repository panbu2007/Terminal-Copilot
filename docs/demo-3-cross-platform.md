# Demo3：跨平台分支（同一意图不同命令）

## 意图
“查看某端口是否被占用”

## 期望建议
- Linux：`ss -ltnp | grep :8000`
- macOS：`lsof -nP -iTCP:8000 -sTCP:LISTEN`
- Windows：`netstat -ano | findstr :8000`

## 期望校验
- 解析输出并在步骤面板中总结：是否占用、PID/进程名（能拿到则展示）
