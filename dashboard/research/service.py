"""Research orchestration: compact glossary menu, LLM plan, guarded retrieve, grounded summary."""

from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any

import httpx
import pandas as pd
from pydantic import TypeAdapter

from dashboard.data import search_locations
from dashboard.glossary import build_glossary
from dashboard.metrics_rank import rank_glossary_matches
from dashboard.query import fetch_series, get_store

from .llm_provider import OllamaLLMProvider, StubLLMProvider
from .metric_index import run_metric_rag_selection
from .ollama_client import ollama_configured
from .research_resolution import (
    RANKING_SORTS,
    RESEARCH_MAX_RANKED_HOSPITALS,
    _sanitize_policy,
    _search_query_policy_match,
    ccn_state,
    collect_metric_queries_for_rag,
    drop_volume_measure_ids,
    filter_measures_by_availability,
    filter_payment_benchmark_bundle,
    hospitals_from_hints,
    normalize_ranking_bias,
    ranking_policy_overrides_from_defaults,
    resolve_location_tokens_for_metric,
    specialty_extra_queries,
    top_hospitals_ranked,
)
from .schemas import (
    EvidencePanelModel,
    HighlightSpanModel,
    MetricCatalogItem,
    MetricCatalogResponse,
    PlanningEventModel,
    ResearchHealthResponse,
    ResearchMetricCandidateModel,
    ResearchMetricsSearchBody,
    ResearchHospitalsSearchBody,
    ResearchPlanModel,
    ResearchPlanResponse,
    ResearchRetrieveResponse,
    ResearchSessionSlotsModel,
    ResearchSummaryResponse,
)

MAX_MEASURES_IN_PLAN = 10
MAX_MEASURES_RETRIEVE = 12
COMPACT_MENU_LIMIT = 72
MAX_ROWS_PER_MEASURE = 900
MAX_HOSPITAL_LOCATIONS = RESEARCH_MAX_RANKED_HOSPITALS
MAX_STATE_LOCATIONS = 12

_llm_singleton: StubLLMProvider | OllamaLLMProvider | None = None

_US_STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
    "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
    "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR",
    "VI", "GU", "AS", "MP",
}

_HOSP_TOKEN = re.compile(r"^H:\d{6}$")

# Two-letter US state codes that are also common English words when lowercased (e.g. "in", "or", "me", "ok").
_STATE_CODE_LOWERCASE_HOMOGRAPHS = frozenset({"IN", "OR", "ME", "OK"})


class ResearchPlannerError(Exception):
    """Upstream LLM or JSON failure; safe to surface as HTTP 502 (no secrets)."""


def get_llm() -> StubLLMProvider | OllamaLLMProvider:
    global _llm_singleton
    if _llm_singleton is None:
        if ollama_configured():
            _llm_singleton = OllamaLLMProvider()
        else:
            _llm_singleton = StubLLMProvider()
    return _llm_singleton


def research_health() -> ResearchHealthResponse:
    from .llm_provider import _default_model

    ok = ollama_configured()
    return ResearchHealthResponse(ollama_configured=ok, model=_default_model() if ok else None)


def _measure_tags(measure_id: str) -> list[str]:
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
    return tags


def metric_catalog(*, limit: int, cursor: str | None) -> MetricCatalogResponse:
    df = build_glossary()
    if df.empty:
        return MetricCatalogResponse(items=[], next_cursor=None)
    df = df.sort_values("measure_id")
    if cursor:
        df = df[df["measure_id"] > cursor]
    chunk = df.head(max(1, min(limit, 500)))
    items: list[MetricCatalogItem] = []
    for _, r in chunk.iterrows():
        mid = str(r["measure_id"])
        items.append(
            MetricCatalogItem(
                measure_id=mid,
                title=str(r["meaning"])[:2000],
                interpretation=str(r["interpretation"]),
                is_volume=bool(r.get("is_volume", False)),
                tags=_measure_tags(mid),
            )
        )
    next_cursor: str | None = None
    if len(chunk) == max(1, min(limit, 500)):
        next_cursor = str(chunk.iloc[-1]["measure_id"])
    return MetricCatalogResponse(items=items, next_cursor=next_cursor)


def compact_metric_menu(df: pd.DataFrame, question: str, *, limit: int = COMPACT_MENU_LIMIT) -> list[dict[str, Any]]:
    """Top glossary rows for the LLM (measure_id + short text only); never full 1k+ list."""
    q = (question or "").strip()
    q_lower = q.lower()
    queries = [q if q else "hospital quality measure"]
    queries.extend(specialty_extra_queries(q_lower))
    seen_score: dict[str, float] = {}
    merged: dict[str, dict[str, Any]] = {}
    for qq in queries:
        hits = rank_glossary_matches(df, qq, limit=min(80, max(limit, 40)))
        for h in hits:
            mid = str(h["measure_id"])
            sc = float(h.get("score") or 0.0)
            if mid not in seen_score or sc > seen_score[mid]:
                seen_score[mid] = sc
                merged[mid] = {
                    "measure_id": mid,
                    "label": str(h.get("label") or "")[:400],
                    "snippet": str(h.get("snippet") or "")[:280],
                }
    ranked = sorted(merged.keys(), key=lambda m: -seen_score.get(m, 0.0))
    out = [merged[m] for m in ranked[:limit]]
    if len(out) < min(limit, 40) and not df.empty:
        have = {m["measure_id"] for m in out}
        for _, r in df.sort_values("measure_id").iterrows():
            mid = str(r["measure_id"])
            if mid in have:
                continue
            meaning = str(r["meaning"])
            out.append(
                {
                    "measure_id": mid,
                    "label": meaning[:400],
                    "snippet": meaning[:280],
                }
            )
            have.add(mid)
            if len(out) >= limit:
                break
    return out[:limit]


