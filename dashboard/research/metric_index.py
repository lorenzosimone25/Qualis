"""Metric catalog RAG: bounded candidate retrieval + deterministic selection.

Default retrieval uses a local TF–IDF scorer over canonical ``MetricDocument`` rows.
The :class:`MetricScorer` protocol allows embedding-backed scorers later without
changing the merge / cap / selection APIs.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Protocol, Sequence, runtime_checkable

import pandas as pd

from dashboard.research.research_resolution import measure_family

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall((text or "").lower())


def _format_intervals(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, (list, tuple)):
        parts = [str(x) for x in raw if x is not None and str(x).strip()]
        return " ".join(parts)
    return str(raw)


def _measure_tags_local(measure_id: str) -> tuple[str, ...]:
    """Lightweight tags aligned with ``service._measure_tags`` (avoid import cycles)."""
    mid = measure_id.upper()
    tags: list[str] = []
    if mid.startswith("MORT"):
        tags.append("mortality")
    if "READM" in mid or mid.startswith("READM"):
        tags.append("readmission")
    if mid.startswith("HAI") or mid.startswith("HQR"):
        tags.append("infection")
    if mid.startswith("COMP"):
        tags.append("complications")
    if "PSI_" in mid or mid.startswith("PSI"):
        tags.append("patient_safety")
    return tuple(tags)


@dataclass(frozen=True)
class MetricDocument:
    measure_id: str
    meaning: str
    interpretation: str
    is_volume: bool
    intervals: tuple[int, ...]
    family: str
    tags: tuple[str, ...]
    search_text: str


@dataclass
class CandidateHit:
    measure_id: str
    score: float
    source_query: str
    rank_in_query: int
    why_retrieved: str


@dataclass
class MergedCandidate:
    measure_id: str
    best_score: float
    meaning: str
    hits: list[CandidateHit] = field(default_factory=list)


@runtime_checkable
class MetricScorer(Protocol):
    """Pluggable dense / sparse similarity over a frozen metric corpus."""

    @property
    def scorer_backend(self) -> str:
        """``tfidf`` or ``embedding`` (for plan_debug)."""
        ...

    def search(self, query: str, *, top_k: int) -> list[tuple[str, float, str]]:
        """Return ``(measure_id, score, why_retrieved)`` sorted by score descending."""
        ...


def build_metric_documents(df: pd.DataFrame, *, store_ids: set[str] | None = None) -> list[MetricDocument]:
    """One canonical document per glossary row (optional intersection with ``store_ids``)."""
    if df is None or df.empty:
        return []
    out: list[MetricDocument] = []
    for _, r in df.iterrows():
        mid = str(r.get("measure_id") or "").strip()
        if not mid or (store_ids is not None and mid not in store_ids):
            continue
        meaning = str(r.get("meaning") or mid)
        interpretation = str(r.get("interpretation") or "")
        is_volume = bool(r.get("is_volume", False))
        ivals_raw = r.get("intervals")
        intervals: tuple[int, ...] = ()
        if isinstance(ivals_raw, (list, tuple)):
            tmp_i: list[int] = []
            for x in ivals_raw:
                try:
                    tmp_i.append(int(x))
                except (TypeError, ValueError):
                    continue
            intervals = tuple(tmp_i)
        fam = measure_family(mid)
        tags = _measure_tags_local(mid)
        iv_text = _format_intervals(ivals_raw)
        search_text = " ".join(
            [
                mid,
                mid.replace("_", " ").lower(),
                meaning,
                interpretation,
                iv_text,
                fam,
                " ".join(tags),
            ]
        )
        out.append(
            MetricDocument(
                measure_id=mid,
                meaning=meaning,
                interpretation=interpretation,
                is_volume=is_volume,
                intervals=intervals,
                family=fam,
                tags=tags,
                search_text=search_text,
            )
        )
    return out


class TfidfMetricScorer:
    """Deterministic BM25-style sparse scorer (no network, no sklearn)."""

    def __init__(self, documents: Sequence[MetricDocument]) -> None:
        self._docs = list(documents)
        self._id_to_idx = {d.measure_id: i for i, d in enumerate(self._docs)}
        self._doc_tokens: list[list[str]] = [_tokenize(d.search_text) for d in self._docs]
        n_docs = len(self._docs)
        df_counts: dict[str, int] = defaultdict(int)
        postings: dict[str, list[tuple[int, float]]] = defaultdict(list)
        doc_len = [0.0] * n_docs
        for i, toks in enumerate(self._doc_tokens):
            doc_len[i] = float(len(toks)) or 1.0
            ctr = Counter(toks)
            seen_t: set[str] = set()
            for t, c in ctr.items():
                tf = float(c)
                postings[t].append((i, tf))
                if t not in seen_t:
                    df_counts[t] += 1
                    seen_t.add(t)
        self._postings = dict(postings)
        self._avgdl = sum(doc_len) / max(n_docs, 1)
        self._doc_len = doc_len
        self._idf: dict[str, float] = {}
        for t, dfi in df_counts.items():
            # Smoothed IDF (avoid zero); positive bounded
            self._idf[t] = math.log((n_docs + 1.0) / (dfi + 1.0)) + 1.0
        self._doc_token_set = [frozenset(toks) for toks in self._doc_tokens]

    @property
    def scorer_backend(self) -> str:
        return "tfidf"

    @classmethod
    def from_documents(cls, documents: Sequence[MetricDocument]) -> TfidfMetricScorer:
        return cls(documents)

    def _bm25_score(self, doc_i: int, term_scores: dict[str, float]) -> float:
        """Sum BM25 contributions for terms that hit doc ``doc_i``."""
        k1, b = 1.5, 0.75
        dl = self._doc_len[doc_i]
        norm_dl = k1 * (1.0 - b + b * dl / self._avgdl) if self._avgdl > 0 else k1
        total = 0.0
        doc_ctr = Counter(self._doc_tokens[doc_i])
        for t, wq in term_scores.items():
            f = float(doc_ctr.get(t, 0))
            if f <= 0:
                continue
            idf = self._idf.get(t, 0.0)
            num = f * (k1 + 1.0)
            den = f + norm_dl
            total += idf * wq * (num / den)
        return total

    def search(self, query: str, *, top_k: int) -> list[tuple[str, float, str]]:
        q_toks = _tokenize(query)
        if not q_toks or not self._docs:
            return []
        q_ctr = Counter(q_toks)
        term_wq: dict[str, float] = {}
        for t, qc in q_ctr.items():
            if t not in self._idf:
                continue
            term_wq[t] = (1.0 + math.log(qc)) * self._idf[t]
        if not term_wq:
            return []
        doc_scores: dict[int, float] = defaultdict(float)
        touched: set[int] = set()
        for t in term_wq:
            for doc_i, _ in self._postings.get(t, ()):
                touched.add(doc_i)
        for doc_i in touched:
            doc_scores[doc_i] = self._bm25_score(doc_i, term_wq)
        ranked = sorted(doc_scores.items(), key=lambda x: -x[1])[: max(top_k * 3, top_k)]
        out: list[tuple[str, float, str]] = []
        dts = self._doc_token_set
        for doc_i, sc in ranked[:top_k]:
            mid = self._docs[doc_i].measure_id
            matched = [t for t in q_ctr if t in dts[doc_i]]
            matched.sort(key=lambda t: -self._idf.get(t, 0.0) * q_ctr[t])
            why = "bm25_tfidf;" + ",".join(matched[:6]) if matched else "bm25_tfidf"
            out.append((mid, float(sc), why))
        return out


def search_metric_candidates(
    scorer: MetricScorer,
    query: str,
    documents: Sequence[MetricDocument],
    top_k: int,
) -> list[CandidateHit]:
    """Rank catalog rows for a single query string with provenance."""
    _ = documents  # corpus is bound inside ``TfidfMetricScorer``; kept for API symmetry / future scorers
    raw = scorer.search((query or "").strip(), top_k=max(1, top_k))
    hits: list[CandidateHit] = []
    for rank, (mid, sc, why) in enumerate(raw, start=1):
        hits.append(
            CandidateHit(
                measure_id=mid,
                score=sc,
                source_query=query.strip(),
                rank_in_query=rank,
                why_retrieved=why[:500],
            )
        )
    return hits


def search_many_metric_candidates(
    scorer: MetricScorer,
    queries: Sequence[str],
    documents: Sequence[MetricDocument],
    top_k_per_query: int,
) -> dict[str, list[CandidateHit]]:
    """Per-query retrieval (no global rank-then-cut)."""
    out: dict[str, list[CandidateHit]] = {}
    seen_norm: set[str] = set()
    for q in queries:
        qq = (q or "").strip()
        if len(qq) < 2:
            continue
        key = qq.lower()
        if key in seen_norm:
            continue
        seen_norm.add(key)
        out[qq] = search_metric_candidates(scorer, qq, documents, top_k_per_query)
    return out


def coarse_metric_branch(measure_id: str, meaning: str) -> str:
    """Broad clinical / program branch for coverage-aware pooling."""
    u = measure_id.upper()
    ml = (meaning or "").lower()
    if "COPD" in u or "copd" in ml:
        return "copd"
    if "PSI_" in u or u.startswith("PSI") or "patient safety indicator" in ml:
        return "patient_safety"
    if u.startswith("HAI") or u.startswith("HQR") or "hai " in ml:
        return "hai_infection"
    if u.startswith("MORT"):
        return "mortality"
    if "READM" in u or u.startswith("READM"):
        return "readmission"
    if "HCAHPS" in u or "hcahps" in ml:
        return "patient_experience"
    return "other"


def _psi_numeric_alias_key(measure_id: str) -> str | None:
    m = re.match(r"^PSI_0*(\d+)$", measure_id.upper())
    return f"PSI_{int(m.group(1))}" if m else None


def _meaning_map(docs: Sequence[MetricDocument]) -> dict[str, str]:
    return {d.measure_id: d.meaning for d in docs}


def merge_and_cap_candidates(
    per_query: Mapping[str, Sequence[CandidateHit]],
    documents: Sequence[MetricDocument],
    *,
    pool_cap: int = 50,
    max_per_coarse_branch: int = 12,
) -> list[MergedCandidate]:
    """Merge query-wise hits, dedupe ids, cap pool with coarse-branch diversity."""
    cap = max(20, min(60, pool_cap))
    max_br = max(4, min(18, max_per_coarse_branch))
    meanings = _meaning_map(documents)
    queries_order = list(per_query.keys())
    max_rank = max((len(list(per_query[q])) for q in queries_order), default=0)

    pool_hits: list[CandidateHit] = []
    seen_ids: set[str] = set()
    branch_counts: dict[str, int] = defaultdict(int)

    for rnk in range(max_rank):
        for sq in queries_order:
            hits = list(per_query.get(sq) or [])
            if rnk >= len(hits):
                continue
            h = hits[rnk]
            mid = h.measure_id
            if mid in seen_ids:
                continue
            br = coarse_metric_branch(mid, meanings.get(mid, ""))
            if branch_counts[br] >= max_br:
                continue
            seen_ids.add(mid)
            pool_hits.append(h)
            branch_counts[br] += 1
            if len(pool_hits) >= cap:
                break
        if len(pool_hits) >= cap:
            break

    if len(pool_hits) < cap:
        # Collect remaining hits sorted by score globally (respect branch cap softly)
        rest: list[CandidateHit] = []
        for sq in queries_order:
            rest.extend(per_query.get(sq) or [])
        rest.sort(key=lambda h: -h.score)
        for h in rest:
            if len(pool_hits) >= cap:
                break
            if h.measure_id in seen_ids:
                continue
            br = coarse_metric_branch(h.measure_id, meanings.get(h.measure_id, ""))
            if branch_counts[br] >= max_br:
                continue
            seen_ids.add(h.measure_id)
            pool_hits.append(h)
            branch_counts[br] += 1

    prov: dict[str, list[CandidateHit]] = defaultdict(list)
    for sq, hits in per_query.items():
        for h in hits:
            prov[h.measure_id].append(h)

    merged: list[MergedCandidate] = []
    for h in pool_hits:
        mid = h.measure_id
        hits = sorted(prov.get(mid, [h]), key=lambda x: -x.score)
        best = max(x.score for x in hits)
        merged.append(MergedCandidate(measure_id=mid, best_score=best, meaning=meanings.get(mid, ""), hits=hits))
    return merged


def _dedupe_psi_aliases(cands: Sequence[MergedCandidate]) -> list[MergedCandidate]:
    """Prefer a single numeric PSI alias (e.g. PSI_3 vs PSI_03) unless suffix differs."""
    by_key: dict[str, MergedCandidate] = {}
    order_keys: list[str] = []
    for c in cands:
        pk = _psi_numeric_alias_key(c.measure_id)
        key = pk or c.measure_id
        if key not in by_key:
            order_keys.append(key)
            by_key[key] = c
        else:
            prev = by_key[key]
            if c.best_score > prev.best_score:
                by_key[key] = c
    return [by_key[k] for k in order_keys]


def deterministic_select_metrics(
    merged: Sequence[MergedCandidate],
    *,
    max_metrics: int = 10,
    branch_priority: Sequence[str] | None = None,
) -> tuple[list[str], dict[str, Any]]:
    """Pick up to ``max_metrics`` ids: branch coverage, then score order."""
    max_n = max(1, min(12, max_metrics))
    deduped = _dedupe_psi_aliases(list(merged))
    meanings = {c.measure_id: c.meaning for c in deduped}
    branches_present: dict[str, list[MergedCandidate]] = defaultdict(list)
    for c in deduped:
        br = coarse_metric_branch(c.measure_id, c.meaning or meanings.get(c.measure_id, ""))
        branches_present[br].append(c)
    for br in branches_present:
        branches_present[br].sort(key=lambda x: -x.best_score)

    pref = list(branch_priority) if branch_priority else ()
    default_pref = (
        "copd",
        "patient_safety",
        "hai_infection",
        "mortality",
        "readmission",
        "patient_experience",
        "other",
    )
    ordered_branches = [b for b in pref if b in branches_present]
    for b in default_pref:
        if b in branches_present and b not in ordered_branches:
            ordered_branches.append(b)
    for b in sorted(branches_present.keys()):
        if b not in ordered_branches:
            ordered_branches.append(b)

    selected: list[str] = []
    picked: set[str] = set()
    # One per coarse branch first (score order within branch)
    for br in ordered_branches:
        if len(selected) >= max_n:
            break
        pool = branches_present.get(br) or []
        if not pool:
            continue
        top = pool[0]
        if top.measure_id not in picked:
            selected.append(top.measure_id)
            picked.add(top.measure_id)

    remainder = [c for c in sorted(deduped, key=lambda x: -x.best_score) if c.measure_id not in picked]
    for c in remainder:
        if len(selected) >= max_n:
            break
        selected.append(c.measure_id)
        picked.add(c.measure_id)

    debug = {
        "branch_order": ordered_branches,
        "n_merged_input": len(merged),
        "n_after_psi_dedupe": len(deduped),
    }
    return selected, debug


def validate_llm_metric_pick(
    raw: Mapping[str, Any] | None,
    allowed: set[str],
    *,
    max_metrics: int,
) -> tuple[list[str], list[str]]:
    """Filter LLM output to allowed measure ids only (stable order)."""
    if not raw:
        return [], []
    out_ids: list[str] = []
    seen: set[str] = set()
    for x in raw.get("selected_metrics") or []:
        s = str(x).strip()
        if s in allowed and s not in seen:
            seen.add(s)
            out_ids.append(s)
        if len(out_ids) >= max_metrics:
            break
    needs = [str(x).strip() for x in (raw.get("unresolved_metric_needs") or []) if str(x).strip()][:8]
    return out_ids, needs


def run_metric_rag_selection(
    df: pd.DataFrame,
    store_ids: set[str],
    rag_queries: Sequence[str],
    *,
    top_k_per_query: int = 14,
    pool_cap: int = 50,
    max_per_coarse_branch: int = 12,
    max_final_metrics: int = 10,
    llm_picker: Callable[[list[dict[str, Any]]], Mapping[str, Any] | None] | None = None,
) -> dict[str, Any]:
    """End-to-end: documents → retrieve → merge → deterministic → optional LLM."""
    documents = build_metric_documents(df, store_ids=store_ids)
    scorer = TfidfMetricScorer.from_documents(documents)
    per_query = search_many_metric_candidates(scorer, list(rag_queries), documents, top_k_per_query)
    merged = merge_and_cap_candidates(
        per_query,
        documents,
        pool_cap=pool_cap,
        max_per_coarse_branch=max_per_coarse_branch,
    )
    det_ids, det_dbg = deterministic_select_metrics(merged, max_metrics=max_final_metrics)
    merged_payload = [
        {
            "measure_id": m.measure_id,
            "best_score": round(m.best_score, 6),
            "meaning": (m.meaning or "")[:240],
            "hits": [
                {
                    "source_query": h.source_query,
                    "score": round(h.score, 6),
                    "rank_in_query": h.rank_in_query,
                    "why_retrieved": h.why_retrieved[:300],
                }
                for h in m.hits[:8]
            ],
        }
        for m in merged[:80]
    ]
    per_query_debug = {
        sq: {
            "hit_count": len(hits),
            "top": [
                {
                    "measure_id": h.measure_id,
                    "score": round(h.score, 6),
                    "rank_in_query": h.rank_in_query,
                    "why_retrieved": h.why_retrieved[:200],
                }
                for h in hits[:8]
            ],
        }
        for sq, hits in per_query.items()
    }
    warnings: list[str] = []
    selection_mode = "deterministic"
    unresolved: list[str] = []
    final_ids = list(det_ids)

    if llm_picker is not None:
        cand_menu = [
            {
                "measure_id": m.measure_id,
                "score": round(m.best_score, 6),
                "meaning": (m.meaning or "")[:400],
            }
            for m in merged[: min(len(merged), 60)]
        ]
        allowed = {str(x["measure_id"]) for x in cand_menu}
        raw_pick = llm_picker(cand_menu)
        if not isinstance(raw_pick, dict):
            raw_pick = None
        picked, unresolved = validate_llm_metric_pick(raw_pick, allowed, max_metrics=max_final_metrics)
        use_llm = bool(picked) and (len(picked) >= 2 or len(det_ids) < 2)
        if use_llm:
            final_ids = picked
            selection_mode = "llm_picker"
        elif raw_pick is not None:
            warnings.append("LLM metric picker returned too few valid ids; using deterministic selection.")
            final_ids = list(det_ids)

    final_ids = [m for m in final_ids if m in store_ids][:max_final_metrics]

    return {
        "final_measure_ids": final_ids,
        "deterministic_ids": det_ids,
        "selection_mode": selection_mode,
        "scorer_backend": scorer.scorer_backend,
        "rag_queries": list(rag_queries),
        "per_query_hit_counts": {sq: len(hits) for sq, hits in per_query.items()},
        "per_query": per_query_debug,
        "candidate_pool_size": len(merged),
        "merged_candidates": merged_payload,
        "deterministic_debug": det_dbg,
        "warnings": warnings,
        "unresolved_metric_needs": unresolved,
    }
