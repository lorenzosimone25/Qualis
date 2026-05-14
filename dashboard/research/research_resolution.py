"""Deterministic metric and hospital resolution for the Research hybrid planner."""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from dashboard.data import search_locations
from dashboard.metrics_rank import rank_glossary_matches
from dashboard.rankings import rank_hospitals_for_state_measure

MAX_METRIC_QUERIES = 14
RANK_HITS_PER_QUERY = 120
# Max hospitals per measure for ranked retrieval (must align with service MAX_HOSPITAL_LOCATIONS).
RESEARCH_MAX_RANKED_HOSPITALS = 50
# Default ranked row count before per-metric overrides (micro-planner or LLM candidates).
RESEARCH_DEFAULT_RANK_LIMIT = 24

_SPECIALTY_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("cardiology", ("cardio", "heart", "ami", "stemi", "chf", "hf ", " failure", "coronary")),
    ("infection", ("hai", "infection", "cauti", "clabsi", "ssi", "mrsa")),
    ("readmission", ("readmission", "readm", "30-day read")),
    ("mortality", ("mortality", "death", "mort ")),
]


def _specialty_needle_hit(q_lower: str, needle: str) -> bool:
    """Match specialty cue phrases or whole-token short needles (avoids ``ssi`` inside ``readmission``)."""
    n = needle.lower()
    if not n:
        return False
    if " " in n or "-" in n or len(n) > 6:
        return n in q_lower
    return bool(re.search(rf"(?<![a-z0-9]){re.escape(n)}(?![a-z0-9])", q_lower))


def _wants_ami_context(q_lower: str) -> bool:
    """True only when the question clearly targets AMI / heart attack (not substring 'ami' inside unrelated words)."""
    if "heart attack" in q_lower or "myocardial infarction" in q_lower or "myocardial" in q_lower:
        return True
    if "stemi" in q_lower or "nstemi" in q_lower:
        return True
    toks = re.split(r"[^a-z0-9]+", q_lower)
    return "ami" in toks


def specialty_extra_queries(q_lower: str) -> list[str]:
    extras: list[str] = []
    heart_needles = ("cardio", "heart", "ami", "stemi", "chf", "hf ", " failure", "coronary")
    heart_hit = any(_specialty_needle_hit(q_lower, n) for n in heart_needles)
    for _name, needles in _SPECIALTY_HINTS:
        if any(_specialty_needle_hit(q_lower, n) for n in needles):
            if "cardio" in needles or "heart" in needles:
                extras.append("MORT_30_HF")
                if "readmission" in q_lower or "readm" in q_lower:
                    extras.append("READM_30_HF")
                if _wants_ami_context(q_lower):
                    extras.append("MORT_30_AMI")
            if "readmission" in needles or "readm" in needles:
                extras.append("readmission")
            if "mortality" in needles or "death" in needles:
                if not heart_hit:
                    extras.append("MORT")
            if "hai" in needles or "infection" in needles:
                extras.append("HAI")
    return extras


def collect_metric_queries(
    raw: dict[str, Any],
    question: str,
    conversation_context: str | None,
    *,
    session_slots: Any | None = None,
) -> list[str]:
    """Build search strings from LLM intent + question (deduped, bounded).

    Specialty expansion uses the **question text only** (not conversation_context) to avoid
    stale clarification turns skewing glossary resolution toward unrelated phrases.

    ``conversation_context`` is passed to the planner LLM only; it must not be merged into
    lexical metric queries (avoids unrelated prior prompts contaminating a new investigation).
    ``session_slots`` is retained on the signature for callers; geography slots do not add
    free-text metric queries here.
    """
    _ = conversation_context
    _ = session_slots
    out: list[str] = []
    seen: set[str] = set()

    def add(s: str) -> None:
        t = s.strip()
        if len(t) < 2 or t.lower() in seen:
            return
        seen.add(t.lower())
        out.append(t)

    fb = (question or "").strip()
    if fb:
        add(fb)
    for key in ("metric_search_queries", "clinical_themes"):
        for x in raw.get(key) or []:
            add(str(x))
    for x in raw.get("measure_ids") or []:
        s = str(x).strip()
        if 2 <= len(s) <= 48:
            add(s)
    q_lower = (question or "").strip().lower()
    for s in specialty_extra_queries(q_lower):
        add(s)
    return out[:MAX_METRIC_QUERIES]


