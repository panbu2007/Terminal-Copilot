"""rag_v2.py — Hybrid vector + keyword RAG for Terminal Copilot.

Strategy:
- get_embedding()      : call ModelScope BAAI/bge-small-zh-v1.5 embeddings API
- cosine_similarity()  : numpy cosine sim
- vector_search()      : semantic retrieval over all docs
- reciprocal_rank_fusion(): RRF merge of two ranked lists
- hybrid_retrieve()    : combine vector search + keyword search via RRF;
                         graceful degradation to keyword-only when no token/API error
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Module-level doc-vector cache
# ---------------------------------------------------------------------------
_DOC_VECTORS: dict[str, list[float]] = {}   # key = doc.source -> embedding vector
_CACHE_BUILDING = False                      # flag to avoid re-entrant build

EMBEDDING_MODEL = "BAAI/bge-small-zh-v1.5"
EMBEDDING_URL = "https://api-inference.modelscope.cn/v1/embeddings"
EMBEDDING_TIMEOUT = 10  # seconds


# ---------------------------------------------------------------------------
# VectorRAG class
# ---------------------------------------------------------------------------
class VectorRAG:
    """Stateless helper class; all state lives in module-level _DOC_VECTORS."""

    # ------------------------------------------------------------------
    # Embedding
    # ------------------------------------------------------------------

    @staticmethod
    def get_embedding(text: str) -> Optional[list[float]]:
        """Call ModelScope BAAI/bge-small-zh-v1.5 and return the embedding vector.

        Returns None if no token is configured or any error occurs.
        """
        from .llm.modelscope_client import _env_config

        cfg = _env_config()
        if cfg is None:
            return None

        payload = json.dumps(
            {"model": EMBEDDING_MODEL, "input": [text]},
            ensure_ascii=False,
        ).encode("utf-8")

        req = urllib.request.Request(
            EMBEDDING_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {cfg.access_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=EMBEDDING_TIMEOUT) as resp:
                body = resp.read().decode("utf-8")
        except Exception as exc:
            logger.debug("get_embedding network error: %s", exc)
            return None

        try:
            data = json.loads(body)
            return data["data"][0]["embedding"]
        except Exception as exc:
            logger.debug("get_embedding parse error: %s; body=%s", exc, body[:200])
            return None

    # ------------------------------------------------------------------
    # Math helpers
    # ------------------------------------------------------------------

    @staticmethod
    def cosine_similarity(a: list[float], b: list[float]) -> float:
        """Return cosine similarity in [-1, 1]; returns 0.0 on zero vectors."""
        import numpy as np

        va = np.asarray(a, dtype=float)
        vb = np.asarray(b, dtype=float)
        na = np.linalg.norm(va)
        nb = np.linalg.norm(vb)
        if na == 0.0 or nb == 0.0:
            return 0.0
        return float(np.dot(va, vb) / (na * nb))

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    @staticmethod
    def vector_search(
        query: str,
        docs: list,
        top_k: int = 5,
    ) -> list[Tuple[float, object]]:
        """Semantic search over docs using precomputed or live embeddings.

        `docs` is a list of Doc objects (from rag._load_docs()).

        Returns list of (score, doc) sorted by descending cosine similarity.
        Only docs whose vectors are cached in _DOC_VECTORS are considered.
        """
        q_vec = VectorRAG.get_embedding(query)
        if q_vec is None:
            return []

        scored: list[Tuple[float, object]] = []
        for doc in docs:
            vec = _DOC_VECTORS.get(doc.source)
            if vec is None:
                continue
            sim = VectorRAG.cosine_similarity(q_vec, vec)
            scored.append((sim, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[:top_k]

    # ------------------------------------------------------------------
    # Fusion
    # ------------------------------------------------------------------

    @staticmethod
    def reciprocal_rank_fusion(
        vec_results: list[Tuple[float, object]],
        kw_results: list,
        k: int = 60,
    ) -> list[object]:
        """Reciprocal Rank Fusion of two ranked lists.

        vec_results: [(score, doc), ...]
        kw_results : [Citation, ...]  — we match back to docs via .source

        Returns de-duplicated list of docs ordered by descending RRF score.
        """
        from .rag import _load_docs

        # Build source -> doc mapping
        all_docs = {doc.source: doc for doc in _load_docs()}

        rrf_scores: dict[str, float] = {}
        doc_by_source: dict[str, object] = {}

        # Vector rank contribution
        for rank, (_, doc) in enumerate(vec_results, start=1):
            src = doc.source
            rrf_scores[src] = rrf_scores.get(src, 0.0) + 1.0 / (k + rank)
            doc_by_source[src] = doc

        # Keyword rank contribution — kw_results is list[Citation]
        for rank, citation in enumerate(kw_results, start=1):
            src = citation.source
            rrf_scores[src] = rrf_scores.get(src, 0.0) + 1.0 / (k + rank)
            # Map Citation back to Doc for consistency
            if src not in doc_by_source and src in all_docs:
                doc_by_source[src] = all_docs[src]

        # Sort by descending RRF score
        sorted_sources = sorted(rrf_scores, key=lambda s: rrf_scores[s], reverse=True)
        return [doc_by_source[s] for s in sorted_sources if s in doc_by_source]


# ---------------------------------------------------------------------------
# Doc-vector cache building (async, fire-and-forget on first call)
# ---------------------------------------------------------------------------


def _build_doc_vectors_sync() -> None:
    """Compute and cache embeddings for all docs. Called in a background thread."""
    global _DOC_VECTORS, _CACHE_BUILDING

    from .rag import _load_docs

    docs = _load_docs()
    if not docs:
        return

    def _embed_doc(doc) -> Tuple[str, Optional[list[float]]]:
        # Use title + first 500 chars of text for embedding to keep it short
        text = (doc.title + "\n" + doc.text[:500]).strip()
        vec = VectorRAG.get_embedding(text)
        return doc.source, vec

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(_embed_doc, doc): doc for doc in docs}
            for future in as_completed(futures):
                try:
                    src, vec = future.result()
                    if vec is not None:
                        _DOC_VECTORS[src] = vec
                except Exception as exc:
                    logger.debug("doc embedding failed: %s", exc)
    except Exception as exc:
        logger.debug("_build_doc_vectors_sync failed: %s", exc)
    finally:
        _CACHE_BUILDING = False


def _ensure_doc_vectors() -> None:
    """Trigger async background build of doc vectors if not already done."""
    global _CACHE_BUILDING

    if _DOC_VECTORS or _CACHE_BUILDING:
        return

    _CACHE_BUILDING = True
    # Run in daemon thread so it doesn't block server startup
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rag_v2_build")
    executor.submit(_build_doc_vectors_sync)
    executor.shutdown(wait=False)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def hybrid_retrieve(query: str, limit: int = 3) -> list:
    """Hybrid retrieval: vector search + keyword search fused via RRF.

    Falls back to keyword-only when embedding is unavailable.
    Always returns list[Citation].
    """
    from .models import Citation
    from .rag import _load_docs, _snippet, _tokenize, retrieve as kw_retrieve

    # Kick off background doc-vector build (no-op if already done/building)
    _ensure_doc_vectors()

    # ---- Try hybrid path ----
    try:
        from .llm.modelscope_client import _env_config

        if _env_config() is not None and _DOC_VECTORS:
            docs = _load_docs()

            # Vector retrieval top-8
            vec_results = VectorRAG.vector_search(query, docs, top_k=8)

            # Keyword retrieval top-8 (as Citations)
            kw_citations = kw_retrieve(query, limit=8)

            if vec_results or kw_citations:
                # RRF fusion
                fused_docs = VectorRAG.reciprocal_rank_fusion(vec_results, kw_citations)

                tokens = _tokenize(query)
                out: list[Citation] = []
                for doc in fused_docs[:limit]:
                    snippet = _snippet(doc.text, tokens) if tokens else doc.text[:200].replace("\n", " ")
                    out.append(Citation(title=doc.title, snippet=snippet, source=doc.source))
                return out
    except Exception as exc:
        logger.debug("hybrid_retrieve vector path failed, degrading: %s", exc)

    # ---- Fallback: keyword-only ----
    try:
        from .rag import retrieve as kw_retrieve_fallback

        return kw_retrieve_fallback(query, limit=limit)
    except Exception as exc:
        logger.warning("hybrid_retrieve keyword fallback also failed: %s", exc)
        return []


def refresh_vector_cache() -> None:
    global _DOC_VECTORS, _CACHE_BUILDING
    _DOC_VECTORS = {}
    _CACHE_BUILDING = False
