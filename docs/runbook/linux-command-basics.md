# Linux 常用命令速查（适合生产环境）

适用场景：
- 最终运行环境是 Linux（比赛部署/容器/服务器）
- 需要用最小、安全、可回滚的命令完成排查与修复

## 原则（推荐）

- 先只读：`ls`/`cat`/`tail`/`grep`/`ss`/`systemctl status`
- 再改动：改配置→reload/restart→验证
- 改动要可回滚：修改前备份文件或记录差异

## 高频命令

- 查看目录：`ls -al`
- 当前目录：`pwd`
- 查看文件：`cat file` / `sed -n '1,120p' file`
- 持续看日志：`tail -n 200 -f /var/log/syslog`
- 搜索关键字：`grep -n "keyword" -n file`
- 查端口：`ss -ltnp | grep :8000`
- 查进程：`ps aux | grep <name>`

## 常见报错与最小处理

- `Permission denied`
  - 先确认是否需要 root：尝试 `sudo <cmd>`（谨慎）
  - 文件权限：`ls -l` 看 owner/perm

- `command not found`
  - `which <cmd>`
  - Debian/Ubuntu：`apt-cache search <cmd>`（或根据报错安装对应包）

## 验证

- 改动后用只读命令验证：服务状态、端口监听、关键输出是否符合预期

关键词：
- linux command basics
- tail -f grep ss systemctl
