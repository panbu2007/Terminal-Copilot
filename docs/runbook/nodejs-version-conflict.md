# Node.js 版本冲突排查（nvm 使用）

适用场景：
- 不同项目需要不同版本的 Node.js
- 全局安装的 Node.js 与项目要求版本不匹配
- 报错 `The engine "node" is incompatible with this module`
- `npm` 或 `yarn` 安装依赖时因 Node 版本报错

常见原因：
- 系统只安装了单一 Node.js 版本，无法多版本共存
- 未使用版本管理器（nvm），项目间版本切换困难
- `.nvmrc` 文件未被自动加载

步骤（最小可用）：

1) 查看当前 Node.js 和 npm 版本
```bash
node --version
npm --version
which node
```

2) 安装 nvm（Node Version Manager）
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# 或使用镜像（国内）
curl -o- https://gitee.com/mirrors/nvm/raw/v0.39.7/install.sh | bash
# 加载 nvm（或重启 shell）
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
```

3) 查看已安装的 Node 版本
```bash
nvm list
nvm list-remote   # 查看可安装的远程版本
```

4) 安装指定版本的 Node.js
```bash
nvm install 18        # 安装 Node 18 最新版
nvm install 20.11.0   # 安装指定版本
nvm install --lts     # 安装最新 LTS 版本
```

5) 切换 Node.js 版本
```bash
nvm use 18            # 切换到 Node 18
nvm use --lts         # 切换到 LTS 版本
nvm use               # 自动读取当前目录 .nvmrc
```

6) 设置默认 Node.js 版本
```bash
nvm alias default 18
nvm alias default node   # 指向最新版
```

7) 为项目固定 Node.js 版本（创建 .nvmrc）
```bash
# 在项目根目录创建 .nvmrc
echo "18" > .nvmrc
# 之后在该目录执行 nvm use 即可自动切换
nvm use
```

8) 查看并切换 npm 版本
```bash
npm --version
npm install -g npm@10   # 升级到指定版本
```

验证：
```bash
node --version
npm --version
# 确认项目依赖可正常安装
npm install
```

注意事项：
- `nvm` 安装后需重启 shell 或手动 `source ~/.bashrc` 才能使用
- 通过系统包管理器（apt/yum）安装的 Node 与 nvm 管理的 Node 相互独立，建议统一用 nvm 管理

关键词：
- nvm node version manager
- node version conflict
- nvm install use
- .nvmrc
- node engine incompatible
- switch node version
- npm version mismatch
