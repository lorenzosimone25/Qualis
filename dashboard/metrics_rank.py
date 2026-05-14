"""Relevance ranking for measure glossary search (no external index required)."""

from __future__ import annotations

import re

import pandas as pd


def _score_row(ql: str, measure_id: str, meaning: str, interpretation: str) -> float:
    mid = measure_id.lower()
    m = meaning.lower()
    it = interpretation.lower()
    score = 0.0
    if mid == ql:
        score += 200.0
    elif mid.startswith(ql):
        score += 130.0
    elif ql in mid:
        score += 70.0
    if m.startswith(ql):
        score += 85.0
    elif ql in m:
        score += 45.0
    if ql in it:
        score += 18.0
    # Prefer shorter measure_id as tie-breaker when scores tie
    score += 1.0 / (1.0 + len(measure_id))
    return score


def rank_glossary_matches(df: pd.DataFrame, q: str, *, limit: int) -> list[dict]:
    """Return top ``limit`` glossary rows for substring ``q``, sorted by relevance."""
    ql = (q or "").strip().lower()
    if not ql or df.empty:
        return []

    pat = re.escape(ql)
    mask = (
        df["measure_id"].astype(str).str.lower().str.contains(pat, regex=True, na=False)
        | df["meaning"].astype(str).str.lower().str.contains(pat, regex=True, na=False)
        | df["interpretation"].astype(str).str.lower().str.contains(pat, regex=True, na=False)
    )
    hit = df.loc[mask].copy()
    if hit.empty:
        return []

    scores = []
    for _, r in hit.iterrows():
        s = _score_row(ql, str(r["measure_id"]), str(r["meaning"]), str(r["interpretation"]))
        scores.append((s, r))
    scores.sort(key=lambda x: -x[0])

    out: list[dict] = []
    for s, r in scores[:limit]:
        meaning = str(r["meaning"])
        out.append(
            {
                "measure_id": str(r["measure_id"]),
                "label": meaning,
                "snippet": meaning[:280],
                "interpretation": str(r["interpretation"]),
                "is_volume": bool(r["is_volume"]),
                "score": round(s, 4),
            }
        )
    return out