def _default_planning_events(rationale: str) -> list[PlanningEventModel]:
    r = (rationale or "").strip()[:240]
    return [
        PlanningEventModel(id="parse_intent", label="Parse intent", detail="Understood the question scope."),
        PlanningEventModel(id="choose_measures", label="Choose measures", detail=r or "Ranked measures against the compact catalog."),
        PlanningEventModel(id="validate_plan", label="Validate", detail="Intersected model picks with dataset measure ids."),
        PlanningEventModel(id="retrieve", label="Retrieve", detail="Ready to pull series for approved measures and locations."),
        PlanningEventModel(id="summarize", label="Summarize", detail="Awaiting retrieval snapshot for grounded narrative."),
    ]


def _coerce_planning_events(raw: Any, rationale: str) -> list[PlanningEventModel]:
    ta = TypeAdapter(list[PlanningEventModel])
    if isinstance(raw, list) and raw:
        try:
            return ta.validate_python(raw)
        except Exception:
            pass
    return _default_planning_events(rationale)


def _coerce_highlights(raw: Any) -> list[HighlightSpanModel]:
    if not isinstance(raw, list):
        return []
    out: list[HighlightSpanModel] = []
    for item in raw[:24]:
        if isinstance(item, HighlightSpanModel):
            out.append(item)
            continue
        if isinstance(item, dict) and item.get("term"):
            try:
                out.append(HighlightSpanModel.model_validate(item))
            except Exception:
                continue
    return out


def _merge_session_geography(
    merged_states: list[str],
    session_slots: ResearchSessionSlotsModel | None,
) -> list[str]:
    """Union validated slot geography with LLM/question-derived states."""
    if not session_slots or not session_slots.geography:
        return merged_states
    geo = session_slots.geography
    extra: set[str] = set()
    for s in geo.states:
        u = str(s).strip().upper()[:2]
        if len(u) == 2 and u in _US_STATE_CODES:
            extra.add(u)
    out = sorted(set(merged_states) | extra)
    return [s for s in out if s in _US_STATE_CODES][:MAX_STATE_LOCATIONS]


def _blocked_evidence_panel(snapshot: dict[str, Any]) -> EvidencePanelModel:
    rd = snapshot.get("readiness") if isinstance(snapshot.get("readiness"), dict) else {}
    warns = [str(w) for w in (rd.get("warnings") or []) if str(w).strip()]
    q = str(snapshot.get("question") or "").strip()
    md_lines = [
        "## Evidence not ready",
        "",
        "Retrieval did not return enough structured series to support a confident numeric research summary.",
        "",
        "### What went wrong",
    ]
    for w in warns[:16]:
        md_lines.append(f"- {w}")
    if not warns:
        md_lines.append("- No rows were retrieved for the selected measures and locations, or coverage was blocked.")
    md_lines.extend(["", "### Next steps", "- Adjust geography or hospitals, narrow measures, or answer a clarification prompt and run again."])
    md = "\n".join(md_lines)
    return EvidencePanelModel(
        title="Insufficient evidence for synthesis",
        abstract=(
            "The retrieval snapshot is empty or blocked. The narrative model was skipped so no numbers or hospitals would be invented."
            + (f" Original question: {q[:500]}" if q else "")
        ),
        key_findings=[],
        retrieval_scope=[f"Readiness status: **{rd.get('status', 'blocked')}**"],
        limitations=warns or ["No series rows in snapshot."],
        markdown=md,
    )


def _merge_states(llm_states: list[str], question: str) -> list[str]:
    """Merge LLM state list with codes found in the question.

    Avoids false positives from ``question.upper()`` (e.g. the preposition "in" → ``IN``).
    """
    found: set[str] = set()
    for m in re.finditer(r"\b[a-zA-Z]{2}\b", question or ""):
        tok = m.group(0)
        u = tok.upper()[:2]
        if u not in _US_STATE_CODES:
            continue
        if tok.islower() and u in _STATE_CODE_LOWERCASE_HOMOGRAPHS:
            continue
        found.add(u)
    merged = sorted({str(s).strip().upper()[:2] for s in llm_states if str(s).strip()} | found)
    return [s for s in merged if s in _US_STATE_CODES][:MAX_STATE_LOCATIONS]


def _filter_hospital_tokens(tokens: list[str], store: Any) -> tuple[list[str], list[str]]:
    warnings: list[str] = []
    out: list[str] = []
    ccn_set = set(store.hospital_meta.index.astype(str)) if hasattr(store, "hospital_meta") and not store.hospital_meta.empty else set()
    for t in tokens:
        t = str(t).strip()
        if not _HOSP_TOKEN.match(t):
            warnings.append(f"Ignored invalid hospital token (expected H:######): {t!r}")
            continue
        ccn = t.split(":", 1)[1]
        if ccn_set and ccn not in ccn_set:
            warnings.append(f"Unknown hospital CCN dropped from plan: {ccn}")
            continue
        out.append(t)
    return out[:MAX_HOSPITAL_LOCATIONS], warnings


def research_metrics_search(body: ResearchMetricsSearchBody) -> dict[str, Any]:
    df = build_glossary()
    hits = rank_glossary_matches(df, body.q.strip(), limit=body.limit)
    for h in hits:
        h.pop("score", None)
    return {"query": body.q, "metrics": hits, "count": len(hits)}


