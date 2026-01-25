# 命令找不到（PATH / which / where / Get-Command）

适用场景：
- Windows：`不是内部或外部命令`
- Linux/macOS：`command not found`

常见原因：
- 软件未安装
- 已安装但不在 PATH
- 运行环境不同（系统 python vs venv/conda）

步骤（Windows）：

1) 定位命令
- `where <cmd>`

2) 如果能找到路径
- 检查是否在 PATH

步骤（PowerShell）：

- `Get-Command <cmd>`

步骤（Linux/macOS）：

- `which <cmd>`

验证：
- 能输出可执行文件路径
- 再次运行命令不报错

回滚：
- 撤销 PATH 修改

关键词：
- command not found
- where
- which
- Get-Command
