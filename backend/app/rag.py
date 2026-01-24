from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .models import Citation


@dataclass(frozen=True)
class Doc:
    title: str
    text: str


def _repo_root() -> Path:
    # .../backend/app/rag.py -> repo root at parents[2]
    return Path(__file__).resolve().parents[2]


def _iter_markdown_files() -> list[Path]:
    root = _repo_root() / "docs" / "runbook"
    if not root.exists():
        return []
    return sorted(root.rglob("*.md"))


@lru_cache(maxsize=1)
def _load_docs() -> list[Doc]:
    docs: list[Doc] = []
    for p in _iter_markdown_files():
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        title = p.name
        m = re.search(r"^#\s+(.+)$", text, flags=re.MULTILINE)
        if m:
            title = m.group(1).strip()
        docs.append(Doc(title=title, text=text))
    return docs


def _tokenize(q: str) -> list[str]:
    q = (q or "").lower()
    parts = re.split(r"[^\w\u4e00-\u9fff]+", q)
    toks = [p for p in parts if len(p) >= 2]
    return toks[:12]


def _score(doc: Doc, tokens: list[str]) -> int:
    t = doc.text.lower()
    score = 0
    for tok in tokens:
        c = t.count(tok)
        if c:
            score += min(5, c) * (3 if len(tok) >= 4 else 1)
    return score


def _token_hits(doc: Doc, tokens: list[str]) -> int:
    t = doc.text.lower()
    hits = 0
    for tok in tokens:
        if tok and tok in t:
            hits += 1
    return hits


def _snippet(text: str, tokens: list[str], max_len: int = 200) -> str:
    low = text.lower()
    idx = -1
    for tok in tokens:
        idx = low.find(tok)
        if idx != -1:
            break
    if idx == -1:
        s = text.strip().replace("\n", " ")
        return (s[: max_len - 1] + "…") if len(s) > max_len else s

    start = max(0, idx - 60)
    end = min(len(text), idx + 140)
    s = text[start:end].strip().replace("\n", " ")
    if start > 0:
        s = "…" + s
    if end < len(text):
        s = s + "…"
    if len(s) > max_len:
        s = s[: max_len - 1] + "…"
    return s


def retrieve(query: str, *, limit: int = 2, min_score: int = 6, min_hits: int = 2) -> list[Citation]:
    tokens = _tokenize(query)
    if not tokens:
        return []

    scored: list[tuple[int, int, Doc]] = []
    for d in _load_docs():
        s = _score(d, tokens)
        if s <= 0:
            continue
        h = _token_hits(d, tokens)
        scored.append((s, h, d))

    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    if not scored:
        return []

    # Relevance gate: if top doc is weakly related, don't show any citations.
    top_score, top_hits, _ = scored[0]
    if top_score < min_score or top_hits < min_hits:
        return []

    out: list[Citation] = []
    for s, h, d in scored[:limit]:
        if s < min_score or h < min_hits:
            continue
        out.append(Citation(title=d.title, snippet=_snippet(d.text, tokens)))
    return out
