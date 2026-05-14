# Research assistant pipeline (internal)

End-to-end flow for the FastAPI `/research/*` endpoints and the React `useResearchSession` hook.

## Sequence

1. **`POST /research/plan`** — [`research_plan`](service.py) calls the LLM [`plan`](llm_provider.py) once (optional second attempt on invalid JSON). The server validates JSON, resolves measures and hospitals against the glossary and dataset, and may set `needs_clarification`. Returns `ResearchPlanResponse` including `resolved_retrieval` (per-metric `location_tokens`, `hospital_selection`, etc.).

2. **`POST /research/retrieve`** — [`research_retrieve`](service.py) loads series via `fetch_series` using `resolved_retrieval.metric_requests` when present. Builds `series_by_measure`, `metric_evidence`, `validation_warnings`, and deterministic [`assess_retrieval_readiness`](service.py) (`status`: `ok` | `thin` | `blocked`).

3. **`POST /research/summary`** — Client sends a **retrieval snapshot** (see below). [`research_summary`](service.py) skips the LLM when readiness is `blocked` and returns a deterministic message; otherwise calls [`summarize_structured`](llm_provider.py) when available to obtain markdown plus optional **EvidencePanel** JSON.

## Client snapshot (`retrieval_snapshot`)

Built in [`useResearchSession.ts`](../../web/src/features/research/useResearchSession.ts) for `postResearchSummary`:

- `trace_id`, `series_by_measure`, `validation_warnings`, `question`, `readiness` (from retrieve), `metric_evidence`, `plan_echo` (intent, states, measure_ids, retrieval_intent, include_national), `include_national`.

The synthesizer must not invent facts beyond this payload (plus validated plan echo).

## Session inputs

- **`conversation_context`**: optional free text for the planner only (`ADDITIONAL_CONTEXT` in the LLM). It is **not** merged into server-side `question_lower` for metric/geography heuristics (to avoid stale prompt bleed). Metric query expansion uses the **user question** plus planner fields.

- **`session_slots`**: optional structured geography (and future slots) from the UI; merged into resolved state list after LLM/question parsing.

## Key files

| Area | File |
|------|------|
| Orchestration | [`service.py`](service.py) |
| Resolution | [`research_resolution.py`](research_resolution.py) |
| Schemas | [`schemas.py`](schemas.py) |
| LLM | [`llm_provider.py`](llm_provider.py) |
| Routes | [`router.py`](router.py) |
| UI pipeline | [`useResearchSession.ts`](../../web/src/features/research/useResearchSession.ts) |
