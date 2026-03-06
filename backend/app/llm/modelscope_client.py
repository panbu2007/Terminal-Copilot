from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

from ..local_secrets import (
    read_llm_base_url,
    read_llm_model,
    read_llm_provider,
    read_llm_token,
)


logger = logging.getLogger("terminal_copilot.llm")
DEFAULT_TIMEOUT_SECONDS = 20.0


@dataclass(frozen=True)
class ProviderMeta:
    name: str
    default_base_url: str
    default_model: str
    token_env_keys: tuple[str, ...]
    model_env_key: str
    base_url_env_key: str
    timeout_env_key: str


@dataclass(frozen=True)
class LlmRuntimeConfig:
    provider: str
    access_token: str
    base_url: str
    model: str
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS


PROVIDERS: dict[str, ProviderMeta] = {
    "modelscope": ProviderMeta(
        name="modelscope",
        default_base_url="https://api-inference.modelscope.cn/v1/",
        default_model="moonshotai/Kimi-K2.5",
        token_env_keys=(
            "TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN",
            "MODELSCOPE_ACCESS_TOKEN",
        ),
        model_env_key="TERMINAL_COPILOT_MODELSCOPE_MODEL",
        base_url_env_key="TERMINAL_COPILOT_MODELSCOPE_BASE_URL",
        timeout_env_key="TERMINAL_COPILOT_MODELSCOPE_TIMEOUT",
    ),
    "kimi": ProviderMeta(
        name="kimi",
        default_base_url="https://api.moonshot.cn/v1/",
        default_model="kimi-k2.5",
        token_env_keys=(
            "TERMINAL_COPILOT_KIMI_ACCESS_TOKEN",
            "KIMI_API_KEY",
            "MOONSHOT_API_KEY",
        ),
        model_env_key="TERMINAL_COPILOT_KIMI_MODEL",
        base_url_env_key="TERMINAL_COPILOT_KIMI_BASE_URL",
        timeout_env_key="TERMINAL_COPILOT_KIMI_TIMEOUT",
    ),
    "siliconflow": ProviderMeta(
        name="siliconflow",
        default_base_url="https://api.siliconflow.cn/v1/",
        default_model="moonshotai/Kimi-K2.5",
        token_env_keys=(
            "TERMINAL_COPILOT_SILICONFLOW_ACCESS_TOKEN",
            "SILICONFLOW_API_KEY",
        ),
        model_env_key="TERMINAL_COPILOT_SILICONFLOW_MODEL",
        base_url_env_key="TERMINAL_COPILOT_SILICONFLOW_BASE_URL",
        timeout_env_key="TERMINAL_COPILOT_SILICONFLOW_TIMEOUT",
    ),
    "custom": ProviderMeta(
        name="custom",
        default_base_url="",
        default_model="",
        token_env_keys=(
            "TERMINAL_COPILOT_LLM_ACCESS_TOKEN",
        ),
        model_env_key="TERMINAL_COPILOT_LLM_MODEL",
        base_url_env_key="TERMINAL_COPILOT_LLM_BASE_URL",
        timeout_env_key="TERMINAL_COPILOT_LLM_TIMEOUT",
    ),
}

PROVIDER_ALIASES = {
    "moonshot": "kimi",
    "moonshotai": "kimi",
    "ms": "modelscope",
    "sf": "siliconflow",
    "openai-compatible": "custom",
}


def normalize_provider(provider: str | None) -> str:
    raw = (provider or "").strip().lower()
    if not raw:
        return "modelscope"
    raw = PROVIDER_ALIASES.get(raw, raw)
    return raw if raw in PROVIDERS else "modelscope"


def _provider_meta(provider: str | None) -> ProviderMeta:
    p = normalize_provider(provider)
    return PROVIDERS.get(p, PROVIDERS["modelscope"])


def _active_provider(provider_override: str | None = None) -> str:
    if provider_override is not None and provider_override.strip():
        return normalize_provider(provider_override)
    return normalize_provider(
        os.getenv("TERMINAL_COPILOT_LLM_PROVIDER") or read_llm_provider()
    )


def _first_nonempty(values: list[str | None]) -> str:
    for v in values:
        if v is None:
            continue
        s = v.strip()
        if s:
            return s
    return ""


