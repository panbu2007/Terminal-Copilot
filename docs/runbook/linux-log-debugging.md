# Linux 日志排查（tail / journalctl）

适用场景：
- 服务“看起来启动了但不可用”
- 启动失败需要定位错误栈
- 需要快速从日志里提取关键线索

步骤（最小可用）：

1) 进程型/文件日志（常见）
- `tail -n 200 -f /path/to/app.log`

2) systemd 管理的服务（强推荐）
- `sudo journalctl -u <service> -n 200 --no-pager`
- 持续跟随：`sudo journalctl -u <service> -f`

3) 用 grep 提取关键字
- `sudo journalctl -u <service> --no-pager | grep -i "error\|exception\|failed" | tail -n 50`

验证：
- 能定位到具体报错（配置路径、端口、权限、依赖缺失）

回滚：
- 无（只读排查）

关键词：
- journalctl -u
- tail -f
- grep error exception
