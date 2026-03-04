"""Function Calling 工具定义与执行器

标准 OpenAI-compatible tools，供 LLM 自主调用。
"""
from __future__ import annotations

import json
import logging

logger = logging.getLogger("terminal_copilot.tools")

# ─── 工具定义（传给 LLM 的 tools 参数）──────────────────────────────────────

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_runbook",
            "description": "从知识库检索相关运维文档，返回匹配的标题和内容摘要",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "检索关键词，例如 '端口占用' 或 'docker 镜像拉取失败'",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回文档数量（默认 3）",
                        "default": 3,
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "diagnose_error",
            "description": "分析命令的 stderr 输出和退出码，返回错误类型和诊断建议",
            "parameters": {
                "type": "object",
                "properties": {
                    "stderr": {
                        "type": "string",
                        "description": "命令的标准错误输出",
                    },
                    "exit_code": {
                        "type": "integer",
                        "description": "命令退出码",
                    },
                },
                "required": ["stderr", "exit_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_command",
            "description": "生成一条终端命令建议（不直接执行），包含执行原因和回滚方案",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "要建议执行的 shell 命令",
                    },
                    "reason": {
                        "type": "string",
                        "description": "为什么要执行这条命令",
                    },
                    "requires_confirm": {
                        "type": "boolean",
                        "description": "是否需要用户确认（危险操作设为 true）",
                        "default": False,
                    },
                },
                "required": ["command", "reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "verify_result",
            "description": "验证命令执行结果是否符合预期，返回是否成功及下一步建议",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "已执行的命令",
                    },
                    "stdout": {
                        "type": "string",
                        "description": "命令的标准输出",
                    },
                    "expected": {
                        "type": "string",
                        "description": "期望看到的输出特征描述",
                    },
                },
                "required": ["command", "stdout"],
            },
        },
    },
]


# ─── 工具执行器（后端实现）────────────────────────────────────────────────────

def execute_tool(name: str, arguments: dict) -> str:
    """执行工具调用，返回结果字符串（会被添加回 messages）"""
    try:
        if name == "search_runbook":
            return _tool_search_runbook(arguments)
        elif name == "diagnose_error":
            return _tool_diagnose_error(arguments)
        elif name == "execute_command":
            return _tool_execute_command(arguments)
        elif name == "verify_result":
            return _tool_verify_result(arguments)
        else:
            return json.dumps({"error": f"未知工具: {name}"}, ensure_ascii=False)
    except Exception as e:
        logger.warning("工具调用失败 %s: %s", name, e)
        return json.dumps({"error": str(e)}, ensure_ascii=False)


def _tool_search_runbook(args: dict) -> str:
    query = str(args.get("query", ""))
    limit = int(args.get("limit", 3))
    try:
        from ..rag_v2 import hybrid_retrieve
        results = hybrid_retrieve(query, limit=limit)
    except Exception:
        from ..rag import retrieve
        results = retrieve(query, limit=limit)

    if not results:
        return json.dumps({"results": [], "message": "未找到相关文档"}, ensure_ascii=False)

    docs = []
    for r in results:
        if hasattr(r, "title"):
            docs.append({"title": r.title, "snippet": r.snippet[:300]})
        elif isinstance(r, dict):
            docs.append({"title": r.get("title", ""), "snippet": str(r.get("snippet", ""))[:300]})
    return json.dumps({"results": docs}, ensure_ascii=False)


def _tool_diagnose_error(args: dict) -> str:
    stderr = str(args.get("stderr", ""))
    exit_code = int(args.get("exit_code", -1))

    # 常见错误模式快速匹配
    patterns = [
        ("command not found", "命令未找到", "请检查命令是否已安装，或使用 which/whereis 确认路径"),
        ("permission denied", "权限不足", "尝试使用 sudo 提升权限，或检查文件/目录权限"),
        ("no such file or directory", "文件或目录不存在", "请确认路径是否正确"),
        ("address already in use", "端口已被占用", "使用 ss -ltnp 或 lsof 查找占用进程"),
        ("connection refused", "连接被拒绝", "检查目标服务是否已启动"),
        ("disk quota exceeded", "磁盘空间不足", "使用 df -h 检查磁盘使用情况"),
        ("out of memory", "内存不足", "使用 free -h 和 top 检查内存使用"),
        ("too many open files", "文件描述符超限", "使用 ulimit -n 增加限制"),
    ]
    stderr_lower = stderr.lower()
    for pattern, error_type, hint in patterns:
        if pattern in stderr_lower:
            return json.dumps({
                "error_type": error_type,
                "exit_code": exit_code,
                "diagnosis": hint,
                "matched_pattern": pattern,
            }, ensure_ascii=False)

    return json.dumps({
        "error_type": "未知错误",
        "exit_code": exit_code,
        "diagnosis": f"退出码 {exit_code}，stderr: {stderr[:200]}",
        "matched_pattern": None,
    }, ensure_ascii=False)


def _tool_execute_command(args: dict) -> str:
    command = str(args.get("command", ""))
    reason = str(args.get("reason", ""))
    requires_confirm = bool(args.get("requires_confirm", False))
    return json.dumps({
        "command": command,
        "reason": reason,
        "requires_confirm": requires_confirm,
        "status": "suggested",
    }, ensure_ascii=False)


def _tool_verify_result(args: dict) -> str:
    command = str(args.get("command", ""))
    stdout = str(args.get("stdout", ""))
    expected = str(args.get("expected", ""))

    success = bool(stdout.strip())
    if expected and expected.lower() not in stdout.lower():
        success = False

    return json.dumps({
        "command": command,
        "success": success,
        "stdout_preview": stdout[:300],
        "message": "命令执行成功" if success else "输出未包含预期内容",
    }, ensure_ascii=False)