def collect_metric_queries_for_rag(
    raw: dict[str, Any],
    question: str,
    *,
    session_slots: Any | None = None,
) -> list[str]:
    """Metric-catalog RAG query strings only (no ``specialty_extra_queries`` expansion).

    Uses the live user question plus planner ``metric_search_queries``, ``clinical_themes``,
    and any explicit ``measure_ids`` from the planner JSON. Geography slots do not add
    free-text metric queries (same rationale as :func:`collect_metric_queries`).
    """
    _ = session_slots
    out: list[str] = []
    seen: set[str] = set()

    def add(s: str) -> None:
        t = s.strip()
        if len(t) < 2 or t.lower() in seen:
            return
        seen.add(t.lower())
        out.append(t)

    fb = (question or "").strip()
    if fb:
        add(fb)
    for key in ("metric_search_queries", "clinical_themes"):
        for x in raw.get(key) or []:
            add(str(x))
    for x in raw.get("measure_ids") or []:
        s = str(x).strip()
        if 2 <= len(s) <= 48:
            add(s)
    return out[:MAX_METRIC_QUERIES]


def filter_measures_by_availability(
    store: Any,
    measure_ids: list[str],
    *,
    state_codes: list[str],
    hospital_tokens: list[str],
    include_national: bool,
    replacement_candidates: list[str],
    warnings: list[str],
) -> list[str]:
    """Drop or swap measures that have no rows for the planned retrieval locations."""
    from dashboard.data import fetch_series

    locs: list[str] = []
    for s in state_codes:
        if not isinstance(s, str):
            continue
        st = s.strip().upper()[:2]
        if len(st) == 2:
            locs.append(f"S:{st}")
    for h in hospital_tokens:
        if isinstance(h, str) and h.startswith("H:"):
            locs.append(h)
    locs = list(dict.fromkeys(locs))

    if not locs and not include_national:
        return list(measure_ids)

    def has_rows(mid: str) -> bool:
        try:
            df = fetch_series(store, mid, locs, include_national)
        except Exception:
            return False
        return df is not None and not df.empty

    repl = [m for m in replacement_candidates if isinstance(m, str) and m.strip()]
    out: list[str] = []
    r_i = 0
    for mid in measure_ids:
        m = str(mid).strip()
        if not m:
            continue
        if has_rows(m):
            out.append(m)
            continue
        warnings.append(
            f"No CMS rows for measure {m} in the selected geography/entity scope; attempting replacement."
        )
        swapped = False
        while r_i < len(repl):
            cand = repl[r_i]
            r_i += 1
            if cand in out:
                continue
            if has_rows(cand):
                out.append(cand)
                swapped = True
                warnings.append(f"Replaced unavailable measure {m} with {cand} for this scope.")
                break
        if not swapped:
            warnings.append(f"Dropped unavailable measure {m} (no replacement with rows in scope).")
    return out


def resolve_measures_from_glossary(
    df: pd.DataFrame,
    queries: list[str],
    store_ids: set[str],
    *,
    cap: int,
    warnings: list[str],
) -> list[str]:
    """Union lexical ranks over full glossary; intersect with ``store_ids``; cap."""
    seen_score: dict[str, float] = {}
    for qq in queries:
        if not (qq or "").strip():
            continue
        hits = rank_glossary_matches(df, qq.strip(), limit=RANK_HITS_PER_QUERY)
        for h in hits:
            mid = str(h["measure_id"])
            sc = float(h.get("score") or 0.0)
            if mid not in seen_score or sc > seen_score[mid]:
                seen_score[mid] = sc
    if not seen_score:
        warnings.append("Metric search returned no glossary hits for the generated queries.")
        return []
    ordered = sorted(seen_score.keys(), key=lambda m: -seen_score[m])
    final = [m for m in ordered if m in store_ids][:cap]
    dropped = [m for m in ordered if m not in store_ids][:12]
    if dropped:
        warnings.append("Dropped measure ids not in the loaded dataset: " + ", ".join(dropped))
    if len(ordered) > len(final):
        warnings.append(f"Resolved measures capped to {cap} after ranking and dataset intersection.")
    return final


