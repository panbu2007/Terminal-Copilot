# Docker Compose 服务重启、发布与回滚

适用场景：
- 使用 Docker Compose 部署业务服务
- 需要更新镜像、重启服务、回滚到上一版本
- 需要判断问题在容器、镜像、环境变量还是网络

症状：
- `docker compose up -d` 后服务未恢复
- 新镜像发布后接口报错
- 容器不断重启
- 配置更新后没有生效

快速判断：

```bash
docker compose ps
docker compose logs --tail=200
docker compose config
```

修复步骤：

1. 发布前确认
- 当前镜像 tag
- `.env` 与 compose 文件是否已备份
- 回滚镜像 tag 是否明确

2. 拉取新镜像

```bash
docker compose pull
```

3. 重建并后台启动

```bash
docker compose up -d
```

4. 检查状态与日志

```bash
docker compose ps
docker compose logs --tail=200
```

5. 检查环境变量与渲染结果

```bash
docker compose config
```

6. 业务验证

```bash
curl -fsS http://127.0.0.1:PORT/health
```

回滚：
- 恢复上一版本镜像 tag 或 compose 文件

```bash
docker compose pull
docker compose up -d
```

- 若是配置导致问题，恢复旧 `.env` 后重新启动

验证：
- `docker compose ps` 全部 `Up`
- 关键接口健康检查通过
- 日志无持续报错或重启风暴

风险提示：
- 使用浮动 tag 会增加回滚难度
- 不要在未确认配置渲染结果前直接上线
- 数据库、队列等有状态容器要单独评估风险

关键词：
- docker compose restart
- docker compose deploy
- docker compose rollback
- docker compose logs
- compose up -d
- 容器发布
- 容器回滚
- compose 故障

