"""Pydantic models shared by research endpoints (OpenAPI-friendly)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

RankingSortLiteral = Literal["best", "worst", "improved", "worsened", "volume_high", "volume_low", "balanced"]
HospitalPolicyModeLiteral = Literal[
    "none",
    "explicit_hospitals",
    "ranked_in_state",
    "ranked_national",
    "state_overview",
]


class ResearchHospitalPolicyModel(BaseModel):
    """Per-metric hospital retrieval intent (server validates and executes)."""

    mode: HospitalPolicyModeLiteral = "ranked_in_state"
    state: str | None = Field(default=None, max_length=2, description="Two-letter state when mode uses a single state.")
    sort: RankingSortLiteral = "worst"
    limit: int = Field(24, ge=1, le=50)
    rationale: str = Field("", max_length=500)


class ResearchMetricCandidateModel(BaseModel):
    """LLM-suggested metric with optional explicit measure id and per-metric hospital policy."""

    measure_id: str | None = Field(default=None, max_length=48)
    search_query: str | None = Field(default=None, max_length=500)
    clinical_theme: str | None = Field(default=None, max_length=200)
    rationale: str = Field("", max_length=500)
    priority: float = Field(0.0, description="Higher = prefer when resolving duplicates.")
    hospital_policy: ResearchHospitalPolicyModel | None = None


class MetricCatalogItem(BaseModel):
    measure_id: str
    title: str = Field(description="Primary human-readable description (glossary meaning)")
    interpretation: str
    is_volume: bool = False
    tags: list[str] = Field(default_factory=list, description="Heuristic family tags, e.g. MORT, READM")


class MetricCatalogResponse(BaseModel):
    items: list[MetricCatalogItem]
    next_cursor: str | None = None


GeographySlotSourceLiteral = Literal["user", "clarification", "none"]


class ResearchGeographySlotsModel(BaseModel):
    """Structured geography for an investigation; preferred over free-text for resolution."""

    states: list[str] = Field(default_factory=list, description="Two-letter US state codes from user or clarification.")
    source: GeographySlotSourceLiteral = Field(default="none", description="How these states were supplied.")
    confirmed: bool = Field(default=False, description="True when the user explicitly confirmed this scope.")


class ResearchSessionSlotsModel(BaseModel):
    """Lightweight session scope; merge with planner output server-side."""

    geography: ResearchGeographySlotsModel | None = Field(
        default=None,
        description="When set, states are unioned with LLM/question-derived states after validation.",
    )


class ResearchPlanBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    conversation_context: str | None = Field(
        default=None,
        max_length=8000,
        description="Optional prior turns for the planner LLM only (ADDITIONAL_CONTEXT); not used for metric/heuristic qblob.",
    )
    session_slots: ResearchSessionSlotsModel | None = Field(
        default=None,
        description="Structured slots (e.g. geography from clarification); merged deterministically into the plan.",
    )


class HighlightSpanModel(BaseModel):
    term: str = Field(..., min_length=1, max_length=200)
    role: Literal["geography", "clinical", "comparison", "other"] = "other"


class PlanningEventModel(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=120)
    detail: str = Field(default="", max_length=500)


class ResearchPlanModel(BaseModel):
    states: list[str] = Field(default_factory=list)
    hospital_tokens: list[str] = Field(default_factory=list)
    measure_ids: list[str] = Field(default_factory=list)
    intent: Literal["compare_geographies", "compare_hospitals", "explore", "unknown"] = "unknown"
    year_range: Any | None = Field(default=None, description="Reserved for explicit year window from planner")
    needs_clarification: bool = False
    clarifying_questions: list[str] = Field(default_factory=list)
    highlight_spans: list[HighlightSpanModel] = Field(default_factory=list)
    # LLM intent (echoed + used for transparency); authoritative picks are measure_ids / hospital_tokens after server resolution.
    clinical_themes: list[str] = Field(default_factory=list, description="High-level clinical bundles suggested by the planner.")
    metric_search_queries: list[str] = Field(default_factory=list, description="Lexical search phrases merged server-side against the full glossary.")
    hospital_natural_hints: list[str] = Field(
        default_factory=list,
        description="Free-text hospital cues; server maps via search_locations when possible.",
    )
    explicit_hospital_hints: list[str] = Field(
        default_factory=list,
        description="Alias for natural-language hospital names; merged with hospital_natural_hints server-side.",
    )
    hospital_selection: Literal["none", "search_hints", "top_ranked_in_state"] = Field(
        default="none",
        description="How hospitals were chosen: explicit/none, substring hints, or ranking fallback.",
    )
    compare_focus: Literal["metrics_first", "hospitals_first", "balanced"] = "balanced"
    retrieval_intent: str = Field(
        default="",
        max_length=2000,
        description="Free-text retrieval goal echoed from planner rationale or LLM retrieval_intent field.",
    )
    include_national: bool = Field(
        default=True,
        description="Whether retrieve/summary should pull __NATIONAL__ overlay when supported.",
    )
    metric_candidates: list[ResearchMetricCandidateModel] = Field(
        default_factory=list,
        description="Structured per-metric suggestions from the LLM; server validates and resolves.",
    )
    ranking_bias: Literal["favorable", "neutral", "concerning"] | None = Field(
        default=None,
        description="Planner ranking intent: favorable (best outcomes), neutral (default bundle), concerning (worst/risk).",
    )


class ResearchPlanResponse(BaseModel):
    trace_id: str
    plan: ResearchPlanModel
    clarifications: list[str] = Field(
        default_factory=list,
        description="Deprecated alias: mirrors plan.clarifying_questions for older clients.",
    )
    planning_events: list[PlanningEventModel] = Field(default_factory=list)
    resolution_notes: list[str] = Field(
        default_factory=list,
        description="Server-side metric/hospital resolution messages (safe, no secrets).",
    )
    resolved_retrieval: dict[str, Any] | None = Field(
        default=None,
        description="Opaque deterministic retrieval recipe: pass to POST /research/retrieve as resolved_retrieval.",
    )
    plan_debug: dict[str, Any] | None = Field(
        default=None,
        description="Sanitized planner echo for developers (effective queries, raw JSON snapshot, no secrets).",
    )


class ResearchMetricsSearchBody(BaseModel):
    q: str = Field(..., min_length=1, max_length=2000)
    limit: int = Field(40, ge=1, le=200)


class ResearchHospitalsSearchBody(BaseModel):
    q: str = Field(..., min_length=2, max_length=2000)
    state: str | None = Field(default=None, max_length=2, description="Optional 2-letter US state filter")
    limit: int = Field(30, ge=1, le=100)


class ResearchRetrieveBody(BaseModel):
    trace_id: str = Field(..., min_length=8, max_length=80)
    measure_ids: list[str] = Field(default_factory=list)
    location_tokens: list[str] = Field(default_factory=list)
    include_national: bool = False
    resolved_retrieval: dict[str, Any] | None = Field(
        default=None,
        description="When set, server runs per-metric fetch using metric_requests (legacy measure_ids/location_tokens ignored).",
    )
    plan_echo: dict[str, Any] | None = Field(
        default=None,
        description="Echo validated plan scope for readiness (intent, states, measure_ids); optional but improves coverage signals.",
    )


class ResearchRetrieveResponse(BaseModel):
    trace_id: str
    series_by_measure: dict[str, Any] = Field(default_factory=dict)
    validation_warnings: list[str] = Field(default_factory=list)
    question: str = Field(default="", description="Original user question echo for transparency.")
    readiness: dict[str, Any] = Field(default_factory=dict, description="Deterministic coverage: status ok|thin|blocked, warnings, coverage.")
    metric_evidence: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Per-metric retrieval metadata parallel to series_by_measure entries.",
    )
    evidence_digest: dict[str, Any] | None = Field(
        default=None,
        description="Bounded deterministic peek at ranked hospital rows for grounded summaries at high cardinality.",
    )


class ResearchSummaryBody(BaseModel):
    trace_id: str = Field(..., min_length=8, max_length=80)
    retrieval_snapshot: dict[str, Any] = Field(default_factory=dict)


class EvidencePanelModel(BaseModel):
    """Structured evidence panel; synthesis must still match retrieval_snapshot."""

    model_config = ConfigDict(extra="ignore")

    title: str = Field(default="", max_length=500)
    abstract: str = Field(default="", max_length=4000)
    key_findings: list[str] = Field(default_factory=list, description="Short bullet strings grounded in data.")
    retrieval_scope: list[str] = Field(default_factory=list, description="Plain-English scope lines (metrics, places, years).")
    limitations: list[str] = Field(default_factory=list)
    markdown: str = Field(
        default="",
        max_length=120_000,
        description="Optional full narrative; UI may render this or derive from title/abstract.",
    )

    @field_validator("key_findings", "retrieval_scope", "limitations", mode="before")
    @classmethod
    def _coerce_str_lists(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            s = v.strip()
            return [s] if s else []
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        return []


class ResearchSummaryResponse(BaseModel):
    markdown: str
    citations: list[str] = Field(default_factory=list)
    evidence: EvidencePanelModel | None = Field(
        default=None,
        description="Structured panel when the synthesizer returned validated JSON; null for blocked stub or legacy markdown-only.",
    )


class ResearchHealthResponse(BaseModel):
    ollama_configured: bool
    model: str | None = Field(default=None, description="Configured model slug when Ollama is enabled.")