def ccn_state(store: Any, ccn: str) -> str | None:
    """Two-letter state from hospital metadata, if present."""
    hm = store.hospital_meta
    if hm is None or hm.empty:
        return None
    ccn = str(ccn).strip()
    try:
        row = hm.loc[ccn]
    except KeyError:
        mask = hm.index.astype(str) == ccn
        if not mask.any():
            return None
        row = hm.loc[mask].iloc[0]
    if "state" not in row.index:
        return None
    st = str(row.get("state") or "").strip().upper()
    return st[:2] if len(st) >= 2 else None


def hospitals_from_hints(
    store: Any,
    hints: list[str],
    allowed_states: set[str] | None,
    *,
    max_hospitals: int,
    warnings: list[str],
) -> list[str]:
    """Map natural-language hints to ``H:`` tokens via substring search + optional state filter."""
    tokens: list[str] = []
    for hint in sorted(hints, key=lambda x: str(x).strip().lower()):
        h = hint.strip()
        if len(h) < 2:
            continue
        opts = search_locations(store, h, limit=24)
        n_matched = 0
        for opt in opts:
            val = opt.get("value")
            if not isinstance(val, str) or not val.startswith("H:"):
                continue
            ccn = val.split(":", 1)[1].strip()
            st = ccn_state(store, ccn)
            if allowed_states and st and st not in allowed_states:
                continue
            if val not in tokens:
                tokens.append(val)
                n_matched += 1
            if len(tokens) >= max_hospitals:
                return tokens
        if n_matched == 0:
            warnings.append(f"No hospitals matched search hint: {h!r}")
    return tokens


def top_hospitals_ranked(
    store: Any,
    measure_id: str,
    states: list[str],
    *,
    max_hospitals: int,
    max_states: int,
    warnings: list[str],
) -> list[str]:
    """Pick diverse hospitals using state-level best/worst rankings for one measure."""
    out: list[str] = []
    for st in states[:max_states]:
        st = str(st).strip().upper()[:2]
        if len(st) != 2:
            continue
        any_row = False
        for sort_m in ("worst", "best"):
            rows, elig, _extra = rank_hospitals_for_state_measure(store, measure_id, st, limit=5, sort=sort_m)  # type: ignore[arg-type]
            if elig == 0 and not rows:
                continue
            any_row = True
            for r in rows:
                tok = f"H:{r['ccn']}"
                if tok not in out:
                    out.append(tok)
                if len(out) >= max_hospitals:
                    return out
        if not any_row:
            warnings.append(f"No hospital ranking rows for measure {measure_id} in state {st}.")
    return out[:max_hospitals]


RANKING_SORTS = frozenset({"best", "worst", "improved", "worsened", "volume_high", "volume_low", "balanced"})
HOSPITAL_POLICY_MODES = frozenset(
    {"none", "explicit_hospitals", "ranked_in_state", "ranked_national", "state_overview"}
)


def measure_family(measure_id: str) -> str:
    u = measure_id.upper()
    if u.startswith("MORT"):
        return "MORT"
    if "READM" in u or u.startswith("READM"):
        return "READM"
    if u.startswith("HAI") or "HAI_" in u:
        return "HAI"
    if u.startswith("HCAHPS") or "HCAHPS" in u:
        return "HCAHPS"
    if "VOLUME" in u or u.endswith("_VOLUME"):
        return "VOL"
    if u.startswith("COMP") or "PSI_" in u:
        return "COMP"
    return "OTHER"