def research_hospitals_search(body: ResearchHospitalsSearchBody) -> dict[str, Any]:
    store = get_store()
    opts = search_locations(store, body.q.strip(), limit=body.limit)
    if body.state:
        stf = body.state.strip().upper()[:2]
        filtered: list[dict[str, Any]] = []
        for opt in opts:
            val = opt.get("value")
            if not isinstance(val, str) or not val.startswith("H:"):
                continue
            ccn = val.split(":", 1)[1].strip()
            cs = ccn_state(store, ccn)
            if cs == stf:
                filtered.append(opt)
        opts = filtered[: body.limit]
    return {"query": body.q, "state": body.state, "options": opts, "count": len(opts)}


def _truncate_json_for_debug(obj: Any, *, max_chars: int = 120_000) -> Any:
    try:
        s = json.dumps(obj, ensure_ascii=False, default=str)
        if len(s) <= max_chars:
            return obj
        return {"_truncated": True, "_preview_chars": max_chars, "_preview": s[:max_chars]}
    except Exception:
        return {"_error": "unserializable"}


def _glossary_row(df: pd.DataFrame, mid: str) -> dict[str, Any]:
    sub = df[df["measure_id"].astype(str) == str(mid)]
    if sub.empty:
        return {"meaning": mid, "interpretation": "", "is_volume": False}
    r = sub.iloc[0]
    return {
        "meaning": str(r.get("meaning", mid)),
        "interpretation": str(r.get("interpretation", "") or ""),
        "is_volume": bool(r.get("is_volume", False)),
    }


def _parse_metric_candidates(raw: dict[str, Any]) -> list[ResearchMetricCandidateModel]:
    out: list[ResearchMetricCandidateModel] = []
    for item in raw.get("metric_candidates") or []:
        if not isinstance(item, dict):
            continue
        try:
            out.append(ResearchMetricCandidateModel.model_validate(item))
        except Exception:
            stripped = {k: v for k, v in item.items() if k != "hospital_policy"}
            try:
                out.append(ResearchMetricCandidateModel.model_validate(stripped))
            except Exception:
                continue
    return out[:14]


def _validate_llm_ranking_policies(raw: Any, allowed_ids: set[str]) -> dict[str, dict[str, Any]]:
    """Validate micro-planner JSON: only known measure_ids and enum sorts."""
    out: dict[str, dict[str, Any]] = {}
    if isinstance(raw, dict):
        inner = raw.get("measures") or raw.get("policies")
        if isinstance(inner, list):
            raw = inner
    if not isinstance(raw, list):
        return out
    for item in raw:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("measure_id") or "").strip()
        if mid not in allowed_ids:
            continue
        sort = str(item.get("sort") or "").strip().lower()
        if sort not in RANKING_SORTS:
            continue
        try:
            lim_i = int(item.get("limit"))
        except (TypeError, ValueError):
            continue
        if lim_i < 1 or lim_i > RESEARCH_MAX_RANKED_HOSPITALS:
            continue
        out[mid] = {"sort": sort, "limit": lim_i}
    return out


def _merge_ranking_policy_overrides(
    llm: Any,
    *,
    question: str,
    ranking_bias: str,
    final_measures: list[str],
    df: pd.DataFrame,
    intent: str,
    legacy_sel: str,
    has_explicit_hospitals: bool,
    question_lower: str,
    resolution_notes: list[str],
) -> dict[str, dict[str, Any]]:
    base = ranking_policy_overrides_from_defaults(
        measure_ids=final_measures,
        df=df,
        question_lower=question_lower,
        intent=intent,
        legacy_sel=legacy_sel,
        has_explicit_hospitals=has_explicit_hospitals,
        ranking_bias=ranking_bias,
    )
    fn = getattr(llm, "plan_ranking_policies", None)
    if fn is None:
        return base
    measures_payload: list[dict[str, Any]] = []
    for mid in final_measures:
        gr = _glossary_row(df, mid)
        measures_payload.append(
            {
                "measure_id": mid,
                "title": str(gr["meaning"])[:360],
                "interpretation": str(gr["interpretation"])[:480],
                "is_volume": bool(gr["is_volume"]),
            }
        )
    try:
        raw = fn(
            question.strip(),
            ranking_bias=ranking_bias,
            measures=measures_payload,
            plan_context={
                "intent": intent,
                "hospital_selection": legacy_sel,
                "has_explicit_hospitals": has_explicit_hospitals,
            },
        )
    except Exception as e:  # noqa: BLE001 — micro-planner must never break planning
        resolution_notes.append(f"Ranking policy micro-plan skipped ({type(e).__name__}).")
        return base
    validated = _validate_llm_ranking_policies(raw, set(final_measures))
    if not validated and raw not in (None, [], {}):
        resolution_notes.append("Ranking policy micro-plan returned no valid rows; using server defaults.")
    for mid, patch in validated.items():
        if mid not in base:
            continue
        merged = _sanitize_policy({"sort": patch.get("sort"), "limit": patch.get("limit")})
        base[mid] = {"sort": merged["sort"], "limit": int(merged["limit"])}
    return base


