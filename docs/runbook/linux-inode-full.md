# Linux inode 耗尽排查（磁盘有空间但无法创建文件）

适用场景：
- `df -h` 显示磁盘有剩余空间，但仍报 `No space left on device`
- 无法创建新文件或目录
- 日志/应用写入失败

常见原因：
- 大量小文件（如日志碎片、缓存、session 文件）消耗了所有 inode
- inode 总数在格式化时固定，无法动态扩充（ext4）
- `/tmp` 或应用缓存目录积累了海量小文件

步骤（最小可用）：

1) 确认是 inode 耗尽而非磁盘空间不足
```bash
# 查看磁盘空间（-h 人类可读）
df -h
# 查看 inode 使用情况（-i 显示 inode）
df -i
# 关注 IUse% 列，接近 100% 即为 inode 耗尽
```

2) 找出 inode 消耗最多的目录
```bash
# 统计各目录下文件数量（从根开始，可能较慢）
sudo find / -xdev -printf '%h\n' | sort | uniq -c | sort -rn | head -20
# 针对可疑目录
sudo find /var/cache -xdev -printf '%h\n' | sort | uniq -c | sort -rn | head -20
```

3) 查看 inode 使用详情（按挂载点）
```bash
df -i /
df -i /var
df -i /tmp
```

4) 清理常见高 inode 消耗目录

```bash
# 清理 /tmp
sudo find /tmp -type f -atime +7 -delete
# 清理 journald 日志（日志小文件较多）
sudo journalctl --vacuum-files=10
sudo journalctl --vacuum-time=7d
# 清理 pip/apt 缓存
sudo pip cache purge
sudo apt clean
# 清理 Docker 无用层（如有）
docker system prune -f
```

5) 清理应用 session/缓存文件（按具体应用路径）
```bash
# 示例：PHP session 文件
sudo find /var/lib/php/sessions -type f -mtime +1 -delete
# 示例：旧日志文件
sudo find /var/log -name "*.log.*" -mtime +30 -delete
```

验证：
```bash
# 确认 inode 使用率下降
df -i
# 尝试创建测试文件
touch /tmp/inode_test && echo "inode OK" && rm /tmp/inode_test
```

注意事项：
- `find ... -delete` 是批量删除，执行前建议先去掉 `-delete` 参数预览文件列表
- inode 总数无法在线扩充（ext4 格式化时确定），根本解决需迁移数据并重新格式化或换用 xfs（支持动态 inode）

关键词：
- inode exhausted
- no space left on device inode
- df -i inode
- too many files small files
- find delete old files
- inode full linux
