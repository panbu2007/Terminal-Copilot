from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from uuid import uuid4

from .grounding import annotate_confidence
from .models import Citation, CommandSuggestion, ExecutionPlan, PlanEdge, PlanNode, RiskLevel, SuggestRequest
from .rag import retrieve


def _cit(title: str, snippet: str) -> Citation:
    return Citation(title=title, snippet=snippet)


def _parse_git_branch_output(stdout: str) -> tuple[str | None, set[str], set[str]]:
    """Parse output of `git branch` / `git branch -a`.

    Returns: (current_local_branch, local_branches, remote_branches)

    Note: remote branches are returned in the form `origin/main` (without `remotes/`).
    """

    current: str | None = None
    local: set[str] = set()
    remote: set[str] = set()

    for raw in (stdout or "").splitlines():
        line = raw.strip("\r\n")
        if not line.strip():
            continue

        is_current = line.lstrip().startswith("*")
        name = line.strip()
        if is_current:
            # Original line may look like: "* master"
            name = name.lstrip()[1:].strip()

        # Filter symbolic refs like: "remotes/origin/HEAD -> origin/master"
        if "->" in name:
            continue

        if name.startswith("remotes/"):
            name = name[len("remotes/") :]
            if name:
                remote.add(name)
        else:
            if name:
                local.add(name)
                if is_current:
                    current = name

    return current, local, remote


def _materialize_plan_command(
    command: str,
    *,
    title: str,
    intent: str,
) -> str:
    cmd = (command or "").strip()
    if not cmd or "<PID>" not in cmd:
        return cmd

    title_lower = (title or "").lower()
    intent_lower = (intent or "").lower()
    mentions_port_8000 = "8000" in intent_lower or "8000" in cmd
    cmd_lower = cmd.lower()

    linux_pid_expr = r"""pid=$(ss -ltnp 2>/dev/null | sed -n "s/.*:8000 .*pid=\([0-9][0-9]*\).*/\1/p" | head -n 1)"""

    if mentions_port_8000 and ("tasklist" in cmd_lower or "taskkill" in cmd_lower):
        if "tasklist" in cmd_lower:
            return (
                'powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8000 '
                '-State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 '
                '-ExpandProperty OwningProcess; if (-not $p) { Write-Host '
                '\\"port 8000 not listening\\"; exit 1 }; '
                'Get-Process -Id $p | Select-Object Id,ProcessName,Path | Format-Table -AutoSize"'
            )
        if "taskkill" in cmd_lower:
            return (
                'powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8000 '
                '-State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 '
                '-ExpandProperty OwningProcess; if (-not $p) { Write-Host '
                '\\"port 8000 not listening\\"; exit 1 }; '
                'Stop-Process -Id $p -Force; Write-Host (\\"stopped pid \\" + $p)"'
            )

    if mentions_port_8000 and ("ps -p <pid>" in cmd_lower or "kill <pid>" in cmd_lower or "kill -9 <pid>" in cmd_lower):
        if "ps -p <pid>" in cmd_lower:
            return (
                "sh -lc '"
                + linux_pid_expr
                + '; [ -n "$pid" ] && ps -p "$pid" -o pid,ppid,user,cmd || { echo "port 8000 not listening"; exit 1; }\''
            )
        if "kill -9 <pid>" in cmd_lower:
            return (
                "sh -lc '"
                + linux_pid_expr
                + '; [ -n "$pid" ] && kill -9 "$pid" || { echo "port 8000 not listening"; exit 1; }\''
            )
        if "kill <pid>" in cmd_lower:
            return (
                "sh -lc '"
                + linux_pid_expr
                + '; [ -n "$pid" ] && kill "$pid" || { echo "port 8000 not listening"; exit 1; }\''
            )

    if mentions_port_8000 and ("grep <pid>" in cmd_lower or "ps -ef" in cmd_lower or "ps aux" in cmd_lower):
        return (
            "sh -lc '"
            + linux_pid_expr
            + '; [ -n "$pid" ] && ps -fp "$pid" || { echo "port 8000 not listening"; exit 1; }\''
        )

    if mentions_port_8000 and ("wmic process where" in cmd_lower or "processid=<pid>" in cmd_lower):
        return (
            'powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8000 '
            '-State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 '
            '-ExpandProperty OwningProcess; if (-not $p) { Write-Host '
            '\\"port 8000 not listening\\"; exit 1 }; '
            'Get-CimInstance Win32_Process -Filter (\\"ProcessId = \\" + $p) '
            '| Select-Object ProcessId,Name,ExecutablePath,CommandLine | Format-Table -AutoSize"'
        )

    if mentions_port_8000 and "根据 pid 查看占用进程详细信息" in title_lower:
        return (
            'powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8000 '
            '-State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 '
            '-ExpandProperty OwningProcess; if (-not $p) { Write-Host '
            '\\"port 8000 not listening\\"; exit 1 }; '
            'Get-Process -Id $p | Select-Object Id,ProcessName,Path | Format-Table -AutoSize"'
        )

    return cmd


