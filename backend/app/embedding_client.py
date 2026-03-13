from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

from .local_secrets import (
    read_embedding_base_url,
    read_embedding_model,
    read_embedding_provider,
    read_embedding_token,
    read_llm_token,
)


logger = logging.getLogger("terminal_copilot.embedding")
DEFAULT_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True)
class EmbeddingProviderMeta:
    name: str
    default_base_url: str
    default_model: str
    token_env_keys: tuple[str, ...]
    model_env_key: str
    base_url_env_key: str
    timeout_env_key: str


@dataclass(frozen=True)
class EmbeddingRuntimeConfig:
    provider: str
    access_token: str
    base_url: str
    model: str
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS


EMBEDDING_PROVIDERS: dict[str, EmbeddingProviderMeta] = {
    "modelscope": EmbeddingProviderMeta(
        name="modelscope",
        default_base_url="https://api-inference.modelscope.cn/v1/embeddings",
        default_model="BAAI/bge-small-zh-v1.5",
        token_env_keys=(
            "TERMINAL_COPILOT_MODELSCOPE_ACCESS_TOKEN",
            "MODELSCOPE_ACCESS_TOKEN",
        ),
        model_env_key="TERMINAL_COPILOT_MODELSCOPE_EMBEDDING_MODEL",
        base_url_env_key="TERMINAL_COPILOT_MODELSCOPE_EMBEDDING_BASE_URL",
        timeout_env_key="TERMINAL_COPILOT_MODELSCOPE_EMBEDDING_TIMEOUT",
    ),
    "dashscope": EmbeddingProviderMeta(
        name="dashscope",
        default_base_url="https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding",
        default_model="text-embedding-v4",
        token_env_keys=(
            "TERMINAL_COPILOT_DASHSCOPE_API_KEY",
            "DASHSCOPE_API_KEY",
        ),
        model_env_key="TERMINAL_COPILOT_DASHSCOPE_EMBEDDING_MODEL",
        base_url_env_key="TERMINAL_COPILOT_DASHSCOPE_EMBEDDING_BASE_URL",
        timeout_env_key="TERMINAL_COPILOT_DASHSCOPE_EMBEDDING_TIMEOUT",
    ),
}

EMBEDDING_PROVIDER_ALIASES = {
    "aliyun": "dashscope",
    "bailian": "dashscope",
    "aliyun-bailian": "dashscope",
    "ms": "modelscope",
}


def normalize_embedding_provider(provider: str | None) -> str:
    raw = (provider or "").strip().lower()
    if not raw:
        return "modelscope"
    raw = EMBEDDING_PROVIDER_ALIASES.get(raw, raw)
    return raw if raw in EMBEDDING_PROVIDERS else "modelscope"


def _provider_meta(provider: str | None) -> EmbeddingProviderMeta:
    p = normalize_embedding_provider(provider)
    return EMBEDDING_PROVIDERS.get(p, EMBEDDING_PROVIDERS["modelscope"])


def _first_nonempty(values: list[str | None]) -> str:
    for value in values:
        if value is None:
            continue
        text = value.strip()
        if text:
            return text
    return ""


def resolve_embedding_config(
    *,
    provider_override: str | None = None,
    access_token_override: str | None = None,
    model_override: str | None = None,
    base_url_override: str | None = None,
    require_token: bool = True,
) -> EmbeddingRuntimeConfig | None:
    provider = normalize_embedding_provider(
        provider_override
        or os.getenv("TERMINAL_COPILOT_EMBEDDING_PROVIDER")
        or read_embedding_provider()
    )
    meta = _provider_meta(provider)

    model = _first_nonempty(
        [
            model_override,
            os.getenv("TERMINAL_COPILOT_EMBEDDING_MODEL"),
            os.getenv(meta.model_env_key),
            read_embedding_model(),
            meta.default_model,
        ]
    )
    base_url = _first_nonempty(
        [
            base_url_override,
            os.getenv("TERMINAL_COPILOT_EMBEDDING_BASE_URL"),
            os.getenv(meta.base_url_env_key),
            read_embedding_base_url(),
            meta.default_base_url,
        ]
    )
    token = _first_nonempty(
        [
            access_token_override,
            os.getenv("TERMINAL_COPILOT_EMBEDDING_ACCESS_TOKEN"),
            *[os.getenv(key) for key in meta.token_env_keys],
            read_embedding_token(base_url),
            read_llm_token(base_url),
        ]
    )
    timeout_raw = _first_nonempty(
        [
            os.getenv("TERMINAL_COPILOT_EMBEDDING_TIMEOUT"),
            os.getenv(meta.timeout_env_key),
            str(DEFAULT_TIMEOUT_SECONDS),
        ]
    )
    try:
        timeout = float(timeout_raw)
    except ValueError:
        timeout = DEFAULT_TIMEOUT_SECONDS

    cfg = EmbeddingRuntimeConfig(
        provider=provider,
        access_token=token,
        base_url=base_url,
        model=model,
        timeout_seconds=timeout,
    )
    if require_token and not cfg.access_token:
        return None
    return cfg


def _dashscope_payload(model: str, text: str) -> dict:
    return {
        "model": model,
        "input": {
            "texts": [text],
        },
    }


def _modelscope_payload(model: str, text: str) -> dict:
    return {
        "model": model,
        "input": [text],
    }


def embed_text(
    text: str,
    *,
    provider_override: str | None = None,
    access_token_override: str | None = None,
    model_override: str | None = None,
    base_url_override: str | None = None,
) -> list[float] | None:
    cfg = resolve_embedding_config(
        provider_override=provider_override,
        access_token_override=access_token_override,
        model_override=model_override,
        base_url_override=base_url_override,
        require_token=True,
    )
    if cfg is None:
        return None

    payload = (
        _dashscope_payload(cfg.model, text)
        if cfg.provider == "dashscope"
        else _modelscope_payload(cfg.model, text)
    )
    req = urllib.request.Request(
        cfg.base_url,
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
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore") if hasattr(exc, "read") else ""
        logger.debug(
            "embed_text http_error provider=%s model=%s code=%s detail=%s",
            cfg.provider,
            cfg.model,
            getattr(exc, "code", "error"),
            detail[:200],
        )
        return None
    except Exception as exc:
        logger.debug(
            "embed_text network_error provider=%s model=%s err=%s",
            cfg.provider,
            cfg.model,
            exc,
        )
        return None

    try:
        data = json.loads(body)
        if cfg.provider == "dashscope":
            return data["output"]["embeddings"][0]["embedding"]
        return data["data"][0]["embedding"]
    except Exception as exc:
        logger.debug(
            "embed_text parse_error provider=%s model=%s err=%s body=%s",
            cfg.provider,
            cfg.model,
            exc,
            body[:200],
        )
        return None