def diversify_measures(ids: list[str], *, max_n: int, max_per_family: int | None = None) -> list[str]:
    """Prefer one measure per clinical family; optional cap on rows per family in the fill pass."""
    fam_counts: dict[str, int] = {}
    seen_fam: set[str] = set()
    out: list[str] = []

    def can_take(fam: str) -> bool:
        if max_per_family is None:
            return True
        return fam_counts.get(fam, 0) < max_per_family

    for mid in ids:
        fam = measure_family(mid)
        if fam in seen_fam:
            continue
        seen_fam.add(fam)
        out.append(mid)
        fam_counts[fam] = fam_counts.get(fam, 0) + 1
        if len(out) >= max_n:
            return out
    for mid in ids:
        if mid in out:
            continue
        fam = measure_family(mid)
        if not can_take(fam):
            continue
        out.append(mid)
        fam_counts[fam] = fam_counts.get(fam, 0) + 1
        if len(out) >= max_n:
            break
    return out


def volume_sibling_id(store: Any, base_mid: str) -> str | None:
    vid = f"{base_mid}_VOLUME"
    vol_ids = set(getattr(store, "volume_ids", ()) or ())
    return vid if vid in vol_ids else None


def normalize_ranking_bias(raw_val: Any) -> str | None:
    s = str(raw_val or "").strip().lower()
    if s in ("favorable", "neutral", "concerning"):
        return s
    return None


def drop_volume_measure_ids(ids: list[str], df: pd.DataFrame | None = None) -> list[str]:
    """Strip volume measures from the primary plan bundle (volume charts load siblings client-side)."""
    out = [m for m in ids if not str(m).upper().endswith("_VOLUME")]
    if df is not None and not df.empty and "is_volume" in df.columns:
        vol_ids = set(df.loc[df["is_volume"].astype(bool), "measure_id"].astype(str))
        out = [m for m in out if str(m) not in vol_ids]
    return out


def filter_payment_benchmark_bundle(
    ids: list[str],
    *,
    question_lower: str,
    intent: str,
    llm_explicit_measure_ids: set[str],
    warnings: list[str],
) -> list[str]:
    """Drop payment/HVBP/EDAC/benchmark rows from hospital comparison bundles unless the LLM pinned the id."""
    hospitalish = intent == "compare_hospitals" or "hospital" in question_lower
    out: list[str] = []
    for mid in ids:
        m = str(mid).strip()
        if m in llm_explicit_measure_ids:
            out.append(m)
            continue
        if not hospitalish:
            out.append(m)
            continue
        u = m.upper()
        if u.startswith(("HVBP_", "PAYM_", "EDAC_")):
            warnings.append(f"Omitted payment/HVBP/EDAC measure from primary bundle: {m}")
            continue
        if "BENCHMARK" in u:
            warnings.append(f"Omitted benchmark measure from primary bundle: {m}")
            continue
        out.append(m)
    return out


def infer_question_signals(question_lower: str) -> dict[str, bool]:
    safest = any(
        k in question_lower
        for k in (
            "safest",
            "best hospital",
            "where should",
            "where to go",
            "top hospital",
            "top hospitals",
            "favorable",
            "compare the best",
            "lowest mortality",
            "best outcomes",
        )
    )
    return {
        "safest": safest,
        "concerning": any(
            k in question_lower
            for k in ("concerning", "worst", "risk", "unsafe", "underperform", "bad outcomes", "poor outcomes")
        ),
        "improved": "improv" in question_lower or "getting better" in question_lower,
        "worsened": "worsen" in question_lower or "deteriorat" in question_lower or "getting worse" in question_lower,
        "overview": any(k in question_lower for k in ("overview", "broad", "comprehensive", "landscape", "summary of")),
    }


