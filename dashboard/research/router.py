"""FastAPI routes for ``/research/*``."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from .schemas import (
    ResearchHospitalsSearchBody,
    ResearchMetricsSearchBody,
    ResearchPlanBody,
    ResearchRetrieveBody,
    ResearchSummaryBody,
)
from .service import (
    ResearchPlannerError,
    metric_catalog,
    research_health,
    research_hospitals_search,
    research_metrics_search,
    research_plan,
    research_retrieve,
    research_summary,
)

router = APIRouter(prefix="/research", tags=["research"])


@router.get("/health")
def get_research_health() -> dict:
    """Ollama configuration status for UI (no secrets)."""
    return research_health().model_dump(mode="json")


@router.get("/metrics/catalog")
def get_metric_catalog(
    limit: int = Query(50, ge=1, le=500),
    cursor: str | None = Query(None, description="Opaque cursor: last measure_id from previous page"),
) -> dict:
    """Paginated metric knowledge from the glossary (measure_id, title, interpretation, tags)."""
    return metric_catalog(limit=limit, cursor=cursor).model_dump(mode="json")


@router.post("/metrics/search")
def post_research_metrics_search(body: ResearchMetricsSearchBody) -> dict:
    """Lexical search over the full measure glossary (debug / UI)."""
    return research_metrics_search(body)


@router.post("/hospitals/search")
def post_research_hospitals_search(body: ResearchHospitalsSearchBody) -> dict:
    """Hospital directory substring search with optional state filter."""
    return research_hospitals_search(body)


@router.post("/plan")
def post_research_plan(body: ResearchPlanBody) -> dict:
    """Parse a natural-language question into a structured plan (stub or Ollama when configured)."""
    try:
        return research_plan(
            body.question,
            body.conversation_context,
            body.session_slots,
        ).model_dump(mode="json")
    except ResearchPlannerError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/retrieve")
def post_research_retrieve(body: ResearchRetrieveBody) -> dict:
    """Fetch series for validated measures and locations; never invents rows."""
    return research_retrieve(
        trace_id=body.trace_id,
        measure_ids=body.measure_ids,
        location_tokens=body.location_tokens,
        include_national=body.include_national,
        resolved_retrieval=body.resolved_retrieval,
        plan_echo=body.plan_echo,
    ).model_dump(mode="json")


@router.post("/summary")
def post_research_summary(body: ResearchSummaryBody) -> dict:
    """Grounded markdown summary from the retrieval snapshot only."""
    try:
        return research_summary(body.trace_id, body.retrieval_snapshot).model_dump(mode="json")
    except ResearchPlannerError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
