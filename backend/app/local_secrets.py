from __future__ import annotations

from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
REPO_ROOT = APP_ROOT.parent.parent
SECRETS_DIR = REPO_ROOT / ".secrets"
TOKENS_DIR = SECRETS_DIR / "llm_tokens"
EMBEDDING_TOKENS_DIR = SECRETS_DIR / "embedding_tokens"
MODELSCOPE_TOKEN_PATH = SECRETS_DIR / "modelscope_access_token.txt"
MODELSCOPE_MODEL_PATH = SECRETS_DIR / "modelscope_model.txt"
LLM_TOKEN_PATH = SECRETS_DIR / "llm_access_token.txt"
LLM_MODEL_PATH = SECRETS_DIR / "llm_model.txt"
LLM_BASE_URL_PATH = SECRETS_DIR / "llm_base_url.txt"
LLM_PROVIDER_PATH = SECRETS_DIR / "llm_provider.txt"
EMBEDDING_TOKEN_PATH = SECRETS_DIR / "embedding_access_token.txt"
EMBEDDING_MODEL_PATH = SECRETS_DIR / "embedding_model.txt"
EMBEDDING_BASE_URL_PATH = SECRETS_DIR / "embedding_base_url.txt"
EMBEDDING_PROVIDER_PATH = SECRETS_DIR / "embedding_provider.txt"


def _read_text(path: Path) -> str | None:
    try:
        value = path.read_text(encoding="utf-8").strip()
        return value or None
    except FileNotFoundError:
        return None


def _write_text(path: Path, value: str) -> None:
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(value.strip() + "\n", encoding="utf-8")


def _safe_unlink(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        return


def read_llm_provider() -> str | None:
    return _read_text(LLM_PROVIDER_PATH)


def write_llm_provider(provider: str) -> None:
    _write_text(LLM_PROVIDER_PATH, provider)


def _sanitize_key(value: str) -> str:
    s = "".join(ch if ch.isalnum() else "_" for ch in (value or "").strip().lower())
    return s.strip("_") or "default"


def _llm_token_path(base_url: str) -> Path:
    TOKENS_DIR.mkdir(parents=True, exist_ok=True)
    return TOKENS_DIR / f"{_sanitize_key(base_url)}.txt"


def _embedding_token_path(base_url: str) -> Path:
    EMBEDDING_TOKENS_DIR.mkdir(parents=True, exist_ok=True)
    return EMBEDDING_TOKENS_DIR / f"{_sanitize_key(base_url)}.txt"


def read_llm_token(base_url: str) -> str | None:
    return _read_text(_llm_token_path(base_url))


def write_llm_token(base_url: str, token: str) -> None:
    _write_text(_llm_token_path(base_url), token)
    _safe_unlink(LLM_TOKEN_PATH)
    _safe_unlink(MODELSCOPE_TOKEN_PATH)


def read_llm_model() -> str | None:
    # Backward compatible with old modelscope-only secret file.
    return _read_text(LLM_MODEL_PATH) or _read_text(MODELSCOPE_MODEL_PATH)


def write_llm_model(model: str) -> None:
    _write_text(LLM_MODEL_PATH, model)


def read_llm_base_url() -> str | None:
    return _read_text(LLM_BASE_URL_PATH)


def write_llm_base_url(base_url: str) -> None:
    _write_text(LLM_BASE_URL_PATH, base_url)


def read_modelscope_token(base_url: str) -> str | None:
    return read_llm_token(base_url)


def write_modelscope_token(base_url: str, token: str) -> None:
    write_llm_token(base_url, token)


def read_modelscope_model() -> str | None:
    return read_llm_model()


def write_modelscope_model(model: str) -> None:
    write_llm_model(model)


def has_modelscope_token(base_url: str) -> bool:
    return read_llm_token(base_url) is not None


def has_llm_token(base_url: str) -> bool:
    return read_llm_token(base_url) is not None


def read_embedding_provider() -> str | None:
    return _read_text(EMBEDDING_PROVIDER_PATH)


def write_embedding_provider(provider: str) -> None:
    _write_text(EMBEDDING_PROVIDER_PATH, provider)


def read_embedding_token(base_url: str) -> str | None:
    return _read_text(_embedding_token_path(base_url)) or _read_text(EMBEDDING_TOKEN_PATH)


def write_embedding_token(base_url: str, token: str) -> None:
    _write_text(_embedding_token_path(base_url), token)
    _write_text(EMBEDDING_TOKEN_PATH, token)


def read_embedding_model() -> str | None:
    return _read_text(EMBEDDING_MODEL_PATH)


def write_embedding_model(model: str) -> None:
    _write_text(EMBEDDING_MODEL_PATH, model)


def read_embedding_base_url() -> str | None:
    return _read_text(EMBEDDING_BASE_URL_PATH)


def write_embedding_base_url(base_url: str) -> None:
    _write_text(EMBEDDING_BASE_URL_PATH, base_url)


def has_embedding_token(base_url: str) -> bool:
    return read_embedding_token(base_url) is not None
