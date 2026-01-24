from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

from ..local_secrets import read_modelscope_model, read_modelscope_token


MODELSCOPE_DEFAULT_BASE_URL = "https://api-inference.modelscope.cn/v1/"
MODELSCOPE_DEFAULT_MODEL = "Qwen/Qwen2.5-Coder-32B-Instruct"


@dataclass(frozen=True)
class ModelScopeConfig:
    access_token: str
    base_url: str = MODELSCOPE_DEFAULT_BASE_URL
    model: str = MODELSCOPE_DEFAULT_MODEL
    timeout_seconds: float = 20.0


def _env_config() -> ModelScopeConfig | None:
    token = os.getenv("TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN") or os.getenv("MODELSCOPE_ACCESS_TOKEN")
    if not token:
        token = read_modelscope_token()
    if not token:
        return None
    base_url = os.getenv("TERMINAL_COPILOT_MODELSCOPE_BASE_URL", MODELSCOPE_DEFAULT_BASE_URL)
    if not base_url.endswith("/"):
        base_url += "/"
    model = os.getenv("TERMINAL_COPILOT_MODELSCOPE_MODEL")
    if not model:
        model = read_modelscope_model()
    if not model:
        model = MODELSCOPE_DEFAULT_MODEL
    timeout = float(os.getenv("TERMINAL_COPILOT_MODELSCOPE_TIMEOUT", "20"))
    return ModelScopeConfig(access_token=token, base_url=base_url, model=model, timeout_seconds=timeout)


def modelscope_is_configured() -> bool:
    return _env_config() is not None


def modelscope_chat_completion(messages: list[dict[str, str]], *, temperature: float = 0.2, max_tokens: int = 512) -> str:
    """Call ModelScope API-Inference via OpenAI-compatible Chat Completions.

    Docs: https://modelscope.cn/docs/model-service/API-Inference/intro

    Uses env vars:
      - MODELSCOPE_ACCESS_TOKEN (or TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN)
      - TERMINAL_COPILOT_MODELSCOPE_MODEL (optional)
      - TERMINAL_COPILOT_MODELSCOPE_BASE_URL (optional, default https://api-inference.modelscope.cn/v1/)
    """

    cfg = _env_config()
    if cfg is None:
        raise RuntimeError("modelscope_token_missing")

    url = cfg.base_url + "chat/completions"
    payload = {
        "model": cfg.model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {cfg.access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_seconds) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore") if hasattr(e, "read") else ""
        raise RuntimeError(f"modelscope_http_{getattr(e, 'code', 'error')}: {detail[:400]}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"modelscope_network_error: {e}") from e

    try:
        data = json.loads(body)
        return (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
    except Exception as e:  # noqa: BLE001
        raise RuntimeError(f"modelscope_bad_response: {body[:400]}") from e


_JSON_ARRAY_RE = re.compile(r"\[[\s\S]*\]", re.MULTILINE)


def modelscope_chat_json_suggestions(
    *,
    user_intent: str,
    platform: str | None,
    last_stdout: str,
    last_stderr: str,
) -> list[dict[str, str]]:
    """Ask the LLM for next-command suggestions and parse strict JSON.

    Returns: list of {title, command, explanation}
    """

    system = (
        "你是一个终端命令助手。根据用户意图/上下文，给出下一步可执行命令。\n"
        "要求：\n"
        "- 只返回严格 JSON 数组（不要代码块/不要多余文字）\n"
        "- 每个元素是对象：{\"title\":..., \"command\":..., \"explanation\":...}\n"
        "- 命令要尽量最小、安全、可逆；避免破坏性命令（rm -rf、mkfs、关机等）\n"
        "- 最多 5 条建议\n"
    )

    user = {
        "role": "user",
        "content": json.dumps(
            {
                "intent": user_intent,
                "platform": platform,
                "last_stdout": (last_stdout or "")[:800],
                "last_stderr": (last_stderr or "")[:800],
            },
            ensure_ascii=False,
        ),
    }

    text = modelscope_chat_completion(
        messages=[{"role": "system", "content": system}, user],
        temperature=0.2,
        max_tokens=600,
    ).strip()

    # Some models may wrap JSON with extra text; best-effort extract the array.
    m = _JSON_ARRAY_RE.search(text)
    if m:
        text = m.group(0)

    data = json.loads(text)
    if not isinstance(data, list):
        return []

    out: list[dict[str, str]] = []
    for item in data[:5]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        command = str(item.get("command", "")).strip()
        explanation = str(item.get("explanation", "")).strip()
        if not title or not command:
            continue
        out.append({"title": title, "command": command, "explanation": explanation})

    return out
