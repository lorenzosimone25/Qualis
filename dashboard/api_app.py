"""Optional FastAPI shim exposing the same query operations as the Dash app.

Run locally::

    uvicorn dashboard.api_app:app --reload --port 8765

Root ``/`` redirects to interactive OpenAPI at ``/docs``. Try ``/health`` for a
quick JSON ping. Data endpoints require the same ``processed/`` tree as the
Dash app.

Requires ``fastapi`` and ``uvicorn`` (see requirements.txt).

Loads optional ``.env`` from the repository root (same directory as ``dashboard/``) so
``OLLAMA_API_KEY`` / ``CMS_QUALITY_OLLAMA_*`` are available without exporting them in the shell.
"""

from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

# Repository root: …/cms-quality (parent of the ``dashboard`` package directory).
_REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_REPO_ROOT / ".env")

import re
from typing import Annotated

from fastapi.encoders import jsonable_encoder
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import RedirectResponse

from .glossary import build_glossary
from .metrics_rank import rank_glossary_matches
from .query import (
    fetch_series,
    get_store,
    measure_has_national,
    resolve_location_token_labels,
    search_locations,
    list_hospitals_by_state,
)
from .rankings import rank_hospitals_for_state_measure
from .research.router import router as research_router
from .dashboard_insight import InsightSummaryBody, dashboard_insight_summary
from .resolve_query import resolve_natural_query

app = FastAPI(title="CMS Quality API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(research_router)


class ResolveQueryBody(BaseModel):
    q: str = Field(..., min_length=1, max_length=2000)
    metric_limit: int = Field(30, ge=1, le=100)
    hospital_limit: int = Field(40, ge=1, le=100)


class LocationLabelsBody(BaseModel):
    """Batch-resolve picker tokens to human-readable labels for chips and legends."""

    tokens: list[str] = Field(default_factory=list, description="Picker tokens such as H:070001 or S:CT")


def _zip5(raw: str) -> str | None:
    digits = "".join(c for c in raw if c.isdigit())
    if len(digits) >= 5:
        return digits[:5]
    return None


def _state2(raw: str) -> str | None:
    s = re.sub(r"[^A-Za-z]", "", raw).upper()
    if len(s) >= 2:
        return s[:2]
    return None


@app.get("/")
def root():
    """Redirect browsers to Swagger UI; avoids bare ``Not Found`` on the site root."""
    return RedirectResponse(url="/docs")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/dashboard/insight_summary")
def post_dashboard_insight_summary(body: InsightSummaryBody) -> dict[str, str]:
    """Grounded Markdown narrative for dashboard analytics (Ollama when configured)."""
    return dashboard_insight_summary(body)


@app.get("/meta/summary")
def meta_summary() -> dict:
    store = get_store()
    return {
        "n_location_options": len(store.location_options),
        "n_measures": len(store.measure_ids),
        "n_volume_measures": len(store.volume_ids),
    }


@app.get("/meta/has_national")
def has_national(measure_id: str = Query(..., min_length=1)) -> dict[str, bool]:
    store = get_store()
    return {"measure_id": measure_id, "has_national": measure_has_national(store, measure_id)}


@app.get("/meta/volume_sibling")
def volume_sibling(measure_id: str = Query(..., min_length=1)) -> dict:
    store = get_store()
    base = measure_id.strip()
    vid = f"{base}_VOLUME"
    allowed = set(store.volume_ids)
    has_vol = vid in allowed
    return {"measure_id": base, "volume_measure_id": vid if has_vol else None, "has_volume": has_vol}


@app.get("/rankings/hospitals")
def rankings_hospitals(
    measure_id: str = Query(..., min_length=1),
    state: str = Query(..., min_length=2, max_length=2),
    limit: int = Query(8, ge=1, le=200),
    sort: str = Query("best"),
) -> dict:
    allowed_sorts = ("best", "worst", "volume_high", "volume_low", "improved", "worsened")
    if sort not in allowed_sorts:
        raise HTTPException(
            status_code=400,
            detail=f"sort must be one of: {', '.join(allowed_sorts)}",
        )
    store = get_store()
    rows, eligible, extra = rank_hospitals_for_state_measure(
        store, measure_id, state, limit=limit, sort=sort  # type: ignore[arg-type]
    )
    st = re.sub(r"[^A-Za-z]", "", state).upper()[:2]
    out: dict[str, object] = {
        "measure_id": measure_id,
        "state": st,
        "sort": sort,
        "eligible": eligible,
        "results": rows,
    }
    if extra:
        out["matched_criteria"] = extra.get("matched_criteria")
        out["eligible_with_yoy"] = extra.get("eligible_with_yoy")
    return out


@app.post("/query/resolve")
def query_resolve(body: ResolveQueryBody) -> dict:
    """Heuristic parse: ZIP/state tokens, ranked metrics and hospitals, suggested H:/S: tokens."""
    return resolve_natural_query(
        body.q,
        metric_limit=body.metric_limit,
        hospital_limit=body.hospital_limit,
    )


@app.get("/metrics/search")
def metrics_search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=200),
) -> dict:
    """Search measure ids and glossary text (cached build_glossary table), relevance-ranked."""
    df = build_glossary()
    metrics = rank_glossary_matches(df, q, limit=limit)
    for m in metrics:
        m.pop("score", None)
    return {"query": q, "metrics": metrics, "count": len(metrics)}