def _ensure_base_url(base_url: str) -> str:
    s = (base_url or "").strip()
    if not s:
        return s
    return s if s.endswith("/") else s + "/"


def resolve_llm_config(
    *,
    provider_override: str | None = None,
    access_token_override: str | None = None,
    model_override: str | None = None,
    base_url_override: str | None = None,
    require_token: bool = True,
) -> LlmRuntimeConfig | None:
    provider = _active_provider(provider_override)
    meta = _provider_meta(provider)

    model = _first_nonempty(
        [
            model_override,
            os.getenv("TERMINAL_COPILOT_LLM_MODEL"),
            os.getenv(meta.model_env_key),
            read_llm_model(),
            meta.default_model,
        ]
    )

    base_url = _first_nonempty(
        [
            base_url_override,
            os.getenv("TERMINAL_COPILOT_LLM_BASE_URL"),
            os.getenv(meta.base_url_env_key),
            read_llm_base_url(),
            meta.default_base_url,
        ]
    )
    base_url = _ensure_base_url(base_url)

    token = _first_nonempty(
        [
            access_token_override,
            os.getenv("TERMINAL_COPILOT_LLM_ACCESS_TOKEN"),
            *[os.getenv(k) for k in meta.token_env_keys],
            read_llm_token(base_url),
        ]
    )

    timeout_raw = _first_nonempty(
        [
            os.getenv("TERMINAL_COPILOT_LLM_TIMEOUT"),
            os.getenv(meta.timeout_env_key),
            str(DEFAULT_TIMEOUT_SECONDS),
        ]
    )
    try:
        timeout = float(timeout_raw)
    except ValueError:
        timeout = DEFAULT_TIMEOUT_SECONDS

    cfg = LlmRuntimeConfig(
        provider=provider,
        access_token=token,
        base_url=base_url,
        model=model,
        timeout_seconds=timeout,
    )
    if require_token and not cfg.access_token:
        return None
    return cfg


def _env_config() -> LlmRuntimeConfig | None:
    return resolve_llm_config(require_token=True)


def modelscope_is_configured() -> bool:
    return _env_config() is not None


def llm_is_configured() -> bool:
    return _env_config() is not None


