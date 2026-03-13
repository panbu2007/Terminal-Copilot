# Linux 用户、sudo 与权限审计

适用场景：
- 需要审计服务器上的高权限账号
- 需要确认某个服务账号或运维账号的 sudo 权限边界
- 需要减少“能跑但权限过大”的风险

症状：
- 普通账号拥有超预期 sudo 权限
- 服务账号可以访问不该访问的目录
- 排障中频繁使用 root，但没人能说明为什么

快速判断：

```bash
id USER
sudo -l -U USER
getent group sudo
getent group wheel
```

修复步骤：

1. 列出高权限账号
- root
- 有 sudo / wheel 权限的用户
- 能访问敏感目录或 systemd 管理命令的服务账号

2. 审计 sudo 规则
- 查看 `/etc/sudoers`
- 查看 `/etc/sudoers.d/`
- 核对是否存在过宽规则，例如 `NOPASSWD: ALL`

3. 审计目录权限
- 检查：
  - 应用目录
  - 日志目录
  - secrets 目录
  - 部署脚本

4. 收敛权限
- 尽量按命令、目录、服务粒度授权
- 服务账号与登录账号分离

回滚：
- 恢复上一个稳定 sudo 配置
- 修改前先备份 sudoers
- 使用 `visudo` 验证语法

验证：
- `sudo -l -U USER` 输出符合预期
- 普通账号不再拥有多余权限
- 业务服务仍可正常运行

风险提示：
- 修改 sudoers 前必须保留一个可回退会话
- 权限过大比“暂时不能用”风险更高
- 不要把敏感 secrets 目录暴露给通用账号

关键词：
- sudo audit
- sudoers
- linux permission audit
- least privilege
- wheel group
- sudo -l
- 权限审计
- 最小权限

