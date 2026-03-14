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

    if mentions_port_8000 and ("ps -p <pid>" in cmd_lower or "kill <pid>" in cmd_lower or "kill -9 <pid>" in cmd_lower or "kill -15 <pid>" in cmd_lower):
        if "ps -p <pid>" in cmd_lower:
            return (
                "sh -lc '"
                + linux_pid_expr
                + '; [ -n "$pid" ] && ps -p "$pid" -o pid,ppid,user,cmd || { echo "port 8000 not listening"; exit 1; }\''
            )
        if "kill -15 <pid>" in cmd_lower:
            return (
                "sh -lc '"
                + linux_pid_expr
                + '; [ -n "$pid" ] && kill -15 "$pid" || { echo "port 8000 not listening"; exit 1; }\''
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


def _is_port_in_use_scenario(intent: str, suggestions: list[CommandSuggestion]) -> bool:
    intent_lower = (intent or "").lower()
    if "8000" not in intent_lower and not any("8000" in (s.command or "") for s in suggestions):
        return False

    for suggestion in suggestions:
        suggestion_id = (suggestion.id or "").lower()
        command = (suggestion.command or "").lower()
        if suggestion_id.startswith(("intent-port-", "port-")):
            return True
        if any(
            token in command
            for token in ("ss -ltnp", "netstat -ano", "findstr :8000", "lsof")
        ) and "8000" in command:
            return True
    return False


def _port_plan_platform(suggestions: list[CommandSuggestion]) -> str:
    for suggestion in suggestions:
        suggestion_id = (suggestion.id or "").lower()
        command = (suggestion.command or "").lower()
        if "windows" in suggestion_id or "netstat" in command or "findstr" in command:
            return "windows"
        if "mac" in suggestion_id or "lsof" in command:
            return "mac"
    return "linux"


def _build_port_in_use_plan(*, intent: str, suggestions: list[CommandSuggestion]) -> ExecutionPlan:
    platform = _port_plan_platform(suggestions)
    base_citations = list((suggestions[0].citations if suggestions else []) or [])

    if platform == "windows":
        detect_command = "netstat -ano | findstr :8000"
        inspect_command = (
            'powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8000 '
            '-State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 '
            '-ExpandProperty OwningProcess; if (-not $p) { Write-Host '
            '\\"port 8000 not listening\\"; exit 1 }; '
            'Get-Process -Id $p | Select-Object Id,ProcessName,Path | Format-Table -AutoSize"'
        )
        kill_command = (
            'powershell -NoProfile -Command "$p = Get-NetTCPConnection -LocalPort 8000 '
            '-State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 '
            '-ExpandProperty OwningProcess; if (-not $p) { Write-Host '
            '\\"port 8000 not listening\\"; exit 1 }; '
            'Stop-Process -Id $p -Force; Write-Host (\\"stopped pid \\" + $p)"'
        )
        verify_command = detect_command
    elif platform == "mac":
        detect_command = "lsof -nP -iTCP:8000 -sTCP:LISTEN"
        inspect_command = (
            "sh -lc 'pid=$(lsof -nP -t -iTCP:8000 -sTCP:LISTEN | head -n 1); "
            "[ -n \"$pid\" ] && ps -p \"$pid\" -o pid=,ppid=,user=,command= "
            "|| { echo \"port 8000 not listening\"; exit 1; }'"
        )
        kill_command = (
            "sh -lc 'pid=$(lsof -nP -t -iTCP:8000 -sTCP:LISTEN | head -n 1); "
            "[ -n \"$pid\" ] && kill \"$pid\" || { echo \"port 8000 not listening\"; exit 1; }'"
        )
        verify_command = detect_command
    else:
        detect_command = "ss -ltnp | grep :8000"
        inspect_command = (
            "sh -lc 'pid=$(ss -ltnp 2>/dev/null | sed -n "
            "\"s/.*:8000 .*pid=\\([0-9][0-9]*\\).*/\\1/p\" | head -n 1); "
            "[ -n \"$pid\" ] && ps -fp \"$pid\" || { echo \"port 8000 not listening\"; exit 1; }'"
        )
        kill_command = (
            "sh -lc 'pid=$(ss -ltnp 2>/dev/null | sed -n "
            "\"s/.*:8000 .*pid=\\([0-9][0-9]*\\).*/\\1/p\" | head -n 1); "
            "[ -n \"$pid\" ] && kill \"$pid\" || { echo \"port 8000 not listening\"; exit 1; }'"
        )
        verify_command = detect_command

    root_id = "n0"
    end_id = "n6"
    nodes = [
        PlanNode(
            id=root_id,
            type="diagnose",
            title="Analyze Intent",
            command="",
            risk_level=RiskLevel.safe,
            grounded=False,
            description=intent or "Investigate port 8000 occupancy.",
            citations=[],
        ),
        PlanNode(
            id="n1",
            type="command",
            title="Check whether port 8000 is occupied",
            command=detect_command,
            risk_level=RiskLevel.safe,
            grounded=bool(base_citations),
            description="Detect whether a listener is already bound to port 8000.",
            citations=list(base_citations),
        ),
        PlanNode(
            id="n2",
            type="command",
            title="Inspect the occupying process",
            command=inspect_command,
            risk_level=RiskLevel.safe,
            grounded=False,
            description="Show the process details before any stop action.",
            citations=[],
        ),
        PlanNode(
            id="n3",
            type="human",
            title="Confirm whether to stop the occupying process",
            command="",
            risk_level=RiskLevel.safe,
            grounded=False,
            description="Require explicit approval before terminating the process.",
            citations=[],
        ),
        PlanNode(
            id="n4",
            type="command",
            title="Stop the occupying process",
            command=kill_command,
            risk_level=RiskLevel.warn,
            grounded=False,
            description="Terminate the process holding port 8000.",
            citations=[],
            rollback="Restart the stopped service if it was required.",
        ),
        PlanNode(
            id="n5",
            type="verify",
            title="Verify whether port 8000 is now free",
            command=verify_command,
            risk_level=RiskLevel.safe,
            grounded=bool(base_citations),
            description="Re-check the port after the stop action.",
            citations=list(base_citations),
        ),
        PlanNode(
            id=end_id,
            type="end",
            title="Done",
            command="",
            risk_level=RiskLevel.safe,
            grounded=True,
            description="Port workflow completed.",
            citations=[],
        ),
    ]
    edges = [
        PlanEdge(source_id=root_id, target_id="n1", condition="success", label="next"),
        PlanEdge(source_id="n1", target_id="n2", condition="success", label="occupied"),
        PlanEdge(source_id="n1", target_id=end_id, condition="failure", label="free"),
        PlanEdge(source_id="n2", target_id="n3", condition="success", label="reviewed"),
        PlanEdge(source_id="n3", target_id="n4", condition="success", label="approved"),
        PlanEdge(source_id="n4", target_id="n5", condition="success", label="verify"),
        PlanEdge(source_id="n5", target_id=end_id, condition="success", label="done"),
    ]

    return ExecutionPlan(
        id=str(uuid4()),
        intent=intent or "",
        nodes=nodes,
        edges=edges,
        root_id=root_id,
        generated_by="planner",
        created_at=datetime.now(timezone.utc).isoformat(),
    )


# ── Scenario detection helpers ─────────────────────────────────────────────

def _is_health_check_scenario(intent: str) -> bool:
    low = (intent or "").lower()
    strong_health_terms = ["巡检", "体检", "health check", "health inspection", "server health", "全面健康"]
    metric_terms = ["磁盘", "disk", "内存", "memory", "cpu", "负载", "load", "服务器状态"]
    return any(k in low for k in strong_health_terms) or ("健康" in low and any(k in low for k in metric_terms))


def _is_deploy_verify_scenario(intent: str) -> bool:
    low = (intent or "").lower()
    deploy_terms = ["部署", "上线", "deploy", "发布"]
    verify_terms = ["验证", "verify", "运行", "service", "服务", "健康接口", "health", "进程", "process", "端口", "port", "依赖", "dependency", "dependencies"]
    return any(k in low for k in deploy_terms) and any(k in low for k in verify_terms)


def _is_security_audit_scenario(intent: str) -> bool:
    low = (intent or "").lower()
    security_terms = ["安全", "审查", "审计", "security", "audit", "漏洞", "合规", "compliance"]
    target_terms = ["端口", "port", "权限", "permission", "suid", "用户", "user", "users"]
    return any(k in low for k in security_terms) and any(k in low for k in target_terms)


# ── Health Check Plan ──────────────────────────────────────────────────────

def _build_health_check_plan(*, intent: str) -> ExecutionPlan:
    """服务器健康巡检：磁盘→内存→CPU→进程→条件分支→清理/完成"""
    cit_disk = retrieve("磁盘空间 df", limit=1)
    cit_mem = retrieve("内存 free", limit=1)
    cit_proc = retrieve("进程 ps", limit=1)

    nodes = [
        PlanNode(
            id="h0", type="diagnose", title="开始服务器巡检",
            command="", risk_level=RiskLevel.safe, grounded=False,
            description=intent or "对服务器进行全面健康检查",
            citations=[],
        ),
        PlanNode(
            id="h1", type="command", title="检查磁盘空间",
            command="df -h",
            risk_level=RiskLevel.safe, grounded=bool(cit_disk),
            description="查看各分区磁盘使用率，超过 85%% 需关注。",
            citations=list(cit_disk),
        ),
        PlanNode(
            id="h2", type="command", title="检查内存使用",
            command="free -h",
            risk_level=RiskLevel.safe, grounded=bool(cit_mem),
            description="查看内存和 swap 使用情况。",
            citations=list(cit_mem),
        ),
        PlanNode(
            id="h3", type="command", title="检查 CPU 负载",
            command="uptime",
            risk_level=RiskLevel.safe, grounded=False,
            description="查看系统负载均值（1/5/15 分钟）。",
            citations=[],
        ),
        PlanNode(
            id="h4", type="command", title="查看高内存占用进程",
            command="ps aux --sort=-%mem | head -8",
            risk_level=RiskLevel.safe, grounded=bool(cit_proc),
            description="列出内存占用最高的进程，便于识别异常。",
            citations=list(cit_proc),
        ),
        PlanNode(
            id="h5", type="condition", title="是否需要清理？",
            command=(
                "sh -c 'disk=$(df -P / 2>/dev/null | awk \"NR==2 {gsub(/%/, \\\"\\\", \\$5); print \\$5+0}\"); "
                "mem=$(free 2>/dev/null | awk \"/Mem:/ {if (\\$2>0) print int(\\$3*100/\\$2); else print 0}\"); "
                "if [ \"${disk:-0}\" -ge 85 ] || [ \"${mem:-0}\" -ge 85 ]; then "
                "echo \"anomaly_detected disk=${disk:-na}% mem=${mem:-na}%\"; exit 0; "
                "fi; echo \"healthy disk=${disk:-na}% mem=${mem:-na}%\"; exit 1'"
            ),
            risk_level=RiskLevel.safe, grounded=False,
            description="根据检查结果判断是否需要清理临时文件或异常进程。",
            citations=[],
        ),
        PlanNode(
            id="h6", type="command", title="清理临时文件",
            command="sh -c 'du -sh /tmp 2>/dev/null; find /tmp -type f -atime +7 2>/dev/null | head -20; echo \"(preview only, no deletion)\"'",
            risk_level=RiskLevel.warn, grounded=False,
            description="预览 /tmp 中超过 7 天未访问的文件（仅预览，不删除）。",
            citations=[],
            rollback="无需回滚（仅预览模式）。",
        ),
        PlanNode(
            id="h7", type="verify", title="复查磁盘空间",
            command="df -h /",
            risk_level=RiskLevel.safe, grounded=bool(cit_disk),
            description="确认根分区当前使用率。",
            citations=list(cit_disk),
        ),
        PlanNode(
            id="h8", type="end", title="巡检完成",
            command="", risk_level=RiskLevel.safe, grounded=True,
            description="服务器健康巡检完成，审计报告已生成。",
            citations=[],
        ),
    ]
    edges = [
        PlanEdge(source_id="h0", target_id="h1", condition="success", label="开始"),
        PlanEdge(source_id="h1", target_id="h2", condition="success", label="next"),
        PlanEdge(source_id="h2", target_id="h3", condition="success", label="next"),
        PlanEdge(source_id="h3", target_id="h4", condition="success", label="next"),
        PlanEdge(source_id="h4", target_id="h5", condition="success", label="分析"),
        PlanEdge(source_id="h5", target_id="h6", condition="success", label="需清理"),
        PlanEdge(source_id="h5", target_id="h8", condition="failure", label="一切正常"),
        PlanEdge(source_id="h6", target_id="h7", condition="success", label="复查"),
        PlanEdge(source_id="h7", target_id="h8", condition="success", label="完成"),
    ]
    return ExecutionPlan(
        id=str(uuid4()), intent=intent or "", nodes=nodes, edges=edges,
        root_id="h0", generated_by="planner",
        created_at=datetime.now(timezone.utc).isoformat(),
    )


# ── Deploy Verify Plan ─────────────────────────────────────────────────────

def _build_deploy_verify_plan(*, intent: str) -> ExecutionPlan:
    """应用上线验证：进程→端口→健康接口→依赖→条件分支→完成"""
    cit_port = retrieve("端口 ss 监听", limit=1)
    cit_proc = retrieve("进程 ps", limit=1)

    nodes = [
        PlanNode(
            id="d0", type="diagnose", title="开始上线验证",
            command="", risk_level=RiskLevel.safe, grounded=False,
            description=intent or "验证已部署服务是否正常运行",
            citations=[],
        ),
        PlanNode(
            id="d1", type="command", title="检查服务进程",
            command="ps aux | grep -E 'python|uvicorn|gunicorn|node|java' | grep -v grep",
            risk_level=RiskLevel.safe, grounded=bool(cit_proc),
            description="确认应用进程是否存活。",
            citations=list(cit_proc),
        ),
        PlanNode(
            id="d2", type="command", title="检查端口监听",
            command="ss -ltnp | grep -E ':7860|:8000|:8080|:80'",
            risk_level=RiskLevel.safe, grounded=bool(cit_port),
            description="确认服务端口是否在监听。",
            citations=list(cit_port),
        ),
        PlanNode(
            id="d3", type="command", title="测试健康接口",
            command=(
                "sh -c 'for url in "
                "http://localhost:8000/api/health "
                "http://localhost:7860/api/health "
                "http://localhost:8080/api/health "
                "http://localhost:80/api/health; do "
                "if curl -sf \"$url\"; then exit 0; fi; "
                "done; echo \"health check failed\"; exit 1'"
            ),
            risk_level=RiskLevel.safe, grounded=False,
            description="调用健康检查 API，确认服务正常响应。",
            citations=[],
        ),
        PlanNode(
            id="d4", type="command", title="检查依赖完整性",
            command="pip list --format=columns 2>/dev/null | head -15",
            risk_level=RiskLevel.safe, grounded=False,
            description="列出已安装的 Python 包，确认关键依赖存在。",
            citations=[],
        ),
        PlanNode(
            id="d5", type="condition", title="服务是否健康？",
            command=(
                "sh -c 'ps aux | grep -E \"python|uvicorn|gunicorn|node|java\" | grep -v grep >/dev/null "
                "&& ss -ltnp | grep -E \":7860|:8000|:8080|:80\" >/dev/null "
                "&& (curl -sf http://localhost:8000/api/health >/dev/null "
                "|| curl -sf http://localhost:7860/api/health >/dev/null "
                "|| curl -sf http://localhost:8080/api/health >/dev/null "
                "|| curl -sf http://localhost:80/api/health >/dev/null) "
                "&& python -m pip show fastapi >/dev/null 2>&1 "
                "&& python -m pip show uvicorn >/dev/null 2>&1'"
            ),
            risk_level=RiskLevel.safe, grounded=False,
            description="综合判断：进程存活、端口监听、健康接口正常、依赖完整。",
            citations=[],
        ),
        PlanNode(
            id="d6", type="command", title="查看最近日志",
            command="tail -20 /home/ops/logs/app.log 2>/dev/null || echo 'no log file'",
            risk_level=RiskLevel.safe, grounded=False,
            description="如有异常，查看应用日志定位原因。",
            citations=[],
        ),
        PlanNode(
            id="d7", type="end", title="验证完成",
            command="", risk_level=RiskLevel.safe, grounded=True,
            description="应用上线验证完成，审计报告已生成。",
            citations=[],
        ),
    ]
    edges = [
        PlanEdge(source_id="d0", target_id="d1", condition="success", label="开始"),
        PlanEdge(source_id="d1", target_id="d2", condition="success", label="next"),
        PlanEdge(source_id="d2", target_id="d3", condition="success", label="next"),
        PlanEdge(source_id="d3", target_id="d4", condition="success", label="next"),
        PlanEdge(source_id="d4", target_id="d5", condition="success", label="诊断"),
        PlanEdge(source_id="d5", target_id="d7", condition="success", label="一切正常"),
        PlanEdge(source_id="d5", target_id="d6", condition="failure", label="有异常"),
        PlanEdge(source_id="d6", target_id="d7", condition="success", label="完成"),
    ]
    return ExecutionPlan(
        id=str(uuid4()), intent=intent or "", nodes=nodes, edges=edges,
        root_id="d0", generated_by="planner",
        created_at=datetime.now(timezone.utc).isoformat(),
    )


# ── Security Audit Plan ────────────────────────────────────────────────────

def _build_security_audit_plan(*, intent: str) -> ExecutionPlan:
    """安全合规审查：端口扫描→用户检查→进程检查→SUID→风险分支→完成"""
    cit_port = retrieve("端口 ss 扫描", limit=1)
    cit_perm = retrieve("权限 SUID 安全", limit=1)
    cit_fw = retrieve("防火墙 iptables", limit=1)

    nodes = [
        PlanNode(
            id="s0", type="diagnose", title="开始安全审查",
            command="", risk_level=RiskLevel.safe, grounded=False,
            description=intent or "对服务器进行安全合规审查",
            citations=[],
        ),
        PlanNode(
            id="s1", type="command", title="扫描开放端口",
            command="ss -ltnp",
            risk_level=RiskLevel.safe, grounded=bool(cit_port),
            description="列出所有正在监听的 TCP 端口和对应进程。",
            citations=list(cit_port),
        ),
        PlanNode(
            id="s2", type="command", title="检查可登录用户",
            command="cat /etc/passwd | grep -v -E 'nologin|false' | cut -d: -f1,6,7",
            risk_level=RiskLevel.safe, grounded=False,
            description="列出系统中可交互登录的用户账户。",
            citations=[],
        ),
        PlanNode(
            id="s3", type="command", title="查找异常进程",
            command="ps aux --sort=-%cpu | head -10",
            risk_level=RiskLevel.safe, grounded=False,
            description="列出 CPU 占用最高的进程，排查挖矿或异常程序。",
            citations=[],
        ),
        PlanNode(
            id="s4", type="command", title="检查 SUID 文件",
            command="find / -perm -4000 -type f 2>/dev/null | head -15",
            risk_level=RiskLevel.safe, grounded=bool(cit_perm),
            description="查找具有 SUID 权限的可执行文件，这些文件可能被利用提权。",
            citations=list(cit_perm),
        ),
        PlanNode(
            id="s5", type="condition", title="是否发现安全风险？",
            command=(
                "sh -c 'issues=0; "
                "if grep -E \"^root:.*:(/bin/bash|/bin/sh)$\" /etc/passwd >/dev/null; then "
                "echo \"risk: root_login_shell\"; issues=1; fi; "
                "if ss -ltnp 2>/dev/null | grep -E \":(22|2375|3306|5432)\\\\b\" >/dev/null; then "
                "echo \"risk: sensitive_port_exposed\"; issues=1; fi; "
                "if [ \"$issues\" -eq 1 ]; then exit 0; fi; "
                "echo \"no_obvious_high_risk_findings\"; exit 1'"
            ),
            risk_level=RiskLevel.safe, grounded=False,
            description="综合评估：异常端口、可疑用户、高 CPU 进程、危险 SUID 文件。",
            citations=[],
        ),
        PlanNode(
            id="s6", type="human", title="风险项需人工确认",
            command="", risk_level=RiskLevel.warn, grounded=False,
            description="发现潜在风险项，需要安全工程师确认是否需要修复。",
            citations=[],
        ),
        PlanNode(
            id="s7", type="verify", title="检查防火墙规则",
            command="iptables -L -n 2>/dev/null | head -20 || echo 'iptables not available'",
            risk_level=RiskLevel.safe, grounded=bool(cit_fw),
            description="查看当前防火墙规则，确认安全策略是否生效。",
            citations=list(cit_fw),
        ),
        PlanNode(
            id="s8", type="end", title="安全审查完成",
            command="", risk_level=RiskLevel.safe, grounded=True,
            description="安全合规审查完成，审计报告已生成。",
            citations=[],
        ),
    ]
    edges = [
        PlanEdge(source_id="s0", target_id="s1", condition="success", label="开始"),
        PlanEdge(source_id="s1", target_id="s2", condition="success", label="next"),
        PlanEdge(source_id="s2", target_id="s3", condition="success", label="next"),
        PlanEdge(source_id="s3", target_id="s4", condition="success", label="next"),
        PlanEdge(source_id="s4", target_id="s5", condition="success", label="评估"),
        PlanEdge(source_id="s5", target_id="s6", condition="success", label="有风险"),
        PlanEdge(source_id="s5", target_id="s7", condition="failure", label="无异常"),
        PlanEdge(source_id="s6", target_id="s7", condition="success", label="已确认"),
        PlanEdge(source_id="s7", target_id="s8", condition="success", label="完成"),
    ]
    return ExecutionPlan(
        id=str(uuid4()), intent=intent or "", nodes=nodes, edges=edges,
        root_id="s0", generated_by="planner",
        created_at=datetime.now(timezone.utc).isoformat(),
    )


# ── Plan Router ────────────────────────────────────────────────────────────

def build_execution_plan(*, intent: str, suggestions: list[CommandSuggestion]) -> ExecutionPlan:
    """Build a minimal DAG execution plan from ordered command suggestions."""

    # Scenario-specific plans (rich DAGs with branches)
    # Order matters: check more specific scenarios first to avoid cross-triggering.
    if _is_health_check_scenario(intent):
        return _build_health_check_plan(intent=intent)

    if _is_security_audit_scenario(intent):
        return _build_security_audit_plan(intent=intent)

    if _is_deploy_verify_scenario(intent):
        return _build_deploy_verify_plan(intent=intent)

    if _is_port_in_use_scenario(intent, suggestions):
        return _build_port_in_use_plan(intent=intent, suggestions=suggestions)

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


def suggest(req: SuggestRequest, *, allow_orchestrator: bool = True) -> list[CommandSuggestion]:
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
    if allow_orchestrator and not suggestions and llm_enabled and last:
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
