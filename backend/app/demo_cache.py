from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime, timezone

from .local_secrets import SECRETS_DIR
from .models import CommandSuggestion


_CACHE_PATH = SECRETS_DIR / "demo_suggestion_cache.json"
_CACHE_LOCK = threading.Lock()


def _norm(value: str | None) -> str:
    return (value or "").strip()


def _cache_key(
    *,
    build_id: str,
    demo_key: str,
    intent: str,
    platform: str,
    provider: str,
    model: str,
) -> str:
    raw = "\n".join(
        [
            _norm(build_id),
            _norm(demo_key).lower(),
            _norm(intent),
            _norm(platform).lower(),
            _norm(provider).lower(),
            _norm(model),
        ]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _read_store_unlocked() -> dict:
    try:
        data = json.loads(_CACHE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _write_store_unlocked(store: dict) -> None:
    SECRETS_DIR.mkdir(parents=True, exist_ok=True)
    _CACHE_PATH.write_text(
        json.dumps(store, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_demo_suggestions(
    *,
    build_id: str,
    demo_key: str,
    intent: str,
    platform: str,
    provider: str,
    model: str,
) -> list[CommandSuggestion] | None:
    key = _cache_key(
        build_id=build_id,
        demo_key=demo_key,
        intent=intent,
        platform=platform,
        provider=provider,
        model=model,
    )
    with _CACHE_LOCK:
        store = _read_store_unlocked()
        entry = store.get(key)
    if not isinstance(entry, dict):
        return None
    raw_items = entry.get("suggestions")
    if not isinstance(raw_items, list):
        return None
    suggestions: list[CommandSuggestion] = []
    for item in raw_items:
        try:
            suggestions.append(CommandSuggestion.model_validate(item))
        except Exception:
            continue
    return suggestions or None


def save_demo_suggestions(
    *,
    build_id: str,
    demo_key: str,
    intent: str,
    platform: str,
    provider: str,
    model: str,
    suggestions: list[CommandSuggestion],
) -> str:
    key = _cache_key(
        build_id=build_id,
        demo_key=demo_key,
        intent=intent,
        platform=platform,
        provider=provider,
        model=model,
    )
    payload = {
        "build_id": _norm(build_id),
        "demo_key": _norm(demo_key).lower(),
        "intent": _norm(intent),
        "platform": _norm(platform).lower(),
        "provider": _norm(provider).lower(),
        "model": _norm(model),
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "suggestions": [item.model_dump() for item in suggestions],
    }
    with _CACHE_LOCK:
        store = _read_store_unlocked()
        store[key] = payload
        _write_store_unlocked(store)
    return key
