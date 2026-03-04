# Docker 容器意外退出排查

适用场景：
- `docker ps` 看不到期望运行的容器
- `docker ps -a` 显示容器状态为 `Exited`
- 容器启动后立即退出（exit code 非 0）

常见原因：
- 容器内主进程退出或崩溃（exit code 反映崩溃原因）
- 启动命令/入口点（ENTRYPOINT/CMD）配置错误
- 依赖的环境变量、配置文件或挂载卷缺失
- 内存不足被 OOM Killer 终止（exit code 137）

步骤（最小可用）：

1) 查看所有容器（包括已退出的）
```bash
docker ps -a
# 关注 STATUS 列和 EXITED 后括号内的退出码
```

2) 查看容器退出日志
```bash
docker logs <container-id>
# 或通过容器名
docker logs <container-name>
# 查看最后 100 行
docker logs --tail 100 <container-name>
```

3) 查看容器详细信息（退出原因、OOMKill 等）
```bash
docker inspect <container-name> | grep -A10 '"State"'
```

4) 常见退出码含义
```bash
# exit code 0  — 正常退出（主进程任务完成）
# exit code 1  — 应用报错退出
# exit code 127 — 命令未找到（CMD 配置错误）
# exit code 137 — OOMKilled 或 docker stop 强制终止
# exit code 139 — Segfault（内存访问违规）
```

5) 重新运行容器并覆盖入口点调试
```bash
docker run -it --rm \
  --entrypoint /bin/sh \
  <image-name>
# 进入容器后手动运行启动命令排查
```

6) 检查环境变量是否传入
```bash
docker run --env-file .env <image-name>
# 或逐一指定
docker run -e DATABASE_URL=... <image-name>
```

验证：
```bash
# 容器正常运行，不再出现 Exited
docker ps
docker logs <container-name> | tail -20
```

回滚：
```bash
# 回滚到上一个正常镜像版本
docker stop <container-name>
docker run -d --name <container-name> <image-name>:<previous-tag>
```

注意事项：
- 容器日志在容器删除后会丢失，重要日志建议挂载到宿主机目录
- 使用 `docker run --restart=on-failure` 可让容器在非 0 退出时自动重启

关键词：
- docker container exited
- docker ps -a
- exit code 137
- docker logs
- container stopped unexpectedly
- docker inspect state
