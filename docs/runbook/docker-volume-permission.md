# Docker 挂载卷权限问题排查

适用场景：
- 容器内应用无法写入挂载的目录
- 报错 `Permission denied` 涉及 `/data`、`/var/lib` 等挂载路径
- 容器以非 root 用户运行时无法访问卷内文件

常见原因：
- 宿主机目录的 owner/mode 与容器内运行用户不匹配
- 容器内进程以非 root 用户（如 uid=1000）运行，但宿主目录 owner 为 root
- SELinux/AppArmor 标签阻止容器访问宿主目录

步骤（最小可用）：

1) 查看宿主机目录的权限
```bash
ls -la /host/path/to/volume
stat /host/path/to/volume
```

2) 确认容器内运行用户
```bash
docker exec <container-name> id
docker exec <container-name> whoami
```

3) 查看容器内挂载目录的权限
```bash
docker exec <container-name> ls -la /container/path
```

4) 方法一：修改宿主机目录 owner 匹配容器用户
```bash
# 若容器内 uid=1000
sudo chown -R 1000:1000 /host/path/to/volume
```

5) 方法二：修改宿主机目录权限（较宽松，适合开发环境）
```bash
sudo chmod -R 775 /host/path/to/volume
```

6) 方法三：在 docker run 时指定运行用户为 root（仅调试用）
```bash
docker run --user root <image-name>
```

7) SELinux 环境下添加 `:z` 或 `:Z` 标签
```bash
# :z 允许多个容器共享
docker run -v /host/path:/container/path:z <image-name>
# :Z 私有标签（仅当前容器）
docker run -v /host/path:/container/path:Z <image-name>
```

8) 通过 Dockerfile 在构建时创建目录并设置权限
```bash
# Dockerfile 示例片段
RUN mkdir -p /data && chown -R appuser:appuser /data
```

验证：
```bash
# 容器内成功写入文件
docker exec <container-name> touch /container/path/testfile
docker exec <container-name> ls -la /container/path/testfile
```

注意事项：
- 生产环境不建议直接使用 root 运行容器，应正确设置目录权限
- `chmod 777` 会引入安全风险，仅在本地开发环境使用

关键词：
- docker permission denied
- docker volume permission
- chown docker mount
- bind mount permission
- SELinux docker :z label
- container cannot write volume