def default_hospital_policy_dict(
    *,
    measure_id: str,
    is_volume: bool,
    interpretation: str,
    question_lower: str,
    intent: str,
    legacy_sel: str,
    has_explicit_hospitals: bool,
    ranking_bias: str | None = None,
) -> dict[str, Any]:
    """When LLM omits per-metric policy, derive deterministic defaults from wording and planner ranking_bias."""
    base_sig = infer_question_signals(question_lower)
    if ranking_bias == "favorable":
        sig = {**base_sig, "safest": True, "concerning": False}
    elif ranking_bias == "concerning":
        sig = {**base_sig, "safest": False, "concerning": True}
    elif ranking_bias == "neutral":
        sig = {**base_sig, "safest": False, "concerning": False}
    else:
        sig = base_sig
    _ = (interpretation or "").lower()

    if has_explicit_hospitals:
        return {
            "mode": "explicit_hospitals",
            "state": None,
            "sort": "best",
            "limit": RESEARCH_DEFAULT_RANK_LIMIT,
            "rationale": "Named hospitals in the question.",
        }

    if intent == "compare_geographies" and "hospital" not in question_lower:
        return {
            "mode": "state_overview",
            "state": None,
            "sort": "best",
            "limit": RESEARCH_DEFAULT_RANK_LIMIT,
            "rationale": "State-level comparison without ranked hospitals.",
        }

    if is_volume or str(measure_id).upper().endswith("_VOLUME"):
        return {
            "mode": "ranked_in_state",
            "state": None,
            "sort": "volume_high",
            "limit": RESEARCH_DEFAULT_RANK_LIMIT,
            "rationale": "Volume context for procedural scale.",
        }

    if sig["improved"]:
        return {
            "mode": "ranked_in_state",
            "state": None,
            "sort": "improved",
            "limit": RESEARCH_DEFAULT_RANK_LIMIT,
            "rationale": "Question asks about improvement over time.",
        }
    if sig["worsened"]:
        return {
            "mode": "ranked_in_state",
            "state": None,
            "sort": "worsened",
            "limit": RESEARCH_DEFAULT_RANK_LIMIT,
            "rationale": "Question asks about worsening trends.",
        }

    if sig["concerning"]:
        sort = "worsened" if ("trend" in question_lower or "over time" in question_lower) else "worst"
        return {
            "mode": "ranked_in_state",
            "state": None,
            "sort": sort,
            "limit": RESEARCH_DEFAULT_RANK_LIMIT,
            "rationale": "Concerning / risk-oriented outcome view.",
        }

    if sig["safest"]:
        return {
            "mode": "ranked_in_state",
            "state": None,
            "sort": "best",
            "limit": RESEARCH_DEFAULT_RANK_LIMIT,
            "rationale": "Favorable outcome view for patient-choice style questions.",
        }

    if legacy_sel == "top_ranked_in_state" or "hospital" in question_lower:
        if sig["overview"]:
            sort = "balanced"
        elif ranking_bias == "neutral" and not sig["concerning"]:
            sort = "balanced"
        else:
            sort = "worst"
        return {
            "mode": "ranked_in_state",
            "state": None,
            "sort": sort,
            "limit": RESEARCH_DEFAULT_RANK_LIMIT,
            "rationale": "Hospital-level ranking in selected states.",
        }

    return {
        "mode": "state_overview",
        "state": None,
        "sort": "best",
        "limit": RESEARCH_DEFAULT_RANK_LIMIT,
        "rationale": "Default to state series without ranked hospitals.",
    }


