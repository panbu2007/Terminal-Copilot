# Python venv / uvicorn 常见问题

适用场景：
- 运行 `python -m uvicorn ...` 报 `No module named uvicorn`
- FastAPI/uvicorn 安装到了另一个 Python 环境里（例如 Anaconda vs venv）

## 常见原因

- VS Code 选的解释器和你在终端里跑的 `python` 不是同一个。
- 依赖安装在全局/conda 环境，运行却用系统 python。

## 推荐步骤（最小可用）

1) 使用项目解释器安装依赖

- `python -m pip install -r backend/requirements.txt`

2) 启动服务

- `python -m uvicorn backend.app.main:app --reload --port 8000`

## 验证

- 能访问：`http://localhost:8000/api/health`
- 终端出现：`Uvicorn running on http://127.0.0.1:8000`

## 提示

- 如果你用 VS Code Task 启动，建议 Task 使用 `${config:python.defaultInterpreterPath}`，避免跑到错误的 python。
