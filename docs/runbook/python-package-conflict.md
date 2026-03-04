# Python 包冲突/依赖问题

适用场景：
- `pip install` 报错 `ERROR: Cannot install ... because these package versions have conflicting dependencies`
- 安装包后其他包功能异常（版本被降级/升级）
- 不同项目需要同一包的不同版本

常见原因：
- 全局 Python 环境混用，不同项目的依赖互相覆盖
- `requirements.txt` 未固定版本导致依赖不稳定
- 包 A 要求 `lib>=1.0` 而包 B 要求 `lib<1.0`，直接冲突

步骤（最小可用）：

1) 查看冲突详情
```bash
pip check
# 列出所有依赖不满足的包
```

2) 使用虚拟环境隔离（最根本的解决方案）
```bash
# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate    # Linux/Mac
.venv\Scripts\activate       # Windows
# 安装依赖
pip install -r requirements.txt
```

3) 查看包依赖树（找出冲突链路）
```bash
pip install pipdeptree
pipdeptree
# 查看特定包的依赖树
pipdeptree --packages <package-name>
# 反向查找哪些包依赖了指定包
pipdeptree --reverse --packages <package-name>
```

4) 尝试让 pip 自动解析兼容版本
```bash
pip install "packageA" "packageB" --upgrade
# 或指定兼容的版本范围
pip install "packageA==1.2" "packageB>=2.0,<3.0"
```

5) 使用 pip-tools 固定依赖版本
```bash
pip install pip-tools
# 从 requirements.in（高级依赖）生成 requirements.txt（精确版本锁）
pip-compile requirements.in
pip-sync requirements.txt
```

6) 使用 conda 管理复杂依赖（数据科学场景）
```bash
conda create -n myenv python=3.11
conda activate myenv
conda install numpy pandas scikit-learn
# conda 的依赖解析比 pip 更强
```

7) 清理并重建虚拟环境
```bash
deactivate
rm -rf .venv
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

验证：
```bash
# 确认无依赖冲突
pip check
# 确认关键包可正常导入
python -c "import your_package; print('OK')"
```

注意事项：
- 永远不要在系统 Python 环境中随意 `pip install`，始终使用虚拟环境
- 生产环境部署时，`requirements.txt` 应锁定到精确版本号（如 `flask==3.0.0`）

关键词：
- pip package conflict
- conflicting dependencies
- pip check
- pipdeptree
- python venv virtual environment
- requirements.txt pinned version
- pip-tools pip-compile