def ranking_policy_overrides_from_defaults(
    *,
    measure_ids: list[str],
    df: pd.DataFrame,
    question_lower: str,
    intent: str,
    legacy_sel: str,
    has_explicit_hospitals: bool,
    ranking_bias: str | None,
) -> dict[str, dict[str, Any]]:
    """Per-measure sort/limit derived from the same rules as ``default_hospital_policy_dict`` (deterministic baseline)."""
    rb = normalize_ranking_bias(ranking_bias) or "neutral"
    out: dict[str, dict[str, Any]] = {}
    for mid in measure_ids:
        sub = df[df["measure_id"].astype(str) == str(mid)]
        if sub.empty:
            is_volume, interpretation = False, ""
        else:
            r0 = sub.iloc[0]
            is_volume = bool(r0.get("is_volume", False))
            interpretation = str(r0.get("interpretation", "") or "")
        pol = default_hospital_policy_dict(
            measure_id=mid,
            is_volume=is_volume,
            interpretation=interpretation,
            question_lower=question_lower,
            intent=intent,
            legacy_sel=legacy_sel,
            has_explicit_hospitals=has_explicit_hospitals,
            ranking_bias=rb,
        )
        out[mid] = {"sort": pol["sort"], "limit": int(pol["limit"])}
    return out


def _search_query_policy_match(
    mid: str,
    candidates: list[Any],
    df: pd.DataFrame,
) -> dict[str, Any] | None:
    """Match planner ``metric_candidates`` to a resolved measure via ``search_query`` vs glossary text."""
    sub = df[df["measure_id"].astype(str) == str(mid)]
    if sub.empty:
        meaning_l = str(mid).lower()
    else:
        meaning_l = str(sub.iloc[0].get("meaning", mid) or mid).lower()
    best: tuple[float, dict[str, Any]] | None = None
    for c in candidates:
        if not getattr(c, "hospital_policy", None):
            continue
        sq = (getattr(c, "search_query", None) or "").strip().lower()
        if len(sq) < 3:
            continue
        if sq in meaning_l or meaning_l in sq:
            score = 1.0
        else:
            toks_a = set(re.findall(r"[a-z0-9]+", sq))
            toks_b = set(re.findall(r"[a-z0-9]+", meaning_l))
            if not toks_a or not toks_b:
                continue
            score = len(toks_a & toks_b) / len(toks_a | toks_b)
            if score < 0.12:
                continue
        pol = c.hospital_policy.model_dump()
        if best is None or score > best[0]:
            best = (score, pol)
    return best[1] if best else None


