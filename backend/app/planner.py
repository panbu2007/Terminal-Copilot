from __future__ import annotations

import os
import re

from .models import Citation, CommandSuggestion, RiskLevel, SuggestRequest
from .rag import retrieve


def _cit(title: str, snippet: str) -> Citation:
    return Citation(title=title, snippet=snippet)


def suggest(req: SuggestRequest) -> list[CommandSuggestion]:
    last = (req.last_command or "").strip()
    stdout = req.last_stdout or ""
    stderr = req.last_stderr or ""

    suggestions: list[CommandSuggestion] = []

    last_lower = last.lower()

    # Natural language intent triggers
    if ("docker" in last_lower and ("换源" in last or "镜像" in last or "mirror" in last_lower)):
        suggestions.extend(
            [
                CommandSuggestion(
                    id="edit-daemon",
                    title="打开 Docker 配置文件",
                    command="sudo vim /etc/docker/daemon.json",
                    explanation="在 Linux 上编辑 daemon.json 来配置 Registry Mirrors。",
                    risk_level=RiskLevel.safe,
                ),
                CommandSuggestion(
                    id="daemon-reload-intent",
                    title="重新加载 systemd 配置",
                    command="sudo systemctl daemon-reload",
                    explanation="修改服务配置后，先让 systemd 重新加载单元文件。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("systemctl daemon-reload"),
                ),
                CommandSuggestion(
                    id="restart-docker-intent",
                    title="重启 Docker 服务",
                    command="sudo systemctl restart docker",
                    explanation="修改配置后重启 Docker 生效（可能影响正在运行的容器）。",
                    risk_level=RiskLevel.warn,
                    requires_confirmation=True,
                    citations=retrieve("systemctl restart docker"),
                ),
                CommandSuggestion(
                    id="verify-docker-intent",
                    title="验证镜像源是否生效",
                    command="docker info",
                    explanation="查看 Registry Mirrors 字段确认生效。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("docker info Registry Mirrors"),
                ),
            ]
        )

    if ("8000" in last_lower) and ("端口" in last or "port" in last_lower):
        # Provide platform-specific command
        if req.platform == "windows":
            suggestions.append(
                CommandSuggestion(
                    id="intent-port-windows",
                    title="Windows 查看 8000 端口占用",
                    command="netstat -ano | findstr :8000",
                    explanation="查看端口占用与 PID。",
                    risk_level=RiskLevel.safe,
                )
            )
        elif req.platform == "mac":
            suggestions.append(
                CommandSuggestion(
                    id="intent-port-mac",
                    title="macOS 查看 8000 端口占用",
                    command="lsof -nP -iTCP:8000 -sTCP:LISTEN",
                    explanation="查看端口占用。",
                    risk_level=RiskLevel.safe,
                )
            )
        else:
            suggestions.append(
                CommandSuggestion(
                    id="intent-port-linux",
                    title="Linux 查看 8000 端口占用",
                    command="ss -ltnp | grep :8000",
                    explanation="查看端口占用与进程信息。",
                    risk_level=RiskLevel.safe,
                )
            )

    # Demo1: Docker mirror workflow trigger (editing daemon.json)
    if re.search(r"\b(vim|vi|nano|notepad)\b", last) and "daemon.json" in last:
        suggestions.extend(
            [
                CommandSuggestion(
                    id="daemon-reload",
                    title="重新加载 systemd 配置",
                    command="sudo systemctl daemon-reload",
                    explanation="修改服务配置后，先让 systemd 重新加载单元文件。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("systemctl daemon-reload"),
                ),
                CommandSuggestion(
                    id="restart-docker",
                    title="重启 Docker 服务",
                    command="sudo systemctl restart docker",
                    explanation="让 Docker 重新读取 daemon.json（会影响正在运行的容器）。",
                    risk_level=RiskLevel.warn,
                    requires_confirmation=True,
                    tags=["service"],
                    citations=retrieve("systemctl restart docker"),
                ),
                CommandSuggestion(
                    id="verify-docker",
                    title="验证镜像源是否生效",
                    command="docker info",
                    explanation="查看 Registry Mirrors 字段，确认镜像源已生效。",
                    risk_level=RiskLevel.safe,
                    tags=["verify"],
                    citations=retrieve("docker info Registry Mirrors"),
                ),
            ]
        )

    # Demo1: workflow continuation based on actions
    if last == "sudo systemctl daemon-reload":
        suggestions.append(
            CommandSuggestion(
                id="restart-docker-after-reload",
                title="下一步：重启 Docker 服务",
                command="sudo systemctl restart docker",
                explanation="daemon-reload 完成后，重启 Docker 让配置生效。",
                risk_level=RiskLevel.warn,
                requires_confirmation=True,
                citations=retrieve("systemctl restart docker"),
            )
        )

    if last == "sudo systemctl restart docker" and (req.last_exit_code == 0):
        suggestions.append(
            CommandSuggestion(
                id="verify-docker-after-restart",
                title="下一步：验证镜像源是否生效",
                command="docker info",
                explanation="重启完成后，查看 Registry Mirrors 字段确认生效。",
                risk_level=RiskLevel.safe,
                tags=["verify"],
                citations=retrieve("docker info Registry Mirrors"),
            )
        )

    # Demo2: git typo
    if last.startswith("git ") and ("chekcout" in last or "checkot" in last):
        suggestions.append(
            CommandSuggestion(
                id="fix-git-checkout",
                title="修复拼写：checkout",
                command=last.replace("chekcout", "checkout").replace("checkot", "checkout"),
                explanation="git 子命令拼写错误，给出最小修复命令。",
                risk_level=RiskLevel.safe,
                citations=retrieve("git not a git command checkout"),
            )
        )

    # Demo2: natural language trigger
    if ("git" in last_lower) and ("拼写" in last or "typo" in last_lower or "not a git command" in last_lower):
        suggestions.extend(
            [
                CommandSuggestion(
                    id="git-status",
                    title="查看当前仓库状态",
                    command="git status",
                    explanation="先确认当前目录是 git 仓库，并查看当前分支/未提交变更。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("git status"),
                ),
                CommandSuggestion(
                    id="git-branch-list",
                    title="查看分支列表（辅助定位）",
                    command="git branch",
                    explanation="如果 checkout 失败，先确认分支名是否存在。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("git branch 分支 列表"),
                ),
            ]
        )

        if ("checkout" in last_lower) or ("chekcout" in last_lower) or ("checkot" in last_lower) or re.search(
            r"\bgit\s+che\w+\b", last_lower
        ):
            suggestions.append(
                CommandSuggestion(
                    id="git-typo-fix-from-nl",
                    title="根据输入修复为 checkout",
                    command="git checkout main",
                    explanation="检测到可能是 checkout 拼写错误，给出最可能的修复命令。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("git checkout"),
                )
            )

    # Demo2: git error output trigger
    if ("not a git command" in stderr.lower()) and last.startswith("git ") and not any(
        s.id.startswith("fix-git") for s in suggestions
    ):
        # Best-effort: if user typed something close to checkout
        if re.search(r"\bgit\s+che\w+\b", last):
            suggestions.append(
                CommandSuggestion(
                    id="fix-git-closest-checkout",
                    title="可能想输入：git checkout",
                    command=re.sub(r"\bgit\s+\S+", "git checkout", last, count=1),
                    explanation="根据错误输出推断子命令拼写错误，给出最可能的修复。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("git not a git command"),
                )
            )

    # Demo3: port check intent
    if (
        re.search(r"\b8000\b", last)
        and (
            ("netstat" in last)
            or ("ss " in last)
            or ("lsof" in last)
            or re.search(r"\b(port|listen|listening|bind|占用|监听|端口)\b", last.lower())
        )
    ):
        suggestions.append(
            CommandSuggestion(
                id="summarize-port",
                title="总结端口占用信息",
                command="(auto)",
                explanation="已检测到端口检查命令，可在右侧面板总结是否占用与 PID。",
                risk_level=RiskLevel.safe,
                tags=["analysis"],
            )
        )

    # Generic: when command failed
    # Optional LLM fallback (ModelScope API-Inference, OpenAI-compatible)
    llm_flag = os.getenv("TERMINAL_COPILOT_LLM_ENABLED", "auto").strip().lower()
    llm_enabled = llm_flag in {"1", "true", "yes", "on"}

    if llm_flag == "auto":
        try:
            from .llm.modelscope_client import modelscope_is_configured

            llm_enabled = modelscope_is_configured()
        except Exception:
            llm_enabled = False

    # If rules didn't produce any suggestions, fall back to LLM directly.
    # (No longer gated by "natural-language" heuristics.)
    if not suggestions and llm_enabled and last:
        try:
            from .llm.modelscope_client import modelscope_chat_json_suggestions

            items = modelscope_chat_json_suggestions(
                user_intent=last,
                platform=req.platform,
                last_stdout=stdout,
                last_stderr=stderr,
            )
            for i, it in enumerate(items[:5]):
                suggestions.append(
                    CommandSuggestion(
                        id=f"llm-{i}",
                        title=it["title"],
                        command=it["command"],
                        explanation=it.get("explanation", ""),
                        risk_level=RiskLevel.safe,
                        tags=["llm"],
                    )
                )
        except Exception as e:
            suggestions.append(
                CommandSuggestion(
                    id="llm-fallback",
                    title="LLM 不可用（已回退规则）",
                    command="(auto)",
                    explanation=f"ModelScope 调用失败：{str(e)[:200]}",
                    risk_level=RiskLevel.safe,
                    tags=["llm", "error"],
                )
            )

    # Generic: when command failed — only add `--help` if we still have no actionable suggestions.
    if req.last_exit_code is not None and req.last_exit_code != 0:
        has_actionable = any((s.command or "").strip() and s.command != "(auto)" for s in suggestions)
        if not has_actionable and last:
            suggestions.append(
                CommandSuggestion(
                    id="show-help",
                    title="查看帮助/用法",
                    command=f"{last} --help",
                    explanation="命令失败时可先查看用法与可用参数（LLM 无可执行建议时自动补充）。",
                    risk_level=RiskLevel.safe,
                    tags=["fallback"],
                )
            )

    # Cross-platform intent suggestion (MVP)
    if req.platform and "8000" in last and not any(s.id == "summarize-port" for s in suggestions):
        if req.platform == "windows":
            suggestions.append(
                CommandSuggestion(
                    id="port-windows",
                    title="Windows 查看 8000 端口占用",
                    command="netstat -ano | findstr :8000",
                    explanation="在 Windows 上查看端口占用与 PID。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("Windows netstat 8000 端口 占用"),
                )
            )
        elif req.platform == "linux":
            suggestions.append(
                CommandSuggestion(
                    id="port-linux",
                    title="Linux 查看 8000 端口占用",
                    command="ss -ltnp | grep :8000",
                    explanation="在 Linux 上查看端口占用与进程信息。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("Linux ss 8000 端口 占用"),
                )
            )
        elif req.platform == "mac":
            suggestions.append(
                CommandSuggestion(
                    id="port-mac",
                    title="macOS 查看 8000 端口占用",
                    command="lsof -nP -iTCP:8000 -sTCP:LISTEN",
                    explanation="在 macOS 上查看端口占用。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("macOS lsof 8000 端口 占用"),
                )
            )

    # Keep order, but avoid duplicates by id
    uniq: list[CommandSuggestion] = []
    seen = set()
    for s in suggestions:
        if s.id in seen:
            continue
        uniq.append(s)
        seen.add(s.id)

    # Attach lightweight RAG citations from local runbook
    for s in uniq:
        if not s.command or s.command == "(auto)":
            continue
        query = f"{s.title}\n{s.command}\n{s.explanation}"
        extra = retrieve(query, limit=2)
        if extra:
            s.citations.extend(extra)

        # de-duplicate and cap
        seen = set()
        deduped: list[Citation] = []
        for c in s.citations:
            key = (c.title, c.snippet)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(c)
        s.citations = deduped[:3]

    max_n = int(os.getenv("TERMINAL_COPILOT_MAX_SUGGESTIONS", "6"))
    return uniq[:max_n]
