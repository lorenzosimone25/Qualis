"""Heuristic resolution of free-text queries into metric and hospital suggestions."""

from __future__ import annotations

import re
from typing import Any

from .data import STATE_NAMES, get_store, search_locations
from .glossary import build_glossary
from .metrics_rank import rank_glossary_matches

ZIP_RE = re.compile(r"\b(\d{5})\b")

_STOPWORDS = frozenset(
    """
    show compare plot find metrics metric hospitals hospital readmission mortality
    patient experience experience timely care payment complications near by for in
    and or the a an with related to
    """.split()
)


def _detect_state_codes(text: str) -> list[str]:
    """Detect state/territory codes via full names and uppercase two-letter tokens."""
    found: list[str] = []
    lower = text.lower()
    for code, name in sorted(STATE_NAMES.items(), key=lambda x: -len(x[1])):
        if len(name) >= 4 and name.lower() in lower:
            if code not in found:
                found.append(code)
            lower = lower.replace(name.lower(), " ")
    for m in re.finditer(r"\b([A-Z]{2})\b", text):
        code = m.group(1)
        if code in STATE_NAMES and code not in found:
            found.append(code)
    return found


def _strip_for_search(raw: str, zips: list[str], state_codes: list[str]) -> str:
    t = raw
    for z in zips:
        t = re.sub(rf"\b{re.escape(z)}\b", " ", t)
    for code in state_codes:
        name = STATE_NAMES.get(code, "")
        if len(name) >= 4:
            t = re.sub(re.escape(name), " ", t, flags=re.IGNORECASE)
        t = re.sub(rf"\b{re.escape(code)}\b", " ", t)
    words: list[str] = []
    for w in re.split(r"\s+", t.strip().lower()):
        if w and w not in _STOPWORDS and len(w) > 1:
            words.append(w)
    return " ".join(words)


def resolve_natural_query(
    q: str,
    *,
    metric_limit: int = 30,
    hospital_limit: int = 40,
) -> dict[str, Any]:
    """Return structured suggestions for metrics, hospitals, and geo-derived tokens."""
    raw = (q or "").strip()
    warnings: list[str] = []
    if not raw:
        return {
            "query": "",
            "detected_zips": [],
            "detected_state_codes": [],
            "residual_search_text": "",
            "metrics": [],
            "hospital_options": [],
            "suggested_hospital_tokens": [],
            "suggested_state_tokens": [],
            "warnings": ["Empty query"],
        }

    zips = list(dict.fromkeys(m.group(1) for m in ZIP_RE.finditer(raw)))
    state_codes = _detect_state_codes(raw)
    residual = _strip_for_search(raw, zips, state_codes)
    search_q = residual if len(residual) >= 2 else raw[:240].strip()

    store = get_store()
    df = build_glossary()
    mlim = max(1, min(metric_limit, 100))
    hlim = max(1, min(hospital_limit, 100))

    mq = search_q if len(search_q) >= 1 else raw[:80]
    metrics = rank_glossary_matches(df, mq, limit=mlim)
    for m in metrics:
        m.pop("score", None)

    hospital_opts: list[dict] = []
    if len(search_q) >= 2:
        hospital_opts = search_locations(store, search_q, limit=hlim)

    suggested_h: list[str] = []
    seen: set[str] = set()
    for z in zips:
        digits = "".join(c for c in z if c.isdigit())
        z5 = digits[:5] if len(digits) >= 5 else ""
        if len(z5) == 5:
            ccns = store.zip_to_ccns.get(z5, ())
            if not ccns:
                warnings.append(f"No hospitals in processed long data for ZIP {z5}.")
            for ccn in ccns[:20]:
                tok = f"H:{ccn}"
                if tok not in seen:
                    seen.add(tok)
                    suggested_h.append(tok)
    for st in state_codes:
        ccns = store.state_to_ccns.get(st, ())
        if len(ccns) > 20:
            warnings.append(f"State {st}: listing first 20 hospitals; narrow with name or ZIP.")
        for ccn in ccns[:20]:
            tok = f"H:{ccn}"
            if tok not in seen:
                seen.add(tok)
                suggested_h.append(tok)

    suggested_s = [f"S:{st}" for st in state_codes]

    return {
        "query": raw,
        "detected_zips": zips,
        "detected_state_codes": state_codes,
        "residual_search_text": residual,
        "metrics": metrics,
        "hospital_options": hospital_opts,
        "suggested_hospital_tokens": suggested_h,
        "suggested_state_tokens": suggested_s,
        "warnings": warnings,
    }
