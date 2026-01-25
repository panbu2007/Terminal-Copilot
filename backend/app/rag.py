from __future__ import annotations

import re
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .models import Citation


@dataclass(frozen=True)
class Doc:
    title: str
    text: str
    source: str
    keywords: tuple[str, ...] = ()


def _repo_root() -> Path:
    # .../backend/app/rag.py -> repo root at parents[2]
    return Path(__file__).resolve().parents[2]


def _iter_markdown_files() -> list[Path]:
    repo = _repo_root()
    docs_dir = repo / "docs"
    runbook_dir = docs_dir / "runbook"

    files: list[Path] = []
    # Primary: curated runbooks
    if runbook_dir.exists():
        files.extend(runbook_dir.rglob("*.md"))

    # Secondary: curated top-level docs (exclude demo scripts to avoid noisy citations)
    # Do NOT rglob docs_dir to avoid duplicating runbook files.
    if docs_dir.exists():
        for p in docs_dir.glob("*.md"):
            name = p.name.lower()
            if name.startswith("demo-"):
                continue
            if name in {"judge-script.md"}:
                continue
            files.append(p)

    # De-duplicate and keep stable order
    uniq = sorted({p.resolve() for p in files if p.exists()})
    return uniq


@lru_cache(maxsize=1)
def _load_docs() -> list[Doc]:
    docs: list[Doc] = []
    repo = _repo_root()
    for p in _iter_markdown_files():
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        title = p.name
        m = re.search(r"^#\s+(.+)$", text, flags=re.MULTILINE)
        if m:
            title = m.group(1).strip()
        try:
            rel = p.resolve().relative_to(repo).as_posix()
        except Exception:
            rel = p.name
        kws = tuple(_extract_keyword_tokens(text))
        docs.append(Doc(title=title, text=text, source=rel, keywords=kws))
    return docs


_KW_HEADER_RE = re.compile(r"^\s*(#{1,6}\s*)?(关键词|keywords)\s*[:：]?\s*$", re.IGNORECASE)


def _extract_keyword_tokens(text: str) -> list[str]:
    """Extract keyword tokens from a markdown text.

    Supports:
      - A standalone line like: "关键词：" then lines below.
      - A heading like: "## 关键词" then lines below.

    Returns normalized tokens suitable for matching with _tokenize().
    """

    lines = (text or "").splitlines()
    start = -1
    for i, raw in enumerate(lines):
        if _KW_HEADER_RE.match(raw.strip()):
            start = i + 1
            break
    if start < 0:
        return []

    buf: list[str] = []
    for raw in lines[start:]:
        line = raw.strip()
        if not line:
            if buf:
                break
            continue
        if line.startswith("#"):
            break
        # strip common bullet markers
        if line.startswith(("- ", "* ")):
            line = line[2:].strip()
        # split common separators
        for part in re.split(r"[，,、;；]", line):
            part = part.strip()
            if part:
                buf.append(part)

    # Tokenize keyword phrases into matching tokens
    out: list[str] = []
    seen = set()
    for phrase in buf:
        for tok in _tokenize(phrase):
            if tok in seen:
                continue
            seen.add(tok)
            out.append(tok)
    return out


def _tokenize(q: str) -> list[str]:
    q = (q or "").lower()
    parts = re.split(r"[^\w\u4e00-\u9fff]+", q)
    toks = [p for p in parts if len(p) >= 2]
    return toks[:12]


def _score(doc: Doc, tokens: list[str]) -> int:
    t = doc.text.lower()
    title = (doc.title or "").lower()
    kw = set(doc.keywords or ())
    score = 0
    for tok in tokens:
        c = t.count(tok)
        if c:
            score += min(5, c) * (3 if len(tok) >= 4 else 1)
        # Title match is a small hint (helps disambiguate when docs are similar)
        if tok and tok in title:
            score += 4
        # Keyword match is a strong signal (curated, reduces noisy matches)
        if tok and tok in kw:
            score += 18
    return score


def _keyword_match_count(doc: Doc, tokens: list[str]) -> int:
    if not doc.keywords:
        return 0
    kw = set(doc.keywords)
    return sum(1 for tok in tokens if tok in kw)


def _title_match_count(doc: Doc, tokens: list[str]) -> int:
    title = (doc.title or "").lower()
    return sum(1 for tok in tokens if tok and tok in title)


def _auto_thresholds(tokens: list[str], *, base_min_score: int, base_min_hits: int) -> tuple[int, int]:
    """Heuristic thresholds.

    Only applied when caller uses the default thresholds.
    - Short queries are ambiguous: require stronger evidence.
    - Longer queries are specific: allow slightly looser gating.
    """

    min_score = base_min_score
    min_hits = base_min_hits

    n = len(tokens)
    if n <= 0:
        return min_score, min_hits

    if n == 1:
        # Very ambiguous; require stronger score, but allow 1 hit.
        return max(min_score, 20), 1
    if n == 2:
        return max(min_score, 18), 2
    if n <= 4:
        return max(min_score, 10), max(min_hits, 2)
    return max(min_score, 8), max(min_hits, 2)


def _rerank(scored: list[tuple[int, int, Doc]], tokens: list[str]) -> list[tuple[int, int, Doc]]:
    """Lightweight rerank: prefer keyword/title matches.

    This improves relevance without extra dependencies.
    """

    def key(item: tuple[int, int, Doc]) -> tuple[int, int, int, int]:
        s, h, d = item
        kw_m = _keyword_match_count(d, tokens)
        title_m = _title_match_count(d, tokens)
        # Keep primary score dominant; use keyword/title as a small boost.
        boosted = s + (kw_m * 12) + (title_m * 4)
        return (boosted, h, kw_m, title_m)

    return sorted(scored, key=key, reverse=True)


def _token_hits(doc: Doc, tokens: list[str]) -> int:
    t = doc.text.lower()
    kw = set(doc.keywords or ())
    hits = 0
    for tok in tokens:
        if tok and (tok in t or tok in kw):
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

    base_min_score = min_score
    base_min_hits = min_hits
    # Apply auto thresholds only when caller uses defaults.
    if base_min_score == 6 and base_min_hits == 2:
        min_score, min_hits = _auto_thresholds(tokens, base_min_score=base_min_score, base_min_hits=base_min_hits)

    scored: list[tuple[int, int, Doc]] = []
    for d in _load_docs():
        s = _score(d, tokens)
        if s <= 0:
            continue
        h = _token_hits(d, tokens)
        scored.append((s, h, d))

    if not scored:
        return []

    # Two-stage ranking: first take topK by primary score/hits, then rerank by keyword/title matches.
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    topk = int(os.getenv("TERMINAL_COPILOT_RAG_TOPK", "10"))
    scored = scored[: max(1, topk)]
    scored = _rerank(scored, tokens)
    if not scored:
        return []

    primary_top_score, primary_top_hits, _ = scored[0]

    # Relevance gate: if top doc is weakly related, don't show any citations.
    if primary_top_score < min_score or primary_top_hits < min_hits:
        return []

    out: list[Citation] = []
    for s, h, d in scored[:limit]:
        if s < min_score or h < min_hits:
            continue
        out.append(Citation(title=d.title, snippet=_snippet(d.text, tokens), source=d.source))
    return out