def modelscope_chat_with_tools(
    messages: list[dict],
    *,
    tools: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 800,
) -> tuple[str, list[dict]]:
    """Call selected OpenAI-compatible chat/completions with function calling enabled."""
    cfg = _env_config()
    if cfg is None:
        raise RuntimeError("llm_token_missing")

    t0 = time.perf_counter()
    logger.info(
        "llm_chat_with_tools start provider=%s model=%s messages=%s tools=%s temp=%s max_tokens=%s",
        cfg.provider,
        cfg.model,
        len(messages or []),
        len(tools or []),
        temperature,
        max_tokens,
    )

    url = cfg.base_url + "chat/completions"
    payload: dict = {
        "model": cfg.model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

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
        logger.warning(
            "llm_chat_with_tools http_error provider=%s code=%s model=%s detail=%s",
            cfg.provider,
            getattr(e, "code", "error"),
            cfg.model,
            detail[:200],
        )
        raise RuntimeError(
            f"{cfg.provider}_http_{getattr(e, 'code', 'error')}: {detail[:400]}"
        ) from e
    except urllib.error.URLError as e:
        logger.warning(
            "llm_chat_with_tools network_error provider=%s model=%s err=%s",
            cfg.provider,
            cfg.model,
            e,
        )
        raise RuntimeError(f"{cfg.provider}_network_error: {e}") from e

    try:
        data = json.loads(body)
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError(f"{cfg.provider}_empty_choices")
        first = choices[0]
        msg = first.get("message", {}) if isinstance(first, dict) else {}
        content = msg.get("content") or ""
        tool_calls = msg.get("tool_calls") or []
        logger.info(
            "llm_chat_with_tools done provider=%s model=%s cost=%sms content_len=%s tool_calls=%s",
            cfg.provider,
            cfg.model,
            int((time.perf_counter() - t0) * 1000),
            len(str(content)),
            len(tool_calls if isinstance(tool_calls, list) else []),
        )
        return str(content), tool_calls
    except RuntimeError:
        raise
    except Exception as e:
        logger.warning(
            "llm_chat_with_tools bad_response provider=%s model=%s err=%s",
            cfg.provider,
            cfg.model,
            e,
        )
        raise RuntimeError(
            f"{cfg.provider}_bad_response: {e}; body={body[:400]}"
        ) from e


def modelscope_chat_completion(
    messages: list[dict[str, str]], *, temperature: float = 0.2, max_tokens: int = 512
) -> str:
    """Call selected OpenAI-compatible chat completions."""
    cfg = _env_config()
    if cfg is None:
        raise RuntimeError("llm_token_missing")
    t0 = time.perf_counter()
    logger.info(
        "llm_chat_completion start provider=%s model=%s messages=%s temp=%s max_tokens=%s",
        cfg.provider,
        cfg.model,
        len(messages or []),
        temperature,
        max_tokens,
    )

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
        logger.warning(
            "llm_chat_completion http_error provider=%s code=%s model=%s detail=%s",
            cfg.provider,
            getattr(e, "code", "error"),
            cfg.model,
            detail[:200],
        )
        raise RuntimeError(
            f"{cfg.provider}_http_{getattr(e, 'code', 'error')}: {detail[:400]}"
        ) from e
    except urllib.error.URLError as e:
        logger.warning(
            "llm_chat_completion network_error provider=%s model=%s err=%s",
            cfg.provider,
            cfg.model,
            e,
        )
        raise RuntimeError(f"{cfg.provider}_network_error: {e}") from e

    try:
        data = json.loads(body)
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices:
            raise RuntimeError(f"{cfg.provider}_empty_choices")
        first = choices[0] if isinstance(choices[0], dict) else {}
        msg = first.get("message") if isinstance(first, dict) else None
        if not isinstance(msg, dict):
            raise RuntimeError(f"{cfg.provider}_missing_message")
        content = msg.get("content", "")
        if content is None:
            return ""
        if not isinstance(content, str):
            return str(content)
        logger.info(
            "llm_chat_completion done provider=%s model=%s cost=%sms content_len=%s",
            cfg.provider,
            cfg.model,
            int((time.perf_counter() - t0) * 1000),
            len(content),
        )
        return content
    except RuntimeError:
        raise
    except Exception as e:
        logger.warning(
            "llm_chat_completion bad_response provider=%s model=%s err=%s",
            cfg.provider,
            cfg.model,
            e,
        )
        raise RuntimeError(
            f"{cfg.provider}_bad_response: {str(e)}; body={body[:400]}"
        ) from e


_JSON_ARRAY_RE = re.compile(r"\[[\s\S]*\]", re.MULTILINE)


def modelscope_chat_json_suggestions(
    *,
    user_intent: str,
    platform: str | None,
    last_stdout: str,
    last_stderr: str,
) -> list[dict[str, str]]:
    """Ask the LLM for next-command suggestions and parse strict JSON."""

    system = (
        "浣犳槸涓€涓粓绔懡浠ゅ姪鎵嬨€傛牴鎹敤鎴锋剰鍥?涓婁笅鏂囷紝缁欏嚭涓嬩竴姝ュ彲鎵ц鍛戒护銆俓n"
        "瑕佹眰锛歕n"
        "- 鍙繑鍥炰弗鏍?JSON 鏁扮粍锛堜笉瑕佷唬鐮佸潡/涓嶈澶氫綑鏂囧瓧锛塡n"
        '- 姣忎釜鍏冪礌鏄璞★紝鏈€灏戝寘鍚細{"title":..., "command":...}\n'
        "- 鍙€夊瓧娈碉細explanation, why, risk, rollback, verify锛堥兘涓哄瓧绗︿覆锛塡n"
        "- 鍛戒护瑕佸敖閲忔渶灏忋€佸畨鍏ㄣ€佸彲閫嗭紱閬垮厤鐮村潖鎬у懡浠わ紙rm -rf銆乵kfs銆佸叧鏈虹瓑锛塡n"
        "- 鏈€澶?5 鏉″缓璁甛n"
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
        why = str(item.get("why", "")).strip()
        risk = str(item.get("risk", "")).strip()
        rollback = str(item.get("rollback", "")).strip()
        verify = str(item.get("verify", "")).strip()
        if not title or not command:
            continue
        out.append(
            {
                "title": title,
                "command": command,
                "explanation": explanation,
                "why": why,
                "risk": risk,
                "rollback": rollback,
                "verify": verify,
            }
        )

    return out
