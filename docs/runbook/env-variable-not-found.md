# 环境变量未设置/找不到排查

适用场景：
- 应用启动时报错 `KeyError: 'DATABASE_URL'`（Python）
- `process.env.API_KEY is undefined`（Node.js）
- Shell 中 `echo $MY_VAR` 输出为空
- 程序在某环境运行正常，在另一环境报错

常见原因：
- 环境变量只在当前 shell 设置，子进程或其他会话不可见
- `.env` 文件未加载（未使用 python-dotenv / dotenv 库）
- systemd 服务未配置 `EnvironmentFile`
- Docker 容器未通过 `-e` 或 `--env-file` 传入变量

步骤（最小可用）：

1) 确认环境变量是否存在
```bash
echo $MY_VARIABLE
printenv MY_VARIABLE
# 或查看所有环境变量
env | grep MY_VARIABLE
```

2) 临时设置环境变量（当前 shell 会话）
```bash
export DATABASE_URL="postgresql://user:pass@localhost/db"
# 验证
echo $DATABASE_URL
```

3) 永久设置环境变量（用户级）
```bash
# 追加到 ~/.bashrc 或 ~/.zshrc
echo 'export DATABASE_URL="postgresql://user:pass@localhost/db"' >> ~/.bashrc
source ~/.bashrc
```

4) 永久设置系统级环境变量
```bash
# 写入 /etc/environment（所有用户，不支持 Shell 语法）
sudo vim /etc/environment
# 格式：KEY="VALUE"（无 export 关键字）
# 重新登录后生效
```

5) 使用 .env 文件（Python 项目）
```bash
# 安装 python-dotenv
pip install python-dotenv
# 在代码入口处加载
# from dotenv import load_dotenv
# load_dotenv()
# 创建 .env 文件（不要提交到 git！）
cat > .env << 'EOF'
DATABASE_URL=postgresql://user:pass@localhost/db
API_KEY=your-secret-key
EOF
# 将 .env 加入 .gitignore
echo ".env" >> .gitignore
```

6) 为 systemd 服务配置环境变量
```bash
sudo systemctl edit myapp.service
# 在 [Service] 段添加：
# Environment="DATABASE_URL=postgresql://user:pass@localhost/db"
# 或使用文件方式：
# EnvironmentFile=/etc/myapp/env
sudo systemctl daemon-reload
sudo systemctl restart myapp
```

7) Docker 容器传入环境变量
```bash
# 单个变量
docker run -e DATABASE_URL="postgresql://..." myapp
# 从文件批量传入
docker run --env-file .env myapp
```

8) 检查变量作用域（注意 export 的必要性）
```bash
MY_VAR="hello"
# 此时子进程无法看到 MY_VAR，需要 export
export MY_VAR="hello"
# 验证子进程可见
bash -c 'echo $MY_VAR'
```

验证：
```bash
# 确认变量已正确设置
printenv MY_VARIABLE
# 应用不再报变量未找到的错误
python -c "import os; print(os.environ['MY_VARIABLE'])"
```

注意事项：
- `.env` 文件包含敏感信息（密钥、密码），务必加入 `.gitignore`，绝不提交到代码仓库
- `export` 之后变量才对子进程可见；直接 `KEY=VALUE` 赋值仅在当前 shell 有效

关键词：
- environment variable not found
- KeyError environment variable
- export variable bash
- .env file dotenv
- printenv
- EnvironmentFile systemd
- process.env undefined
