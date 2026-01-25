# Git：not a git repository

适用场景：
- `fatal: not a git repository (or any of the parent directories): .git`

常见原因：
- 当前目录不是仓库根目录
- 误在子目录/错误路径执行 git
- `.git` 被删除或未初始化

步骤（最小可用）：

1) 确认当前目录
- `pwd`（Linux/macOS）或 `cd`（Windows cmd）/ `Get-Location`（PowerShell）

2) 往上找仓库根目录
- 看是否存在 `.git` 目录

3) 如果你本来就要新建仓库
- `git init`

4) 如果你应该在某个已有仓库里
- `cd <repo>` 然后重试 `git status`

验证：
- `git status` 能正常输出分支与工作区状态

回滚：
- 如果误 `git init`，删除 `.git`（谨慎）

关键词：
- not a git repository
- git status
- git init