@app.post("/locations/labels")
def location_labels(body: LocationLabelsBody) -> dict[str, dict[str, str]]:
    """Resolve picker tokens (``H:ccn``, ``S:ST``) to human-readable labels for UI chips."""
    store = get_store()
    toks = [str(t).strip() for t in (body.tokens or [])[:64] if isinstance(t, str) and str(t).strip()]
    return {"labels": resolve_location_token_labels(store, toks)}


@app.get("/locations/search")
def locations_search(
    q: str = Query(..., min_length=2, description="Substring query for hospital metadata"),
    limit: int = Query(50, ge=1, le=500),
) -> dict:
    """Search hospitals by name / city / state / ZIP / CCN (metadata only; fast)."""
    store = get_store()
    opts = search_locations(store, q, limit=limit)
    return {"query": q, "options": opts, "count": len(opts)}


@app.get("/locations/by-state")
def locations_by_state(
    state: str = Query(..., min_length=2, max_length=2),
    q: str = Query("", max_length=200),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    sort: str = Query("name"),
) -> dict:
    """Alphabetical / CCN-sorted hospital picker for one state (paginated)."""
    if sort not in ("name", "ccn"):
        raise HTTPException(status_code=400, detail="sort must be name or ccn")
    store = get_store()
    st = _state2(state)
    if not st:
        raise HTTPException(status_code=400, detail="Invalid state code")
    opts, total = list_hospitals_by_state(store, st, query=q, offset=offset, limit=limit, sort=sort)
    return {"state": st, "query": q, "options": opts, "total": total, "offset": offset, "limit": limit}


@app.get("/hospitals/by-zip/{zip_code}")
def hospitals_by_zip(zip_code: str) -> dict:
    store = get_store()
    z5 = _zip5(zip_code)
    if not z5:
        raise HTTPException(status_code=400, detail="Invalid ZIP code")
    ccns = list(store.zip_to_ccns.get(z5, ()))
    return {"zip": z5, "ccns": ccns, "count": len(ccns)}


@app.get("/hospitals/by-state/{state}")
def hospitals_by_state(state: str) -> dict:
    store = get_store()
    st = _state2(state)
    if not st:
        raise HTTPException(status_code=400, detail="Invalid state code")
    ccns = list(store.state_to_ccns.get(st, ()))
    return {"state": st, "ccns": ccns, "count": len(ccns)}


# USPS jurisdictions shown in dashboard geography (matches frontend US_STATE_NAMES).
_USPS_ALL = (
    "AL",
    "AK",
    "AZ",
    "AR",
    "CA",
    "CO",
    "CT",
    "DE",
    "DC",
    "FL",
    "GA",
    "HI",
    "ID",
    "IL",
    "IN",
    "IA",
    "KS",
    "KY",
    "LA",
    "ME",
    "MD",
    "MA",
    "MI",
    "MN",
    "MS",
    "MO",
    "MT",
    "NE",
    "NV",
    "NH",
    "NJ",
    "NM",
    "NY",
    "NC",
    "ND",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VT",
    "VA",
    "WA",
    "WV",
    "WI",
    "WY",
)


@app.get("/hospitals/counts-by-state")
def hospitals_counts_by_state() -> dict[str, dict[str, int]]:
    """Single batch response for honeycomb map tooltips (no per-state fan-out)."""
    store = get_store()
    counts: dict[str, int] = {}
    for code in _USPS_ALL:
        ccns = store.state_to_ccns.get(code, ())
        counts[code] = len(ccns)
    return {"counts": counts}


@app.get("/hospitals/{ccn}")
def hospital_detail(ccn: str) -> dict:
    store = get_store()
    hm = store.hospital_meta
    rows = hm[hm.index.astype(str) == ccn]
    if rows.empty:
        raise HTTPException(status_code=404, detail="Unknown CCN")
    row = rows.iloc[0]
    return {"ccn": ccn, "fields": jsonable_encoder(row.to_dict())}


@app.get("/series")
def series(
    measure_id: str = Query(..., min_length=1),
    locations: Annotated[
        str | None, Query(description="Comma-separated picker tokens: H:ccn, S:ST")
    ] = None,
    include_national: bool = False,
) -> dict:
    """Return ``fetch_series`` output as column-oriented JSON."""
    store = get_store()
    loc_list: list[str] = []
    if locations:
        loc_list = [x.strip() for x in locations.split(",") if x.strip()]
    df = fetch_series(store, measure_id, loc_list, include_national=include_national)
    if df.empty:
        return {"measure_id": measure_id, "locations": loc_list, "rows": []}
    clean = df.astype(
        {"entity_value": "string", "label": "string", "type": "string", "year": "int64", "value": "float64"}
    )
    return {
        "measure_id": measure_id,
        "locations": loc_list,
        "rows": clean.to_dict(orient="records"),
    }


@app.get("/locations/options_sample")
def locations_options_sample(limit: int = 50) -> dict:
    """First N full dropdown options (states first), for smoke tests."""
    store = get_store()
    if limit < 1:
        return {"options": [], "error": "limit must be >= 1"}
    opts = store.location_options[:limit]
    return {"options": opts}
