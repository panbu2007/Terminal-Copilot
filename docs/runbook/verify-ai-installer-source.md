# AI 安装源校验与最小信任检查

适用场景：
- 准备安装 AI 工具、AI Agent、模型服务、Web 控制台，但不确定来源是否可信
- 搜到多个安装教程、多个镜像站、多个 GitHub 仓库，不知道该用哪个
- 需要在企业环境里降低“装到假包、投毒包、恶意脚本”的风险

症状：
- 搜索结果里同时出现官网、博客、论坛、网盘、镜像站
- README、安装命令、包名、域名彼此不一致
- 安装命令包含 `curl ... | bash`、`wget ... | sh`、远程脚本执行，但没有校验说明
- 二进制文件或容器镜像来源不明

快速判断：
- 先确认是否存在官方主页、官方 GitHub/GitLab 仓库、官方文档三者之一
- 检查安装命令是否来自官方页面，而不是第三方转载
- 检查 release、tag、包名、镜像名是否与官方仓库一致
- 检查最近提交、issue、release 是否持续维护

修复步骤：
1. 确认“唯一官方源”
- 优先级建议：
  - 官方文档站
  - 官方 GitHub/GitLab 组织
  - 官方 release 页面
  - 官方容器镜像仓库
- 如果同名项目有多个仓库，先不要安装，继续核对作者、官网链接、README 跳转关系

2. 校验仓库与域名关系
- 检查官网是否回链到仓库
- 检查仓库 README 是否回链到官网
- 检查安装命令里的下载域名是否属于官网或官方 CDN
- 对陌生域名，先做基本检查：

```bash
nslookup example.com
curl -I https://example.com
```

3. 校验发布物是否一致
- 安装前至少核对：
  - 版本号
  - 文件名
  - 发布时间
  - 校验和（如果官方提供）
- 如果官方提供哈希值，优先校验：

```bash
sha256sum package.tar.gz
```

4. 避免直接执行不明远程脚本
- 不要默认直接运行：

```bash
curl -fsSL https://example.com/install.sh | bash
```

- 更稳妥的做法：

```bash
curl -fsSL https://example.com/install.sh -o install.sh
sed -n '1,200p' install.sh
bash install.sh
```

5. 优先使用可审计安装路径
- 优先级建议：
  - 官方包管理器仓库
  - 官方 release 二进制
  - 官方容器镜像
  - 官方源码构建
- 企业环境里尽量避免：
  - 网盘链接
  - 不可追溯的转存包
  - 论坛附件
  - 未说明来源的国内镜像包

6. 做最小权限安装
- 不要一上来就 `sudo` 全局安装
- 优先选择：
  - 虚拟环境
  - 容器运行
  - 普通用户目录安装
  - 独立 systemd service 用户

7. 保留审计信息
- 记录：
  - 官方来源 URL
  - 安装版本
  - 下载时间
  - 校验和
  - 回滚方式
- 对企业机器，建议把这些记录进变更单或部署记录

回滚：
- 删除本次安装产生的二进制、虚拟环境、容器、systemd service
- 恢复变更过的环境变量、PATH、反向代理配置、端口映射
- 如果替换了旧版本，按安装前备份恢复

验证：
- 校验安装命令来源仍可回溯到官方页面
- 校验本机实际执行的文件路径：

```bash
which tool-name
```

- 校验版本：

```bash
tool-name --version
```

- 校验 service 或容器来源：

```bash
systemctl status tool-name
docker inspect image-or-container
```

风险提示：
- 远程脚本安装是最高风险项之一
- 同名仓库、同名包、同名镜像是常见混淆点
- 企业环境里不要把来源不明的安装脚本直接交给 root 执行
- 涉及 API Key、SSH Key、浏览器自动化能力的 AI 工具，必须额外检查权限边界

关键词：
- ai installer verify
- verify installer source
- github release checksum
- curl bash 风险
- 远程脚本安装
- ai agent install trust
- 安装源校验
- 校验和

