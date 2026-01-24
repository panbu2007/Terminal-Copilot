# systemctl 常用步骤（工作流）

当你修改了与 systemd 管理的服务相关的配置或 unit 文件，常见的安全顺序是：

- `systemctl daemon-reload`：让 systemd 重新加载配置/单元文件
- `systemctl restart <service>`：重启服务使新配置生效
- `systemctl status <service>`：查看服务状态与最近日志

提示：重启服务可能影响在线业务，建议在确认窗口/维护期执行。
