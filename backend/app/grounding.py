"""防幻觉机制：建议生成后的事实性验证与置信度标注。

设计原则：
- 轻量级（不额外调用 LLM），纯规则/统计
- 三档置信度：high（有 RAG 依据）、medium（语法合理但无依据）、low（语法可疑）
"""

from __future__ import annotations

import re

from .models import Citation, CommandSuggestion


# 明显不合法的"命令"模式
_SUSPICIOUS_PATTERNS = [
    r"^$",                         # 空命令
    r"^\s*\(auto\)\s*$",           # 占位符
    r"^<[^>]+>$",                  # XML 占位符如 <command>
    r"^\.\.\.$",                   # 省略号
    r"^[a-zA-Z]{20,}$",            # 超长无意义单词
]

_SUSPICIOUS_RE = re.compile("|".join(_SUSPICIOUS_PATTERNS))

# 常见合法命令前缀（用于快速合法性判断）
_KNOWN_CMD_PREFIXES = {
    "ls", "cd", "pwd", "echo", "cat", "grep", "find", "ps", "kill", "top",
    "df", "du", "free", "uptime", "uname", "who", "whoami", "id",
    "sudo", "su", "chmod", "chown", "mkdir", "rm", "cp", "mv", "touch",
    "git", "docker", "kubectl", "systemctl", "journalctl", "service",
    "pip", "pip3", "python", "python3", "npm", "node", "yarn",
    "curl", "wget", "ssh", "scp", "rsync", "netstat", "ss", "lsof",
    "iptables", "firewall-cmd", "ufw", "nginx", "apache2",
    "mysql", "psql", "redis-cli", "mongo",
    "tar", "zip", "unzip", "gzip", "gunzip",
    "apt", "apt-get", "yum", "dnf", "brew", "pacman",
    "env", "export", "source", "which", "where", "type",
    "nohup", "screen", "tmux", "htop", "iotop",
    "ifconfig", "ip", "ping", "traceroute", "nslookup", "dig",
    "strace", "ldd", "file", "head", "tail", "wc", "sort", "uniq",
    "awk", "sed", "xargs", "tee", "less", "more",
    "netstat", "ss", "nmap", "tcpdump",
    "crontab", "at", "watch", "timeout",
}


def _check_syntax(command: str) -> bool:
    """快速判断命令是否"看起来合法"（非精确解析）"""
    cmd = (command or "").strip()
    if not cmd or _SUSPICIOUS_RE.match(cmd):
        return False
    # 取第一个词（跳过 sudo/env/timeout 等前缀）
    tokens = cmd.split()
    first = tokens[0].lower() if tokens else ""
    # 如果第一个词是已知命令前缀，认为合法
    if first in _KNOWN_CMD_PREFIXES:
        return True
    # 如果是路径形式 (/usr/bin/xxx 或 ./xxx)
    if first.startswith("/") or first.startswith("./"):
        return True
    # 长度合理且无奇怪字符，勉强认为可能合法
    if 2 <= len(first) <= 20 and re.match(r"^[a-zA-Z0-9_\-]+$", first):
        return True
    return False


def _check_rag_support(suggestion: CommandSuggestion, all_citations: list[Citation]) -> bool:
    """检查建议是否有知识库依据（建议本身携带 citations）"""
    # 方法一：建议直接携带 citations
    if suggestion.citations:
        return True
    # 方法二：command/title 关键词命中外部 citations 列表
    cmd_lower = (suggestion.command or "").lower()
    title_lower = (suggestion.title or "").lower()
    for cit in all_citations:
        snippet = (cit.snippet or "").lower()
        # 如果 citation snippet 包含命令关键词
        words = [w for w in re.split(r"\W+", cmd_lower) if len(w) >= 3]
        if any(w in snippet for w in words[:3]):
            return True
        if title_lower and title_lower[:10] in snippet:
            return True
    return False


def annotate_confidence(
    suggestions: list[CommandSuggestion],
    extra_citations: list[Citation] | None = None,
) -> list[CommandSuggestion]:
    """批量标注置信度。

    规则：
    - syntax_ok + rag_supported → high ("✓ RAG验证")
    - syntax_ok + no_rag        → medium ("⚠ 未经验证")
    - not syntax_ok             → low   ("✗ 语法存疑")
    """
    citations = extra_citations or []
    for s in suggestions:
        syntax_ok = _check_syntax(s.command)
        rag_ok = _check_rag_support(s, citations)

        if syntax_ok and rag_ok:
            s.confidence = "high"
            s.confidence_label = "✓ RAG验证"
        elif syntax_ok:
            s.confidence = "medium"
            s.confidence_label = "⚠ 未经验证"
        else:
            s.confidence = "low"
            s.confidence_label = "✗ 语法存疑"

    return suggestions


def async_alignment_check(
    intent: str,
    suggestions: list[CommandSuggestion],
) -> list[CommandSuggestion]:
    """Use the configured LLM to check semantic intent alignment."""

    if not suggestions or not (intent or "").strip():
        return suggestions

    try:
        from .llm.modelscope_client import (
            modelscope_chat_completion,
            modelscope_is_configured,
        )

        if not modelscope_is_configured():
            return suggestions

        items = [
            {"id": s.id, "title": s.title, "command": s.command}
            for s in suggestions
            if (s.command or "").strip() and s.command != "(auto)"
        ]
        if not items:
            return suggestions

        prompt = (
            "Review whether each terminal command suggestion is aligned with the user intent.\n"
            f"Intent: {intent}\n"
            "Return JSON only as an array.\n"
            'Each item must be {"id": "...", "alignment": "ok|warn|mismatch", "reason": "..."}.\n'
            f"Suggestions: {items!r}"
        )
        raw = modelscope_chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": "You audit command intent alignment. Return strict JSON only.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=400,
        )

        import json as _json

        match = re.search(r"\[[\s\S]*\]", raw or "")
        if not match:
            return suggestions
        payload = _json.loads(match.group(0))
        if not isinstance(payload, list):
            return suggestions

        by_id = {
            str(item.get("id", "")).strip(): item
            for item in payload
            if isinstance(item, dict) and str(item.get("id", "")).strip()
        }
        for suggestion in suggestions:
            item = by_id.get(suggestion.id)
            if not item:
                continue
            suggestion.alignment = str(item.get("alignment", "")).strip()
            suggestion.alignment_reason = str(item.get("reason", "")).strip()
    except Exception:
        return suggestions

    return suggestions