def _build_evidence_digest(
    series_by_measure: dict[str, Any],
    *,
    max_hospitals_per_measure: int = 18,
) -> dict[str, Any]:
    """Compact hospital-value peek from retrieved rows (same entities as ranking fetch)."""
    by_measure: dict[str, Any] = {}
    for mid, block in series_by_measure.items():
        if not isinstance(block, dict):
            continue
        rows = block.get("rows") or []
        if not isinstance(rows, list):
            continue
        hosp_rows: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            ev = str(row.get("entity_value", "") or "")
            if not ev.startswith("H:"):
                continue
            try:
                y = int(row["year"])
            except (KeyError, TypeError, ValueError):
                continue
            try:
                val = float(row.get("value"))
            except (TypeError, ValueError):
                continue
            hosp_rows.append(
                {
                    "entity_value": ev,
                    "label": str(row.get("label", ""))[:180],
                    "year": y,
                    "value": val,
                }
            )
        latest_by_h: dict[str, dict[str, Any]] = {}
        for r in hosp_rows:
            ev = r["entity_value"]
            prev = latest_by_h.get(ev)
            if prev is None or int(r["year"]) > int(prev["year"]):
                latest_by_h[ev] = r
        peeks = sorted(latest_by_h.values(), key=lambda x: abs(float(x["value"])), reverse=True)[
            :max_hospitals_per_measure
        ]
        by_measure[str(mid)] = {
            "hospital_peek": peeks,
            "n_rows": len(rows),
            "n_hospital_points": len(hosp_rows),
        }
    return {"version": 1, "by_measure": by_measure}


def _policy_for_measure(
    mid: str,
    candidates: list[ResearchMetricCandidateModel],
    overrides: dict[str, dict[str, Any]] | None,
    df: pd.DataFrame | None,
) -> dict[str, Any] | None:
    for c in candidates:
        if c.measure_id and str(c.measure_id).strip() == mid and c.hospital_policy:
            return c.hospital_policy.model_dump()
    if overrides and mid in overrides:
        o = overrides[mid]
        if o:
            return dict(o)
    if df is not None and candidates:
        matched = _search_query_policy_match(mid, candidates, df)
        if matched:
            return matched
    return None


def _why_for_measure(mid: str, candidates: list[ResearchMetricCandidateModel], df: pd.DataFrame | None) -> str:
    for c in candidates:
        if c.measure_id and str(c.measure_id).strip() == mid and (c.rationale or "").strip():
            return str(c.rationale).strip()[:500]
    if df is not None:
        sub = df[df["measure_id"].astype(str) == str(mid)]
        meaning_l = str(sub.iloc[0].get("meaning", mid) or mid).lower() if not sub.empty else str(mid).lower()
        best: tuple[float, str] | None = None
        for c in candidates:
            rat = (c.rationale or "").strip()
            if not rat:
                continue
            sq = (c.search_query or "").strip().lower()
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
            if best is None or score > best[0]:
                best = (score, rat[:500])
        if best:
            return best[1]
    return ""


