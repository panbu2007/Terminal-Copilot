# systemd 服务发布、重启与回滚

适用场景：
- 修改了服务代码、环境变量、启动命令或 unit 文件
- 需要标准化执行发布、重启、验证和回滚
- 需要排查服务启动失败、自动重启失败或配置未生效

症状：
- `systemctl restart` 后服务未起来
- 修改了 unit 文件但行为没有变化
- 进程起来后马上退出
- 环境变量、工作目录或 ExecStart 没生效

快速判断：

```bash
systemctl status service-name --no-pager
journalctl -u service-name -n 200 --no-pager
systemctl cat service-name
```

修复步骤：

1. 发布前确认
- 当前分支、版本、提交号
- 回滚目标版本
- 配置文件备份
- 依赖和虚拟环境状态

2. 如果修改了 unit 文件或 drop-in

```bash
systemctl daemon-reload
```

3. 重启服务

```bash
systemctl restart service-name
```

4. 检查状态和日志

```bash
systemctl status service-name --no-pager
journalctl -u service-name -n 200 --no-pager
```

5. 做业务健康检查

```bash
curl -fsS http://127.0.0.1:PORT/health
```

6. 如果服务依赖环境变量
- 检查 unit 文件中的 `Environment=`、`EnvironmentFile=`
- 检查工作目录、用户和权限

```bash
systemctl show -p Environment service-name
systemctl show -p User service-name
systemctl show -p WorkingDirectory service-name
```

回滚：

1. 切回上一个稳定版本
2. 恢复旧配置或旧 unit 文件
3. 执行：

```bash
systemctl daemon-reload
systemctl restart service-name
```

4. 再次执行健康检查

验证：
- `systemctl status` 显示 `active (running)`
- `journalctl` 无连续报错或重启风暴
- 健康检查通过
- 端口监听正常

风险提示：
- 修改 unit 文件后忘记 `daemon-reload` 是高频问题
- 不要在没有回滚点时直接替换线上配置
- 若服务携带数据库迁移，请先确认迁移是否可逆

关键词：
- systemd deploy
- systemctl restart
- daemon-reload
- systemd rollback
- service unit
- journalctl
- service 启动失败
- systemd 发布