def _sanitize_policy(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    mode = str(raw.get("mode") or "ranked_in_state").strip().lower()
    if mode not in HOSPITAL_POLICY_MODES:
        mode = "ranked_in_state"
    sort = str(raw.get("sort") or "worst").strip().lower()
    if sort not in RANKING_SORTS:
        sort = "worst"
    st = raw.get("state")
    st_clean = str(st).strip().upper()[:2] if st else None
    if st_clean == "":
        st_clean = None
    lim = raw.get("limit", RESEARCH_MAX_RANKED_HOSPITALS)
    try:
        lim_i = int(lim)
    except (TypeError, ValueError):
        lim_i = RESEARCH_MAX_RANKED_HOSPITALS
    lim_i = max(1, min(RESEARCH_MAX_RANKED_HOSPITALS, lim_i))
    rationale = str(raw.get("rationale") or "")[:500]
    return {"mode": mode, "state": st_clean, "sort": sort, "limit": lim_i, "rationale": rationale}


def _rank_tokens(
    store: Any,
    measure_id_for_rank: str,
    state: str,
    sort: str,
    limit: int,
    warnings: list[str],
) -> list[str]:
    rows, _, extra = rank_hospitals_for_state_measure(
        store,
        measure_id_for_rank,
        state,
        limit=limit,
        sort=sort,  # type: ignore[arg-type]
    )
    if not rows:
        ey = int(extra.get("eligible_with_yoy", 0) or 0)
        if sort in ("improved", "worsened") and ey > 0:
            warnings.append(
                f"No hospitals matched {sort!r} criteria for measure {measure_id_for_rank} in {state} "
                f"({ey} with two-year history; none passed strict improvement sign filter)."
            )
        else:
            warnings.append(f"No ranked hospitals for measure {measure_id_for_rank} in {state} (sort={sort}).")
    return [f"H:{r['ccn']}" for r in rows]


def _rank_balanced(store: Any, measure_id_for_rank: str, state: str, limit: int, warnings: list[str]) -> list[str]:
    half = max(1, limit // 2)
    a = _rank_tokens(store, measure_id_for_rank, state, "worst", half, warnings)
    b = _rank_tokens(store, measure_id_for_rank, state, "best", max(1, limit - len(a)), warnings)
    out: list[str] = []
    for t in a + b:
        if t not in out:
            out.append(t)
        if len(out) >= limit:
            break
    return out[:limit]


def _norm_rank_states(states: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for s in states:
        st = str(s).strip().upper()[:2]
        if len(st) == 2 and st not in seen:
            seen.add(st)
            out.append(st)
    out.sort()
    return out


def _rank_tokens_multi_state(
    store: Any,
    measure_id_for_rank: str,
    states: list[str],
    sort: str,
    limit: int,
    warnings: list[str],
) -> list[str]:
    """Split ``limit`` across states (floor division + remainder to first states in sorted order)."""
    norm = _norm_rank_states(states)
    if not norm:
        return []
    if len(norm) == 1:
        return _rank_tokens(store, measure_id_for_rank, norm[0], sort, limit, warnings)
    n = len(norm)
    per = limit // n
    remainder = limit % n
    budgets = [per + (1 if i < remainder else 0) for i in range(n)]
    per_state: list[list[str]] = []
    for st, bud in zip(norm, budgets, strict=True):
        per_state.append(_rank_tokens(store, measure_id_for_rank, st, sort, bud, warnings) if bud > 0 else [])
    merged: list[str] = []
    max_r = max((len(x) for x in per_state), default=0)
    for r in range(max_r):
        for bucket in per_state:
            if r < len(bucket) and bucket[r] not in merged:
                merged.append(bucket[r])
                if len(merged) >= limit:
                    return merged
    return merged[:limit]


def _rank_balanced_multi_state(
    store: Any, measure_id_for_rank: str, states: list[str], limit: int, warnings: list[str]
) -> list[str]:
    half = max(1, limit // 2)
    a = _rank_tokens_multi_state(store, measure_id_for_rank, states, "worst", half, warnings)
    b = _rank_tokens_multi_state(store, measure_id_for_rank, states, "best", max(1, limit - len(a)), warnings)
    out: list[str] = []
    for t in a + b:
        if t not in out:
            out.append(t)
        if len(out) >= limit:
            break
    return out[:limit]


def resolve_location_tokens_for_metric(
    store: Any,
    measure_id: str,
    *,
    is_volume: bool,
    interpretation: str,
    policy_in: dict[str, Any] | None,
    states: list[str],
    explicit_hospital_tokens: list[str],
    question_lower: str,
    intent: str,
    legacy_hospital_selection: str,
    warnings: list[str],
    max_hospital_locations: int,
    ranking_bias: str | None = None,
) -> tuple[list[str], dict[str, Any]]:
    """Return (location_tokens, hospital_selection_record) for one measure."""
    if policy_in:
        base = default_hospital_policy_dict(
            measure_id=measure_id,
            is_volume=is_volume,
            interpretation=interpretation,
            question_lower=question_lower,
            intent=intent,
            legacy_sel=legacy_hospital_selection,
            has_explicit_hospitals=bool(explicit_hospital_tokens),
            ranking_bias=ranking_bias,
        )
        pol = _sanitize_policy({**base, **_sanitize_policy(policy_in)})
    else:
        pol = default_hospital_policy_dict(
            measure_id=measure_id,
            is_volume=is_volume,
            interpretation=interpretation,
            question_lower=question_lower,
            intent=intent,
            legacy_sel=legacy_hospital_selection,
            has_explicit_hospitals=bool(explicit_hospital_tokens),
            ranking_bias=ranking_bias,
        )

    state_tokens = [f"S:{str(s).strip().upper()[:2]}" for s in states if str(s).strip()][:12]
    st_for_rank = pol.get("state") or (states[0] if states else "")
    st_for_rank = str(st_for_rank).strip().upper()[:2] if st_for_rank else ""

    mode = pol["mode"]
    sort = pol["sort"]
    lim = min(int(pol["limit"]), max_hospital_locations)

    rank_measure = measure_id
    if sort in ("volume_high", "volume_low"):
        sib = volume_sibling_id(store, measure_id)
        if sib:
            rank_measure = sib
        elif not is_volume:
            warnings.append(f"No volume sibling for {measure_id}; ranking with outcome measure for sort={sort}.")

    hs_record: dict[str, Any] = {
        "mode": mode,
        "sort": sort,
        "limit": lim,
        "rationale": pol.get("rationale") or "",
        "state": st_for_rank or None,
    }

    if mode == "state_overview" or mode == "none":
        return state_tokens, hs_record

    if mode == "explicit_hospitals":
        toks = list(dict.fromkeys(state_tokens + explicit_hospital_tokens[:max_hospital_locations]))
        return toks[: max_hospital_locations + len(state_tokens)], hs_record

    if mode == "ranked_in_state":
        explicit = pol.get("state")
        explicit_st = str(explicit).strip().upper()[:2] if explicit else ""
        ranked_states = [explicit_st] if explicit_st and len(explicit_st) == 2 else _norm_rank_states(states)
        if not ranked_states:
            warnings.append("Hospital ranking requested but no valid state; falling back to state tokens only.")
            return state_tokens, {**hs_record, "state": None}

        if len(ranked_states) > 1:
            hs_record = {**hs_record, "state": None, "states_ranked": ranked_states}
        else:
            hs_record = {**hs_record, "state": ranked_states[0]}

        if sort == "balanced":
            ranked = (
                _rank_balanced_multi_state(store, rank_measure, ranked_states, lim, warnings)
                if len(ranked_states) > 1
                else _rank_balanced(store, rank_measure, ranked_states[0], lim, warnings)
            )
        else:
            ranked = (
                _rank_tokens_multi_state(store, rank_measure, ranked_states, sort, lim, warnings)
                if len(ranked_states) > 1
                else _rank_tokens(store, rank_measure, ranked_states[0], sort, lim, warnings)
            )
        merged = list(dict.fromkeys(state_tokens + ranked))[: max_hospital_locations + len(state_tokens)]
        return merged, {**hs_record, "ranked_measure_id": rank_measure}

    if mode == "ranked_national":
        if not st_for_rank or len(st_for_rank) != 2:
            warnings.append("Hospital ranking requested but no valid state; falling back to state tokens only.")
            return state_tokens, {**hs_record, "state": None}
        if sort == "balanced":
            ranked = _rank_balanced(store, rank_measure, st_for_rank, lim, warnings)
        else:
            ranked = _rank_tokens(store, rank_measure, st_for_rank, sort, lim, warnings)
        merged = list(dict.fromkeys(state_tokens + ranked))[: max_hospital_locations + len(state_tokens)]
        return merged, {**hs_record, "state": st_for_rank, "ranked_measure_id": rank_measure}

    return state_tokens, hs_record


def _drop_baseline_measures_if_unasked(ids: list[str], question_lower: str) -> list[str]:
    q = question_lower.lower()
    if "baseline" in q or "risk-adjust" in q or "risk adjust" in q or "risk adjusted" in q:
        return ids
    return [m for m in ids if "baseline" not in str(m).lower()]


def resolve_research_metric_ids(
    df: pd.DataFrame,
    queries: list[str],
    store_ids: set[str],
    *,
    max_metrics: int,
    warnings: list[str],
    question_lower: str = "",
) -> list[str]:
    """Lexical union then diversify (caller may append volume siblings)."""
    base = resolve_measures_from_glossary(
        df,
        queries,
        store_ids,
        cap=max(max_metrics * 3, 18),
        warnings=warnings,
    )
    base = _drop_baseline_measures_if_unasked(base, question_lower)
    sig = infer_question_signals(question_lower)
    max_per = 10 if sig["overview"] else 2
    return diversify_measures(base, max_n=max_metrics, max_per_family=max_per)
