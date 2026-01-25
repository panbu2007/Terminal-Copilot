# Linux 磁盘满（No space left on device）排查与处理

适用场景：
- `No space left on device`
- 服务写日志/写文件失败
- Docker 拉镜像失败但错误提示与空间相关

常见原因：
- `/var/log` 日志膨胀
- Docker 镜像/容器层占满 `/var/lib/docker`
- 临时目录/缓存占用过大

步骤（只读优先）：

1) 看整体磁盘
- `df -h`

2) 找大目录（从根或指定挂载点）
- `sudo du -xh / --max-depth=2 | sort -h | tail -n 20`

3) 常见清理点（谨慎）
- 日志：`sudo journalctl --disk-usage`
- 清理旧日志（示例）：`sudo journalctl --vacuum-time=7d`
- Docker：`docker system df`
- Docker 清理（谨慎）：`docker system prune -af`（会删未使用资源）

验证：
- `df -h` 可用空间恢复
- 之前失败的写入/启动动作恢复正常

回滚：
- 清理操作一般不可逆；务必先确认目录/资源是否可删

关键词：
- no space left on device
- df -h du sort
- journalctl vacuum
- docker system prune
