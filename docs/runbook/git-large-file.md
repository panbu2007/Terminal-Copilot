# Git 大文件/LFS 问题处理

适用场景：
- `git push` 报错 `File xxx exceeds GitHub's file size limit of 100 MB`
- 仓库体积异常大，clone 极慢
- 需要版本管理大型二进制文件（模型权重、视频、数据集）

常见原因：
- 误将大文件（模型文件、压缩包、数据库备份）提交到 Git 历史
- 未使用 Git LFS（Large File Storage）管理二进制文件
- 即使删除文件，Git 历史中仍保留导致仓库膨胀

步骤（最小可用）：

### 方法一：使用 Git LFS 管理大文件

```bash
# 安装 Git LFS（Ubuntu/Debian）
sudo apt install -y git-lfs
# Mac
brew install git-lfs

# 初始化 LFS（仓库内执行一次）
git lfs install

# 追踪指定类型的大文件
git lfs track "*.pth"       # 模型权重
git lfs track "*.zip"       # 压缩包
git lfs track "*.bin"
git lfs track "*.h5"

# 确认 .gitattributes 已更新
cat .gitattributes

# 正常 add / commit / push
git add .gitattributes
git add large_model.pth
git commit -m "add model via LFS"
git push
```

### 方法二：从 Git 历史中彻底删除大文件

```bash
# 安装 git-filter-repo（推荐，比 BFG 更安全）
pip install git-filter-repo
# 或
sudo apt install -y git-filter-repo

# 从所有历史中删除指定文件
git filter-repo --path large_file.zip --invert-paths

# 强制推送（会修改历史，需团队协调）
git push origin --force --all
git push origin --force --tags
```

### 方法三：使用 BFG Repo Cleaner 清理历史

```bash
# 下载 BFG jar（Java 环境需可用）
wget https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar

# 删除所有超过 50MB 的文件
java -jar bfg-1.14.0.jar --strip-blobs-bigger-than 50M

# 清理并回收空间
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

4) 将大文件加入 .gitignore 防止再次误提交
```bash
echo "*.pth" >> .gitignore
echo "*.bin" >> .gitignore
echo "data/" >> .gitignore
git add .gitignore
git commit -m "chore: ignore large files"
```

验证：
```bash
# 确认仓库大小减小
git count-objects -vH
# 确认 LFS 文件正确追踪
git lfs ls-files
```

注意事项：
- `git filter-repo` 会重写历史；团队协作时所有人需重新 clone，务必提前沟通
- LFS 需要远端仓库支持（GitHub、GitLab 都支持，但有容量限制）

关键词：
- git large file size limit
- git-lfs
- git filter-repo remove file history
- BFG repo cleaner
- file exceeds github limit
- git repository too large
- gitattributes lfs track