def build_execution_plan(*, intent: str, suggestions: list[CommandSuggestion]) -> ExecutionPlan:
    """Build a minimal DAG execution plan from ordered command suggestions."""

    nodes: list[PlanNode] = []
    edges: list[PlanEdge] = []

    # Root diagnose node to make the graph explicit even for single-command plans.
    root_id = "n0"
    nodes.append(
        PlanNode(
            id=root_id,
            type="diagnose",
            title="Analyze Intent",
            command="",
            risk_level=RiskLevel.safe,
            grounded=False,
            description=intent or "User intent analysis",
            citations=[],
        )
    )

    prev_id = root_id
    counter = 1
    for s in suggestions:
        cmd = (s.command or "").strip()
        if not cmd or cmd == "(auto)":
            continue

        node_type = "command"
        title_lower = (s.title or "").lower()
        cmd_lower = cmd.lower()
        if "verify" in title_lower or "check" in title_lower or "status" in title_lower:
            node_type = "verify"
        elif "rollback" in title_lower or "revert" in title_lower:
            node_type = "rollback"
        elif s.requires_confirmation:
            node_type = "human"

        node_id = f"n{counter}"
        counter += 1
        nodes.append(
            PlanNode(
                id=node_id,
                type=node_type,  # type: ignore[arg-type]
                title=s.title or cmd,
                command=_materialize_plan_command(
                    cmd,
                    title=s.title or cmd,
                    intent=intent or "",
                ),
                risk_level=s.risk_level,
                grounded=bool(s.citations),
                description=s.explanation or "",
                citations=list(s.citations or []),
                rollback=s.rollback or "",
            )
        )
        edges.append(PlanEdge(source_id=prev_id, target_id=node_id, condition="success", label="next"))
        prev_id = node_id

    end_id = f"n{counter}"
    nodes.append(
        PlanNode(
            id=end_id,
            type="end",
            title="Done",
            command="",
            risk_level=RiskLevel.safe,
            grounded=True,
            description="Plan end",
            citations=[],
        )
    )
    edges.append(PlanEdge(source_id=prev_id, target_id=end_id, condition="success", label="done"))

    return ExecutionPlan(
        id=str(uuid4()),
        intent=intent or "",
        nodes=nodes,
        edges=edges,
        root_id=root_id,
        generated_by="planner",
        created_at=datetime.now(timezone.utc).isoformat(),
    )


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
                    agent="rules",
                    risk_level=RiskLevel.safe,
                ),
                CommandSuggestion(
                    id="daemon-reload-intent",
                    title="重新加载 systemd 配置",
                    command="sudo systemctl daemon-reload",
                    explanation="修改服务配置后，先让 systemd 重新加载单元文件。",
                    agent="rules",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("systemctl daemon-reload"),
                ),
                CommandSuggestion(
                    id="restart-docker-intent",
                    title="重启 Docker 服务",
                    command="sudo systemctl restart docker",
                    explanation="修改配置后重启 Docker 生效（可能影响正在运行的容器）。",
                    agent="rules",
                    risk_level=RiskLevel.warn,
                    requires_confirmation=True,
                    citations=retrieve("systemctl restart docker"),
                ),
                CommandSuggestion(
                    id="verify-docker-intent",
                    title="验证镜像源是否生效",
                    command="docker info",
                    explanation="查看 Registry Mirrors 字段确认生效。",
                    agent="rules",
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
                    agent="rules",
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
                    agent="rules",
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
                    agent="rules",
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
                    agent="rules",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("systemctl daemon-reload"),
                ),
                CommandSuggestion(
                    id="restart-docker",
                    title="重启 Docker 服务",
                    command="sudo systemctl restart docker",
                    explanation="让 Docker 重新读取 daemon.json（会影响正在运行的容器）。",
                    agent="rules",
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
                    agent="rules",
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
                agent="rules",
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
                agent="rules",
                risk_level=RiskLevel.safe,
                tags=["verify"],
                citations=retrieve("docker info Registry Mirrors"),
            )
        )

    # Demo2: git typo
    if last.startswith("git ") and ("chekcout" in last or "checkot" in last or "chekout" in last):
        suggestions.append(
            CommandSuggestion(
                id="fix-git-checkout",
                title="修复拼写：checkout",
                command=last.replace("chekcout", "checkout").replace("checkot", "checkout").replace("chekout", "checkout"),
                explanation="git 子命令拼写错误，给出最小修复命令。",
                agent="rules",
                risk_level=RiskLevel.safe,
                citations=retrieve("git not a git command checkout"),
            )
        )

    # Demo2: branch list output -> propose safer next step (avoid detached HEAD)
    if last in {"git branch", "git branch -a", "git branch --all"} and stdout.strip():
        current, local_branches, remote_branches = _parse_git_branch_output(stdout)

        # Prefer switching to an existing local default branch.
        preferred_local = None
        for cand in ("main", "master"):
            if cand in local_branches:
                preferred_local = cand
                break

        if preferred_local:
            suggestions.append(
                CommandSuggestion(
                    id=f"git-switch-{preferred_local}",
                    title=f"切换到本地分支：{preferred_local}",
                    command=f"git switch {preferred_local}",
                    explanation=(
                        "从分支列表选择本地分支进行切换；相比 checkout 远端分支，可避免进入 detached HEAD。"
                        + ("（你当前已在该分支）" if preferred_local == current else "")
                    ),
                    risk_level=RiskLevel.safe,
                    citations=retrieve("git switch branch"),
                )
            )

        # If only remote exists (e.g. origin/main), suggest creating a tracking branch.
        for cand in ("main", "master"):
            remote_name = f"origin/{cand}"
            if remote_name in remote_branches and cand not in local_branches:
                suggestions.append(
                    CommandSuggestion(
                        id=f"git-track-{cand}",
                        title=f"创建本地 {cand} 并跟踪 {remote_name}",
                        command=f"git switch -c {cand} --track {remote_name}",
                        explanation="如果本地没有该分支，但远端存在，建议创建 tracking 分支；避免直接 `git checkout origin/...` 导致 detached HEAD。",
                        risk_level=RiskLevel.safe,
                        citations=retrieve("git switch -c --track"),
                    )
                )

        # Fallback: show status to confirm current branch.
        if not any(s.id.startswith("git-switch-") or s.id.startswith("git-track-") for s in suggestions):
            suggestions.append(
                CommandSuggestion(
                    id="git-branch-next-status",
                    title="确认当前分支与工作区状态",
                    command="git status",
                    explanation="分支列表已输出；下一步建议用 git status 确认当前所在分支以及是否有未提交变更。",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("git status"),
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
                    agent="rules",
                    risk_level=RiskLevel.safe,
                    citations=retrieve("git status"),
                ),
                CommandSuggestion(
                    id="git-branch-list",
                    title="查看分支列表（辅助定位）",
                    command="git branch",
                    explanation="如果 checkout 失败，先确认分支名是否存在。",
                    agent="rules",
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
                    agent="rules",
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
                    agent="rules",
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
                agent="rules",
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

    # If rules didn't produce any suggestions, fall back to Multi-Agent Orchestrator.
    # OrchestratorAgent: DiagAgent + RAGAgent (parallel) → ExecutorAgent → SafetyAgent
    if not suggestions and llm_enabled and last:
        try:
            from .agents import OrchestratorAgent

            orchestrator = OrchestratorAgent()
            agent_suggestions = orchestrator.process(
                user_intent=last,
                platform=req.platform,
                last_stdout=stdout,
                last_stderr=stderr,
                last_exit_code=req.last_exit_code,
                conversation_messages=req.conversation_messages,
            )
            suggestions.extend(agent_suggestions)
        except Exception as e:
            suggestions.append(
                CommandSuggestion(
                    id="agent-fallback",
                    title="Agent 不可用（已回退规则）",
                    command="(auto)",
                    explanation=f"Multi-Agent 调用失败：{str(e)[:200]}",
                    agent="orchestrator",
                    risk_level=RiskLevel.safe,
                    tags=["agent", "error"],
                )
            )

    # Generic: when command failed — add self-heal hints. Only add `--help` if we still have no actionable suggestions.
    if req.last_exit_code is not None and req.last_exit_code != 0:
        cmd0 = (last.split() or [""])[0]

        # If common "command not found" on Windows, help locate the binary.
        if req.platform == "windows" and ("不是内部或外部命令" in stderr or "not recognized" in stderr.lower()):
            if cmd0:
                suggestions.append(
                    CommandSuggestion(
                        id="selfheal-where",
                        title="自愈：定位命令是否存在（where）",
                        command=f"where {cmd0}",
                        explanation="如果命令不存在/不在 PATH，这一步能快速定位可执行文件。",
                        agent="selfheal",
                        why="错误看起来像是命令未找到。",
                        risk="安全（只读查询）。",
                        verify="若 where 无输出，说明 PATH 中未找到该命令。",
                        tags=["selfheal", "verify"],
                    )
                )
        # Linux/mac: command not found
        if req.platform in {"linux", "mac"} and ("command not found" in stderr.lower()):
            if cmd0:
                suggestions.append(
                    CommandSuggestion(
                        id="selfheal-which",
                        title="自愈：定位命令是否存在（which）",
                        command=f"which {cmd0}",
                        explanation="如果命令未安装/不在 PATH，这一步能快速判断。",
                        agent="selfheal",
                        why="错误看起来像是命令未找到。",
                        risk="安全（只读查询）。",
                        verify="若 which 无输出，通常表示 PATH 中未找到该命令。",
                        tags=["selfheal", "verify"],
                    )
                )

        has_actionable = any((s.command or "").strip() and s.command != "(auto)" for s in suggestions)
        if not has_actionable and last:
            suggestions.append(
                CommandSuggestion(
                    id="show-help",
                    title="查看帮助/用法",
                    command=f"{last} --help",
                    explanation="命令失败时可先查看用法与可用参数（LLM 无可执行建议时自动补充）。",
                    agent="selfheal",
                    why="当前没有足够信息给出可执行修复步骤时，--help 最稳妥。",
                    risk="安全（只读输出）。",
                    tags=["fallback", "selfheal"],
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

        # IMPORTANT: avoid using free-form explanation as RAG query.
        # Explanations (especially from LLM) may contain generic platform words and cause irrelevant citations.
        # Prefer command-centric retrieval; optionally include the title for a bit more context.
        if not s.citations:
            if (s.agent or "").lower() == "llm":
                query = s.command
            else:
                query = f"{s.command}\n{s.title}" if s.title else s.command
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
    final = uniq[:max_n]

    # 防幻觉：标注每条建议的置信度
    annotate_confidence(final)

    return final
