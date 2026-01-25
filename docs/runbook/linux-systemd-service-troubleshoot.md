# systemd 服务排查（status / journalctl / restart）

适用场景：
- Linux 上服务启动失败/异常退出
- `systemctl restart <svc>` 后仍不可用

步骤（最小可用）：

1) 查看服务状态
- `sudo systemctl status <service> --no-pager`

2) 看最近日志（关键）
- `sudo journalctl -u <service> -n 200 --no-pager`

3) 修改配置后让其生效
- 如果改了 unit 文件：`sudo systemctl daemon-reload`
- 重启服务：`sudo systemctl restart <service>`

4) 再次验证
- `sudo systemctl status <service> --no-pager`

回滚：
- 恢复配置文件/ unit 文件到修改前内容
- `daemon-reload` + `restart`

关键词：
- systemctl status
- journalctl -u
- daemon-reload
