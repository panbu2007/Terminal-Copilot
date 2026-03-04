# Git 合并冲突解决

适用场景：
- `git merge` 或 `git pull` 后出现 `CONFLICT` 提示
- `git rebase` 过程中暂停等待解决冲突
- 文件中出现 `<<<<<<< HEAD` / `=======` / `>>>>>>>` 标记

常见原因：
- 两个分支对同一文件的同一区域做了不同修改
- `git pull` 时本地未提交的修改与远端修改冲突

步骤（最小可用）：

1) 查看冲突文件列表
```bash
git status
# 冲突文件显示为 "both modified"
```

2) 查看冲突内容
```bash
git diff
# 或直接打开冲突文件查看标记
cat <conflicted-file>
```

3) 理解冲突标记含义
```bash
# <<<<<<< HEAD        ← 当前分支（你的）的内容
# 你的修改
# =======             ← 分隔线
# 对方的修改
# >>>>>>> feature-xxx ← 被合并分支的内容
```

4) 手动编辑解决冲突
```bash
# 用编辑器打开冲突文件，选择保留哪方内容，或合并两者
# 删除所有 <<<<<<<、=======、>>>>>>> 标记行
vim <conflicted-file>
```

5) 使用 git mergetool（图形化三路合并）
```bash
# 配置 mergetool（示例：vimdiff）
git config --global merge.tool vimdiff
git mergetool
# 常用工具：vimdiff, meld, kdiff3, VS Code
```

6) 使用 VS Code 解决冲突（推荐）
```bash
code <conflicted-file>
# VS Code 会高亮冲突区域，提供 "Accept Current" / "Accept Incoming" / "Accept Both" 按钮
```

7) 标记冲突已解决并提交
```bash
# 解决所有冲突后
git add <conflicted-file>
# 确认所有冲突都已解决
git status
# 提交合并
git commit
# 如果是 rebase，继续
git rebase --continue
```

8) 放弃合并/rebase（恢复冲突前状态）
```bash
# 放弃 merge
git merge --abort
# 放弃 rebase
git rebase --abort
```

验证：
```bash
# 确认无冲突标记残留
grep -r "<<<<<<< HEAD" .
git status   # 应显示 "nothing to commit"
```

注意事项：
- 解决冲突后务必检查文件逻辑是否正确，冲突工具只能帮你合并文本，不保证语义正确
- 频繁同步（`git fetch && git rebase`）可以减少大量积累的冲突

关键词：
- git merge conflict
- CONFLICT both modified
- git mergetool
- git rebase conflict
- <<<<<<< HEAD ======= >>>>>>>
- git merge --abort
- resolve git conflict
