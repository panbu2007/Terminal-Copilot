# Git 子命令拼写错误怎么处理

当 git 提示 “not a git command” 时，通常是子命令拼写错误或顺序不对。

建议：
- 使用最小修复：改正子命令拼写，例如 `git checkout <branch>`
- 如果分支不存在：先 `git branch` 或 `git branch -a` 查看可用分支
