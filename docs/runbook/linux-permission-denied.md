# Linux 权限问题（Permission denied）最小排查

适用场景：
- 读/写/执行文件时报 `Permission denied`
- 修改配置文件、启动服务、绑定端口失败

常见原因：
- 需要 root 权限（例如写 `/etc/*`、管理 systemd）
- 文件/目录权限不对
- SELinux/AppArmor（比赛环境一般少见，但生产可能有）

步骤（最小可用）：

1) 看当前用户
- `id`

2) 看文件权限与属主
- `ls -l <path>`
- 目录还要看执行权限（进入目录需要 `x`）

3) 如果是系统管理类操作
- 尝试 `sudo <cmd>`（谨慎）

4) 如果是端口绑定（<1024）
- 需要 root 或提升能力；比赛一般建议改用 >1024 端口

验证：
- 重试原命令成功

回滚：
- 如果改了权限/属主，记录原值并可用 `chmod`/`chown` 恢复

关键词：
- Permission denied
- ls -l id sudo
- chmod chown
