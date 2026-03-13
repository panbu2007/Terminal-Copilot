from __future__ import annotations

import math
import re
import os
from collections import Counter
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


@dataclass(frozen=True)
class IndexedDoc:
    doc: Doc
    body_tf: Counter[str]
    title_tf: Counter[str]
    keyword_tf: Counter[str]
    body_len: int
    title_len: int
    keyword_len: int


@dataclass(frozen=True)
class Bm25Index:
    docs: tuple[IndexedDoc, ...]
    body_df: dict[str, int]
    title_df: dict[str, int]
    keyword_df: dict[str, int]
    avg_body_len: float
    avg_title_len: float
    avg_keyword_len: float


def _repo_root() -> Path:
    # .../backend/app/rag.py -> repo root at parents[2]
    return Path(__file__).resolve().parents[2]


def _iter_markdown_files() -> list[Path]:
    runbook_dir = _repo_root() / "docs" / "runbook"

    files: list[Path] = []
    # Only index runbooks. Top-level docs are developer documents, not runtime retrieval material.
    if runbook_dir.exists():
        files.extend(runbook_dir.rglob("*.md"))

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


def refresh_docs_cache() -> None:
    _load_docs.cache_clear()
    _build_bm25_index.cache_clear()


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
        for tok in _tokenize(phrase, max_tokens=None):
            if tok in seen:
                continue
            seen.add(tok)
            out.append(tok)
    return out


def _tokenize(q: str, *, max_tokens: int | None = 12) -> list[str]:
    q = (q or "").lower()
    parts = re.split(r"[^\w\u4e00-\u9fff]+", q)
    toks = [p for p in parts if len(p) >= 2]
    if max_tokens is None:
        return toks
    return toks[:max_tokens]


@lru_cache(maxsize=1)
def _build_bm25_index() -> Bm25Index:
    docs = _load_docs()
    indexed_docs: list[IndexedDoc] = []
    body_df: Counter[str] = Counter()
    title_df: Counter[str] = Counter()
    keyword_df: Counter[str] = Counter()
    total_body_len = 0
    total_title_len = 0
    total_keyword_len = 0

    for doc in docs:
        body_tokens = _tokenize(doc.text, max_tokens=None)
        title_tokens = _tokenize(doc.title, max_tokens=None)
        keyword_tokens = list(doc.keywords or ())

        body_tf = Counter(body_tokens)
        title_tf = Counter(title_tokens)
        keyword_tf = Counter(keyword_tokens)

        body_df.update(body_tf.keys())
        title_df.update(title_tf.keys())
        keyword_df.update(keyword_tf.keys())

        total_body_len += len(body_tokens)
        total_title_len += len(title_tokens)
        total_keyword_len += len(keyword_tokens)

        indexed_docs.append(
            IndexedDoc(
                doc=doc,
                body_tf=body_tf,
                title_tf=title_tf,
                keyword_tf=keyword_tf,
                body_len=len(body_tokens),
                title_len=len(title_tokens),
                keyword_len=len(keyword_tokens),
            )
        )

    count = max(1, len(indexed_docs))
    return Bm25Index(
        docs=tuple(indexed_docs),
        body_df=dict(body_df),
        title_df=dict(title_df),
        keyword_df=dict(keyword_df),
        avg_body_len=total_body_len / count,
        avg_title_len=total_title_len / count,
        avg_keyword_len=total_keyword_len / count,
    )


def _bm25_term_score(
    tf: int,
    *,
    doc_len: int,
    avg_doc_len: float,
    doc_count: int,
    doc_freq: int,
    k1: float = 1.5,
    b: float = 0.75,
) -> float:
    if tf <= 0 or doc_freq <= 0 or doc_count <= 0:
        return 0.0
    avg_len = avg_doc_len if avg_doc_len > 0 else 1.0
    norm = k1 * (1.0 - b + b * (doc_len / avg_len if doc_len > 0 else 0.0))
    idf = math.log(1.0 + ((doc_count - doc_freq + 0.5) / (doc_freq + 0.5)))
    return idf * ((tf * (k1 + 1.0)) / (tf + norm))


def _bm25_score(index: Bm25Index, item: IndexedDoc, tokens: list[str]) -> float:
    score = 0.0
    doc_count = len(index.docs)
    for tok in tokens:
        score += _bm25_term_score(
            item.body_tf.get(tok, 0),
            doc_len=item.body_len,
            avg_doc_len=index.avg_body_len,
            doc_count=doc_count,
            doc_freq=index.body_df.get(tok, 0),
        )
        score += 1.8 * _bm25_term_score(
            item.title_tf.get(tok, 0),
            doc_len=item.title_len,
            avg_doc_len=index.avg_title_len,
            doc_count=doc_count,
            doc_freq=index.title_df.get(tok, 0),
            k1=1.2,
            b=0.0,
        )
        score += 2.5 * _bm25_term_score(
            item.keyword_tf.get(tok, 0),
            doc_len=item.keyword_len,
            avg_doc_len=index.avg_keyword_len,
            doc_count=doc_count,
            doc_freq=index.keyword_df.get(tok, 0),
            k1=1.0,
            b=0.0,
        )
    return score


def _keyword_match_count(doc: Doc, tokens: list[str]) -> int:
    if not doc.keywords:
        return 0
    kw = set(doc.keywords)
    return sum(1 for tok in tokens if tok in kw)


def _title_match_count(doc: Doc, tokens: list[str]) -> int:
    title = (doc.title or "").lower()
    return sum(1 for tok in tokens if tok and tok in title)


def _auto_thresholds(tokens: list[str], *, base_min_score: float, base_min_hits: int) -> tuple[float, int]:
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
        return max(min_score, 1.8), 1
    if n == 2:
        return max(min_score, 1.2), 2
    if n <= 4:
        return max(min_score, 0.8), max(min_hits, 2)
    return max(min_score, 0.6), max(min_hits, 2)


def _rerank(scored: list[tuple[float, int, Doc]], tokens: list[str]) -> list[tuple[float, int, Doc]]:
    """Lightweight rerank: prefer keyword/title matches.

    This improves relevance without extra dependencies.
    """

    def key(item: tuple[float, int, Doc]) -> tuple[float, int, int, int]:
        s, h, d = item
        kw_m = _keyword_match_count(d, tokens)
        title_m = _title_match_count(d, tokens)
        # Keep BM25 dominant; use keyword/title as a small boost.
        boosted = s + (h * 0.45) + (kw_m * 0.9) + (title_m * 0.35)
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


def retrieve(query: str, *, limit: int = 2, min_score: float = 0.0, min_hits: int = 2) -> list[Citation]:
    tokens = _tokenize(query)
    if not tokens:
        return []

    base_min_score = min_score
    base_min_hits = min_hits
    # Apply auto thresholds only when caller uses defaults.
    if base_min_score == 0.0 and base_min_hits == 2:
        min_score, min_hits = _auto_thresholds(tokens, base_min_score=base_min_score, base_min_hits=base_min_hits)

    index = _build_bm25_index()
    scored: list[tuple[float, int, Doc]] = []
    for item in index.docs:
        d = item.doc
        s = _bm25_score(index, item, tokens)
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

    out: list[Citation] = []
    for s, h, d in scored:
        if s < min_score or h < min_hits:
            continue
        out.append(Citation(title=d.title, snippet=_snippet(d.text, tokens), source=d.source))
        if len(out) >= limit:
            break
    return out