def research_plan(
    question: str,
    conversation_context: str | None = None,
    session_slots: ResearchSessionSlotsModel | None = None,
) -> ResearchPlanResponse:
    store = get_store()
    valid_measure_set = set(store.measure_ids)
    df = build_glossary()
    menu = compact_metric_menu(df, (question or "").strip() or "hospital quality measure")
    planner_context: dict[str, Any] = {
        "dataset": {
            "n_measures": len(valid_measure_set),
            "n_hospital_ccns": len(store.hospital_entity_ids),
        },
        "sample_catalog_rows": menu[:48],
    }
    llm = get_llm()
    try:
        raw = llm.plan(
            question,
            planner_context=planner_context,
            conversation_context=conversation_context,
        )
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        if code == 401:
            raise ResearchPlannerError("Ollama authentication failed. Check API key configuration.") from e
        raise ResearchPlannerError("Ollama request failed (HTTP error).") from e
    except httpx.TimeoutException as e:
        raise ResearchPlannerError("Ollama request timed out.") from e
    except (json.JSONDecodeError, ValueError, TypeError, KeyError) as e:
        raise ResearchPlannerError("Planner returned invalid JSON.") from e
    except RuntimeError as e:
        raise ResearchPlannerError(str(e)) from e

    if not isinstance(raw, dict):
        raise ResearchPlannerError("Planner returned a non-object JSON root.")

    rationale = str(raw.get("rationale") or "").strip()
    planning_events = _coerce_planning_events(raw.get("planning_events"), rationale)
    resolution_notes: list[str] = []

    intent_raw = raw.get("intent", "unknown")
    allowed_int = {"compare_geographies", "compare_hospitals", "explore", "unknown"}
    if intent_raw not in allowed_int:
        intent_raw = "unknown"

    needs_clarification = bool(raw.get("needs_clarification"))
    clarifying_questions = [str(x).strip() for x in (raw.get("clarifying_questions") or []) if str(x).strip()][:3]

    merged_states = _merge_states(list(raw.get("states") or []), question)
    merged_states = _merge_session_geography(merged_states, session_slots)
    if not merged_states:
        resolution_notes.append("No U.S. states inferred from the question or planner; state-level series are omitted until geography is specified.")

    clinical_themes = [str(x).strip() for x in (raw.get("clinical_themes") or []) if str(x).strip()][:12]
    llm_metric_queries = [str(x).strip() for x in (raw.get("metric_search_queries") or []) if str(x).strip()][:12]
    hint_extra = [str(x).strip() for x in (raw.get("explicit_hospital_hints") or []) if str(x).strip()][:8]
    hospital_hints = [str(x).strip() for x in (raw.get("hospital_natural_hints") or []) if str(x).strip()][:8]
    hospital_hints = list(dict.fromkeys([*hint_extra, *hospital_hints]))[:12]

    candidates = _parse_metric_candidates(raw)

    sel = str(raw.get("hospital_selection") or "none").strip().lower()
    if sel not in ("none", "search_hints", "top_ranked_in_state"):
        sel = "none"

    compare_focus_raw = str(raw.get("compare_focus") or "balanced").strip().lower()
    if compare_focus_raw not in ("metrics_first", "hospitals_first", "balanced"):
        compare_focus_raw = "balanced"

    qblob = (question or "").strip().lower()
    ranking_bias_effective = normalize_ranking_bias(raw.get("ranking_bias")) or "neutral"
    if sel == "none" and hospital_hints:
        sel = "search_hints"

    explicit_measure_order = [
        str(x).strip()
        for x in (raw.get("measure_ids") or [])
        if isinstance(x, (str, int, float))
        and 2 <= len(str(x).strip()) <= 48
        and str(x).strip() in valid_measure_set
    ]
    explicit_measure_order = list(dict.fromkeys(explicit_measure_order))
    llm_explicit_measure_ids: set[str] = set(explicit_measure_order)

    rag_queries = collect_metric_queries_for_rag(raw, question, session_slots=session_slots)
    seen_q: set[str] = set()
    deduped_rag: list[str] = []
    for e in rag_queries:
        k = e.strip().lower()
        if len(k) < 2 or k in seen_q:
            continue
        seen_q.add(k)
        deduped_rag.append(e.strip())
    rag_queries = deduped_rag[:20]
    if not rag_queries:
        rag_queries = [(question or "quality").strip()[:500]]
    effective_queries = list(rag_queries)

    metric_rag_debug: dict[str, Any] = {}
    metric_rag_pool_order: list[str] = []
    final_measures: list[str] = []
    if not needs_clarification:

        def _maybe_llm_pick(cands: list[dict[str, Any]]) -> dict[str, Any] | None:
            if os.environ.get("CMS_QUALITY_METRIC_LLM_PICKER", "").strip().lower() not in ("1", "true", "yes"):
                return None
            if not ollama_configured():
                return None
            if not isinstance(llm, OllamaLLMProvider):
                return None
            return llm.pick_metrics_from_candidates(
                question=question,
                clinical_themes=clinical_themes,
                candidates=cands,
                max_metrics=MAX_MEASURES_IN_PLAN,
            )

        rag_result = run_metric_rag_selection(
            df,
            valid_measure_set,
            rag_queries,
            top_k_per_query=14,
            pool_cap=50,
            max_per_coarse_branch=12,
            max_final_metrics=MAX_MEASURES_IN_PLAN,
            llm_picker=_maybe_llm_pick,
        )
        metric_rag_pool_order = [
            str(m.get("measure_id")) for m in (rag_result.get("merged_candidates") or []) if m.get("measure_id")
        ]
        metric_rag_debug = {k: v for k, v in rag_result.items() if k != "final_measure_ids"}
        for w in rag_result.get("warnings") or []:
            if isinstance(w, str) and w.strip():
                resolution_notes.append(w.strip())
        merged_pick = list(dict.fromkeys([*explicit_measure_order, *rag_result["final_measure_ids"]]))
        final_measures = merged_pick[:MAX_MEASURES_IN_PLAN]

    if not final_measures and not needs_clarification:
        top = next((str(m["measure_id"]) for m in menu if str(m["measure_id"]) in valid_measure_set), None)
        if top:
            resolution_notes.append("No glossary intersection from queries; using compact-menu top match.")
            final_measures = [top]
        else:
            needs_clarification = True
            clarifying_questions = (
                clarifying_questions
                or ["Which states or hospitals should we compare?", "Which clinical area (e.g. heart failure, readmissions)?"]
            )[:3]

    if not needs_clarification and final_measures:
        final_measures = drop_volume_measure_ids(final_measures, df)
        final_measures = filter_payment_benchmark_bundle(
            final_measures,
            question_lower=qblob,
            intent=str(intent_raw),
            llm_explicit_measure_ids=llm_explicit_measure_ids,
            warnings=resolution_notes,
        )

    if not needs_clarification and sel == "none" and hospital_hints:
        sel = "search_hints"

    if (
        not needs_clarification
        and sel == "none"
        and final_measures
        and merged_states
        and (intent_raw == "compare_hospitals" or "hospital" in qblob)
    ):
        sel = "top_ranked_in_state"
        resolution_notes.append("Inferred hospital_selection=top_ranked_in_state from intent or question wording.")

    hosp_explicit, hosp_warnings = _filter_hospital_tokens(list(raw.get("hospital_tokens") or []), store)
    resolution_notes.extend(hosp_warnings)
    merged_hospitals: list[str] = list(dict.fromkeys(hosp_explicit))

    allow_states = {s.upper()[:2] for s in merged_states} if merged_states else None
    if not needs_clarification and hospital_hints and sel in ("search_hints", "top_ranked_in_state"):
        from_hints = hospitals_from_hints(
            store,
            hospital_hints,
            allow_states,
            max_hospitals=MAX_HOSPITAL_LOCATIONS,
            warnings=resolution_notes,
        )
        for h in from_hints:
            if h not in merged_hospitals:
                merged_hospitals.append(h)

    has_any_hospital = any(isinstance(h, str) and h.startswith("H:") for h in merged_hospitals)
    if (
        not needs_clarification
        and final_measures
        and sel == "top_ranked_in_state"
        and not merged_states
        and not has_any_hospital
    ):
        needs_clarification = True
        resolution_notes.append(
            "Hospital ranking (top_ranked_in_state) requires at least one state, named hospitals (H: tokens), "
            "or hospital search hints that resolve to facilities."
        )
        geo_q = [
            "Which U.S. state(s) should we rank hospitals in?",
            "Or name specific hospitals or cities to search for.",
        ]
        clarifying_questions = list(dict.fromkeys([*geo_q, *clarifying_questions]))[:3]

    resolved_retrieval: dict[str, Any] | None = None
    ranking_overrides: dict[str, dict[str, Any]] = {}
    if not needs_clarification and final_measures:
        if metric_rag_pool_order:
            final_measures = filter_measures_by_availability(
                store,
                final_measures,
                state_codes=merged_states,
                hospital_tokens=merged_hospitals,
                include_national=bool(raw.get("include_national", True)),
                replacement_candidates=metric_rag_pool_order,
                warnings=resolution_notes,
            )
        pinned_hospitals = [h for h in merged_hospitals if isinstance(h, str) and h.startswith("H:")]
        ranking_overrides = _merge_ranking_policy_overrides(
            llm,
            question=question.strip(),
            ranking_bias=ranking_bias_effective,
            final_measures=final_measures,
            df=df,
            intent=str(intent_raw),
            legacy_sel=sel,
            has_explicit_hospitals=bool(pinned_hospitals),
            question_lower=qblob,
            resolution_notes=resolution_notes,
        )
        metric_requests: list[dict[str, Any]] = []
        for mid in final_measures:
            gr = _glossary_row(df, mid)
            pol = _policy_for_measure(mid, candidates, ranking_overrides, df)
            why = _why_for_measure(mid, candidates, df) or "Resolved from metric catalog relevance to the question."
            locs, hs_rec = resolve_location_tokens_for_metric(
                store,
                mid,
                is_volume=bool(gr["is_volume"]),
                interpretation=str(gr["interpretation"]),
                policy_in=pol,
                states=merged_states,
                explicit_hospital_tokens=merged_hospitals,
                question_lower=qblob,
                intent=str(intent_raw),
                legacy_hospital_selection=sel,
                warnings=resolution_notes,
                max_hospital_locations=MAX_HOSPITAL_LOCATIONS,
                ranking_bias=ranking_bias_effective,
            )
            metric_requests.append(
                {
                    "measure_id": mid,
                    "measure_name": str(gr["meaning"])[:2000],
                    "interpretation": str(gr["interpretation"])[:2000],
                    "is_volume": bool(gr["is_volume"]),
                    "why_selected": why,
                    "location_tokens": locs,
                    "hospital_selection": hs_rec,
                }
            )
        union_h: list[str] = []
        for h in pinned_hospitals:
            if h not in union_h:
                union_h.append(h)
        for rq in metric_requests:
            for t in rq.get("location_tokens") or []:
                if isinstance(t, str) and t.startswith("H:") and t not in union_h:
                    union_h.append(t)
        merged_hospitals = union_h[:MAX_HOSPITAL_LOCATIONS]
        retrieval_intent = str(raw.get("retrieval_intent") or raw.get("intent_summary") or rationale)[:2000]
        include_national_flag = bool(raw.get("include_national", True))
        resolved_retrieval = {
            "question": question.strip(),
            "intent": retrieval_intent,
            "states": merged_states,
            "include_national": include_national_flag,
            "metric_requests": metric_requests,
        }
    else:
        if (
            not needs_clarification
            and sel == "top_ranked_in_state"
            and final_measures
            and merged_states
            and len(merged_hospitals) < MAX_HOSPITAL_LOCATIONS
        ):
            primary = final_measures[0]
            ranked = top_hospitals_ranked(
                store,
                primary,
                merged_states,
                max_hospitals=MAX_HOSPITAL_LOCATIONS,
                max_states=MAX_STATE_LOCATIONS,
                warnings=resolution_notes,
            )
            for h in ranked:
                if h not in merged_hospitals:
                    merged_hospitals.append(h)
                if len(merged_hospitals) >= MAX_HOSPITAL_LOCATIONS:
                    break
        merged_hospitals = merged_hospitals[:MAX_HOSPITAL_LOCATIONS]

    highlights = _coerce_highlights(raw.get("highlight_spans"))

    metric_queries_display = effective_queries[:12] if effective_queries else llm_metric_queries

    retrieval_intent_val = str(raw.get("retrieval_intent") or raw.get("intent_summary") or rationale)[:2000]
    include_national_flag = bool(raw.get("include_national", True))

    plan_debug_payload: dict[str, Any] = {
        "user_question": question.strip(),
        "conversation_context": (conversation_context or "").strip()[:4000] or None,
        "session_slots": session_slots.model_dump(mode="json") if session_slots else None,
        "effective_queries": list(effective_queries),
        "merged_states": merged_states,
        "hospital_selection_effective": sel,
        "intent": intent_raw,
        "ranking_bias_effective": ranking_bias_effective,
        "llm_explicit_measure_ids": sorted(llm_explicit_measure_ids),
        "ranking_policy_effective": ranking_overrides,
        "resolution_notes": list(resolution_notes),
        "resolved_retrieval": resolved_retrieval,
        "planning_events": [e.model_dump() for e in planning_events],
        "raw_planner": _truncate_json_for_debug(raw),
    }
    if metric_rag_debug:
        metric_rag_debug["final_measures"] = list(final_measures)
        plan_debug_payload["metric_rag"] = metric_rag_debug

    plan = ResearchPlanModel(
        states=merged_states,
        hospital_tokens=merged_hospitals,
        measure_ids=final_measures,
        intent=intent_raw,  # type: ignore[arg-type]
        year_range=raw.get("year_range"),
        needs_clarification=needs_clarification,
        clarifying_questions=clarifying_questions,
        highlight_spans=highlights,
        clinical_themes=clinical_themes,
        metric_search_queries=metric_queries_display,
        hospital_natural_hints=hospital_hints,
        explicit_hospital_hints=hint_extra,
        hospital_selection=sel,  # type: ignore[arg-type]
        compare_focus=compare_focus_raw,  # type: ignore[arg-type]
        retrieval_intent=retrieval_intent_val,
        include_national=include_national_flag,
        metric_candidates=[c.model_dump() for c in candidates],
        ranking_bias=ranking_bias_effective,  # type: ignore[arg-type]
    )
    return ResearchPlanResponse(
        trace_id=str(uuid.uuid4()),
        plan=plan,
        clarifications=list(plan.clarifying_questions),
        planning_events=planning_events,
        resolution_notes=resolution_notes,
        resolved_retrieval=resolved_retrieval,
        plan_debug=plan_debug_payload,
    )


