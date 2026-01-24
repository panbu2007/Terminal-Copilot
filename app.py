from __future__ import annotations

import os

import uvicorn

# ModelScope 创空间通常会以 `python app.py` 启动。
# 统一在 0.0.0.0:7860 监听，兼容常见平台端口约定。


def main() -> None:
    os.environ.setdefault("TERMINAL_COPILOT_EXECUTOR", os.getenv("TERMINAL_COPILOT_EXECUTOR", "local"))
    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "7860")),
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
