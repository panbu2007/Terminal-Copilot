from __future__ import annotations

from pathlib import Path


APP_ROOT = Path(__file__).resolve().parent
REPO_ROOT = APP_ROOT.parent.parent
SECRETS_DIR = REPO_ROOT / ".secrets"
MODELSCOPE_TOKEN_PATH = SECRETS_DIR / "modelscope_access_token.txt"
MODELSCOPE_MODEL_PATH = SECRETS_DIR / "modelscope_model.txt"


def read_modelscope_token() -> str | None:
    try:
        token = MODELSCOPE_TOKEN_PATH.read_text(encoding="utf-8").strip()
        return token or None
    except FileNotFoundError:
        return None


def write_modelscope_token(token: str) -> None:
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    MODELSCOPE_TOKEN_PATH.write_text(token.strip() + "\n", encoding="utf-8")


def read_modelscope_model() -> str | None:
    try:
        model = MODELSCOPE_MODEL_PATH.read_text(encoding="utf-8").strip()
        return model or None
    except FileNotFoundError:
        return None


def write_modelscope_model(model: str) -> None:
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    MODELSCOPE_MODEL_PATH.write_text(model.strip() + "\n", encoding="utf-8")


def has_modelscope_token() -> bool:
    return read_modelscope_token() is not None