def _cap_location_tokens(location_tokens: list[str], warnings: list[str]) -> list[str]:
    states = [t for t in location_tokens if isinstance(t, str) and t.startswith("S:")]
    hops = [t for t in location_tokens if isinstance(t, str) and t.startswith("H:")]
    other = [t for t in location_tokens if isinstance(t, str) and t not in states and t not in hops]
    if other:
        warnings.append(f"Ignored {len(other)} non S:/H: location tokens.")
    if len(hops) > MAX_HOSPITAL_LOCATIONS:
        warnings.append(f"Capped hospitals from {len(hops)} to {MAX_HOSPITAL_LOCATIONS} for payload size.")
        hops = hops[:MAX_HOSPITAL_LOCATIONS]
    if len(states) > MAX_STATE_LOCATIONS:
        warnings.append(f"Capped states from {len(states)} to {MAX_STATE_LOCATIONS}.")
        states = states[:MAX_STATE_LOCATIONS]
    return states + hops


def assess_retrieval_readiness(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Deterministic coverage gate for UI and summary (no LLM)."""
    series = snapshot.get("series_by_measure") or {}
    readiness_warnings: list[str] = []
    total_rows = 0
    entities: set[str] = set()
    years: set[int] = set()
    has_nat = False
    measures_with_rows = 0
    for _mid, block in series.items():
        if not isinstance(block, dict):
            continue
        rows = block.get("rows") or []
        n = len(rows)
        total_rows += n
        if n:
            measures_with_rows += 1
        for row in rows:
            if not isinstance(row, dict):
                continue
            ev = str(row.get("entity_value", ""))
            entities.add(ev)
            if ev == "__NATIONAL__":
                has_nat = True
            y = row.get("year")
            if y is not None:
                try:
                    years.add(int(y))
                except (TypeError, ValueError):
                    pass
    question = str(snapshot.get("question") or "").lower()
    plan_echo = snapshot.get("plan_echo") if isinstance(snapshot.get("plan_echo"), dict) else {}
    intent = str(plan_echo.get("intent") or "")
    hospital_compare = "hospital" in question or intent == "compare_hospitals"
    status = "ok"
    if measures_with_rows == 0 or total_rows == 0:
        status = "blocked"
        readiness_warnings.append("No series rows were retrieved for the selected measures and locations.")
    elif total_rows < 8 and hospital_compare:
        status = "thin"
        readiness_warnings.append("Very few data rows for a hospital-focused question.")
    h_entities = {e for e in entities if e.startswith("H:")}
    if hospital_compare and len(h_entities) >= 20 and years:
        year_span = max(years) - min(years)
        if year_span <= 2 and len(years) <= 3:
            readiness_warnings.append(
                "Many hospitals in scope with a short year span; summaries weight evidence_digest when present.",
            )
    if hospital_compare and len(h_entities) < 2 and measures_with_rows:
        if status == "ok":
            status = "thin"
        readiness_warnings.append("Fewer than two hospitals appear in the snapshot for comparison.")
    st_list = plan_echo.get("states") if isinstance(plan_echo.get("states"), list) else []
    st_list = [str(s).strip().upper()[:2] for s in st_list if str(s).strip()]
    missing_geography = bool(hospital_compare and len(st_list) == 0)
    if snapshot.get("include_national") and not has_nat and measures_with_rows:
        readiness_warnings.append(
            "National baseline series not present for at least one measure where requested.",
        )
    return {
        "status": status,
        "warnings": readiness_warnings,
        "coverage": {
            "num_measures": len(series),
            "num_measures_with_rows": measures_with_rows,
            "num_entities": len(entities),
            "num_rows": total_rows,
            "years": sorted(years),
            "has_national_baseline": has_nat,
            "missing_geography": missing_geography,
        },
    }


def research_retrieve(
    *,
    trace_id: str,
    measure_ids: list[str],
    location_tokens: list[str],
    include_national: bool,
    resolved_retrieval: dict[str, Any] | None = None,
    plan_echo: dict[str, Any] | None = None,
) -> ResearchRetrieveResponse:
    store = get_store()
    warnings: list[str] = []
    question_echo = ""
    series_by_measure: dict[str, Any] = {}
    metric_evidence: list[dict[str, Any]] = []

    def _series_block(mid: str, locs_in: list[str], inc_nat: bool, meta: dict[str, Any]) -> dict[str, Any]:
        locs = _cap_location_tokens(locs_in, warnings)
        df = fetch_series(store, mid, locs, include_national=inc_nat)
        if df.empty:
            warnings.append(f"No rows for measure {mid} with given locations.")
            return {
                "measure_id": mid,
                "locations": list(locs),
                "rows": [],
                **meta,
            }
        clean = df.astype(
            {"entity_value": "string", "label": "string", "type": "string", "year": "int64", "value": "float64"}
        )
        if len(clean) > MAX_ROWS_PER_MEASURE:
            warnings.append(f"Truncated rows for {mid} to {MAX_ROWS_PER_MEASURE} for payload size.")
            clean = clean.sort_values(["year", "label"]).tail(MAX_ROWS_PER_MEASURE)
        return {
            "measure_id": mid,
            "locations": list(locs),
            "rows": clean.to_dict(orient="records"),
            **meta,
        }

    if resolved_retrieval and isinstance(resolved_retrieval.get("metric_requests"), list):
        question_echo = str(resolved_retrieval.get("question") or "")
        inc_nat = bool(resolved_retrieval.get("include_national", include_national))
        for req in resolved_retrieval["metric_requests"]:
            if not isinstance(req, dict):
                continue
            mid = str(req.get("measure_id") or "").strip()
            if not mid or mid not in set(store.measure_ids):
                warnings.append(f"Dropped unknown measure_id in resolved_retrieval: {mid!r}")
                continue
            locs_raw = list(req.get("location_tokens") or [])
            meta = {
                "measure_name": req.get("measure_name"),
                "interpretation": req.get("interpretation"),
                "is_volume": req.get("is_volume"),
                "why_selected": req.get("why_selected"),
                "hospital_selection": req.get("hospital_selection"),
            }
            block = _series_block(mid, locs_raw, inc_nat, meta)
            series_by_measure[mid] = block
            metric_evidence.append(
                {
                    "measure_id": mid,
                    "measure_name": meta.get("measure_name"),
                    "interpretation": meta.get("interpretation"),
                    "is_volume": meta.get("is_volume"),
                    "why_selected": meta.get("why_selected"),
                    "location_tokens": block.get("locations"),
                    "hospital_selection": meta.get("hospital_selection"),
                    "validation_warnings": [],
                    "row_count": len(block.get("rows") or []),
                }
            )
    else:
        locs = _cap_location_tokens(location_tokens, warnings)
        mids_in = [str(m).strip() for m in measure_ids if str(m).strip()][:MAX_MEASURES_RETRIEVE]
        valid_measures = [m for m in mids_in if m in set(store.measure_ids)]
        for m in mids_in:
            if m not in valid_measures:
                warnings.append(f"Dropped unknown measure_id: {m}")
        for mid in valid_measures[:MAX_MEASURES_RETRIEVE]:
            series_by_measure[mid] = _series_block(mid, locs, include_national, {})

    pe = plan_echo if isinstance(plan_echo, dict) else {}
    snap_for_readiness = {
        "series_by_measure": series_by_measure,
        "question": question_echo,
        "include_national": bool(resolved_retrieval.get("include_national", include_national))
        if resolved_retrieval
        else include_national,
        "plan_echo": pe if pe else {"intent": ""},
    }
    readiness = assess_retrieval_readiness(snap_for_readiness)
    raw_digest = _build_evidence_digest(series_by_measure)
    evidence_digest: dict[str, Any] | None = raw_digest if raw_digest.get("by_measure") else None
    return ResearchRetrieveResponse(
        trace_id=trace_id,
        series_by_measure=series_by_measure,
        validation_warnings=warnings,
        question=question_echo,
        readiness=readiness,
        metric_evidence=metric_evidence,
        evidence_digest=evidence_digest,
    )


def research_summary(trace_id: str, retrieval_snapshot: dict[str, Any]) -> ResearchSummaryResponse:
    _ = trace_id
    rd = retrieval_snapshot.get("readiness") if isinstance(retrieval_snapshot.get("readiness"), dict) else {}
    status = str(rd.get("status") or "ok").strip().lower()
    cites = [f"measure:{k}" for k in (retrieval_snapshot.get("series_by_measure") or {}).keys()]

    if status == "blocked":
        ev = _blocked_evidence_panel(retrieval_snapshot)
        return ResearchSummaryResponse(markdown=ev.markdown, citations=cites, evidence=ev)

    llm = get_llm()
    summarizer = getattr(llm, "summarize_structured", None)
    try:
        if summarizer is not None:
            md, ev_dict = summarizer(retrieval_snapshot)
            evidence: EvidencePanelModel | None = None
            if isinstance(ev_dict, dict):
                try:
                    evidence = EvidencePanelModel.model_validate(ev_dict)
                    if (evidence.markdown or "").strip():
                        md = evidence.markdown.strip()
                except Exception:
                    evidence = None
            return ResearchSummaryResponse(markdown=md, citations=cites, evidence=evidence)
        md = llm.summarize(retrieval_snapshot)
        return ResearchSummaryResponse(markdown=md, citations=cites, evidence=None)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            raise ResearchPlannerError("Ollama authentication failed. Check API key configuration.") from e
        raise ResearchPlannerError("Ollama summary request failed (HTTP error).") from e
    except httpx.TimeoutException as e:
        raise ResearchPlannerError("Ollama summary request timed out.") from e
    except RuntimeError as e:
        raise ResearchPlannerError(str(e)) from e
