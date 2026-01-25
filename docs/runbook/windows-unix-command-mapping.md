# Windows 命令对照（Unix/Linux 常见命令迁移）

适用场景：
- 在 Windows 的 cmd.exe / PowerShell 里照搬了 Linux/macOS 命令（如 `ls`、`cat`）导致报错。
- Terminal Copilot executor=local 在 Windows 默认通过 cmd 执行命令。

## 常见报错

- `'ls' 不是内部或外部命令，也不是可运行的程序或批处理文件。`
- `command not found`（Git Bash / WSL 环境之外）

## 快速结论

- **cmd.exe**：没有 `ls`，用 `dir`
- **PowerShell**：支持 `ls`（别名），也支持 `dir`
- **Git Bash / WSL**：支持 `ls`、`cat` 等 Unix 命令

## 对照表（高频）

| 你可能想输入 | cmd.exe 等价 | PowerShell 等价 | 说明 |
| --- | --- | --- | --- |
| `ls` | `dir` | `ls` / `dir` | 列出目录 |
| `pwd` | `cd` | `pwd` / `Get-Location` | 当前目录 |
| `cat file` | `type file` | `Get-Content file` | 查看文件 |
| `rm file` | `del file` | `Remove-Item file` | 删除文件 |
| `cp a b` | `copy a b` | `Copy-Item a b` | 复制 |
| `mv a b` | `move a b` | `Move-Item a b` | 移动/重命名 |
| `which git` | `where git` | `Get-Command git` | 查找命令 |

## 推荐做法（在 Terminal Copilot 里）

1) 如果你看到 “不是内部或外部命令”
- 先尝试 `where <命令>`（例如 `where ls`）确认命令是否存在。

2) 需要 Unix 命令生态
- 安装 Git Bash 后用 `where bash` 检查是否可用。

## 验证

- `dir` 能输出目录列表。
- `where <命令>` 能定位可执行文件路径（如果存在）。
