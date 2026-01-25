# pip 安装慢（镜像源 / 超时）

适用场景：
- `pip install ...` 很慢或超时
- `Read timed out`

常见原因：
- 访问 PyPI 网络不稳定
- DNS/代理

步骤（最小可用）：

1) 临时使用镜像源（示例：清华）
- `pip install -i https://pypi.tuna.tsinghua.edu.cn/simple <pkg>`

2) 永久配置（可选）
- `pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple`

验证：
- 重新安装明显变快，且无超时

回滚：
- `pip config unset global.index-url`

关键词：
- pip install timeout
- pip mirror
- index-url
