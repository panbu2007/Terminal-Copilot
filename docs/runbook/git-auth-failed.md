# Git：认证失败（Authentication failed / Permission denied）

适用场景：
- `Authentication failed`
- `Permission denied (publickey)`
- `fatal: could not read Username`

常见原因：
- HTTPS 需要 token/密码已过期
- SSH key 未配置或 agent 未加载
- remote URL 写错（https vs ssh）

步骤（最小可用）：

1) 查看 remote 地址
- `git remote -v`

2) 判断你要用 HTTPS 还是 SSH
- HTTPS：通常用 Personal Access Token
- SSH：需要本机有 key，并且 remote 使用 `git@...` 形式

3) 重新设置 remote（示例）
- HTTPS：`git remote set-url origin https://...`
- SSH：`git remote set-url origin git@github.com:ORG/REPO.git`

4) 再试一次
- `git fetch`

验证：
- `git fetch`/`git push` 不再报认证错误

回滚：
- 改回原 remote URL

关键词：
- Permission denied (publickey)
- Authentication failed
- git remote -v
