from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class Verification:
    title: str
    ok: bool
    detail: str


def maybe_verify(*, command: str, exit_code: int, stdout: str, stderr: str) -> Verification | None:
    cmd = command.strip()
    out = stdout or ""

    # Docker mirror verification
    if cmd == "docker info":
        m = re.search(r"Registry Mirrors:\s*(.+)", out, flags=re.IGNORECASE | re.DOTALL)
        if m and re.search(r"https?://", m.group(1)):
            return Verification(title="校验：镜像源已配置", ok=True, detail="检测到 Registry Mirrors 配置。")
        return Verification(title="校验：镜像源未生效", ok=False, detail="未检测到 Registry Mirrors（或输出不包含 URL）。")

    # Git checkout verification
    if cmd.startswith("git checkout"):
        ok = exit_code == 0
        detail = "分支切换成功。" if ok else (stderr.strip() or "分支切换失败。")
        return Verification(title="校验：git checkout", ok=ok, detail=detail)

    # Port check verification (demo: 8000)
    if ("8000" in cmd) and (cmd.startswith("netstat") or cmd.startswith("ss") or cmd.startswith("lsof")):
        if "8000" in out and re.search(r"LISTEN|LISTENING", out, flags=re.IGNORECASE):
            pid = None
            m = re.search(r"pid[= :](\d+)", out, flags=re.IGNORECASE)
            if m:
                pid = m.group(1)
            return Verification(
                title="校验：端口占用",
                ok=True,
                detail=f"检测到 8000 处于 LISTEN。{(' PID=' + pid) if pid else ''}",
            )
        return Verification(title="校验：端口占用", ok=False, detail="未检测到 8000 LISTEN 记录。")

    return None
