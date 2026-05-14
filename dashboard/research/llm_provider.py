"""LLM providers: deterministic stub and Ollama Cloud (JSON plan + grounded summary)."""

from __future__ import annotations

import json
import os
from typing import Any, Protocol, runtime_checkable

from .ollama_client import ollama_chat, parse_json_object


@runtime_checkable
class LLMProvider(Protocol):
    def plan(
        self,
        question: str,
        *,
        planner_context: dict[str, Any],
        conversation_context: str | None,
    ) -> dict[str, Any]:
        """Return intent JSON; server resolves measures and hospitals."""
        ...

    def summarize(self, retrieval_snapshot: dict[str, Any]) -> str:
        """Markdown grounded strictly on ``retrieval_snapshot``."""
        ...


class StubLLMProvider:
    """Deterministic when no API key is set."""

    def summarize_structured(self, retrieval_snapshot: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        mids = list(retrieval_snapshot.get("series_by_measure", {}).keys())
        st = (retrieval_snapshot.get("readiness") or {}).get("status", "ok")
        rd = retrieval_snapshot.get("readiness") or {}
        warns = rd.get("warnings") if isinstance(rd.get("warnings"), list) else []
        pe = retrieval_snapshot.get("plan_echo") if isinstance(retrieval_snapshot.get("plan_echo"), dict) else {}
        states = pe.get("states") if isinstance(pe.get("states"), list) else []
        scope_lines = [
            f"Measures in snapshot: {', '.join(mids) or 'none'}",
            f"Plan states: {', '.join(str(s) for s in states) or 'none'}",
            f"Readiness: {st}",
        ]
        dig = retrieval_snapshot.get("evidence_digest")
        if isinstance(dig, dict) and dig.get("by_measure"):
            scope_lines.append("Evidence digest: present (bounded hospital peek for summaries).")
        md = (
            "## What you asked us to analyze\n\n"
            "Stub mode (no LLM): this skeleton mirrors the live report shape. "
            "Use the in-app **Charts** and **Plan details** tabs for the factual scope.\n\n"
            "## What we pulled from CMS\n\n"
            f"- Measures present in the retrieval snapshot: **{', '.join(mids) or 'none'}**\n"
            f"- Evidence status (deterministic): **{st}**\n"
            "- Values and facility names must match the snapshot only.\n\n"
            "## Findings\n\n"
            "- Open **Charts** after a live run to read values from the snapshot only.\n"
            "- The **Overview** tab will show a narrative once Ollama is configured.\n\n"
            "## Limitations\n\n"
            "- Configure `OLLAMA_API_KEY` and `CMS_QUALITY_OLLAMA_MODEL` for a full grounded markdown report."
        )
        evidence = {
            "title": "Research preview (stub mode)",
            "abstract": (
                f"This stub run reports readiness **{st}** for {len(mids)} measure(s). "
                "Configure Ollama for a structured evidence panel generated from retrieved CMS series only."
            ),
            "key_findings": [
                f"Retrieval status: **{st}**",
                f"Measures present: **{', '.join(mids) or 'none'}**",
            ],
            "retrieval_scope": scope_lines,
            "limitations": list(str(w) for w in warns[:8])
            + ["Stub LLM: no live model synthesis; narrative is illustrative only."],
            "markdown": md,
        }
        return md, evidence

    def plan_ranking_policies(
        self,
        question: str,
        *,
        ranking_bias: str,
        measures: list[dict[str, Any]],
        plan_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        from dashboard.glossary import build_glossary
        from dashboard.research.research_resolution import ranking_policy_overrides_from_defaults

        df = build_glossary()
        mids = [str(m.get("measure_id") or "").strip() for m in measures if m.get("measure_id")]
        ctx = plan_context or {}
        d = ranking_policy_overrides_from_defaults(
            measure_ids=mids,
            df=df,
            question_lower=question.lower(),
            intent=str(ctx.get("intent") or "unknown"),
            legacy_sel=str(ctx.get("hospital_selection") or "none"),
            has_explicit_hospitals=bool(ctx.get("has_explicit_hospitals")),
            ranking_bias=ranking_bias,
        )
        return [{"measure_id": k, "sort": v["sort"], "limit": v["limit"]} for k, v in d.items()]

    def plan(
        self,
        question: str,
        *,
        planner_context: dict[str, Any],
        conversation_context: str | None,
    ) -> dict[str, Any]:
        _ = planner_context
        _ = conversation_context
        upper = question.upper()
        states = [s for s in ("NY", "CT", "CA", "TX", "FL", "MA") if s in upper]
        if not states:
            states = []
        intent = "compare_hospitals" if "hospital" in question.lower() else "compare_geographies"
        hsel = "top_ranked_in_state" if intent == "compare_hospitals" and states else "none"
        return {
            "states": states[:8],
            "hospital_tokens": [],
            "measure_ids": [],
            "intent": intent,
            "year_range": None,
            "needs_clarification": False,
            "clarifying_questions": [],
            "highlight_spans": [{"term": s, "role": "geography"} for s in states[:4]],
            "clinical_themes": ["heart failure", "mortality"],
            "metric_search_queries": ["heart failure mortality", "MORT_30_HF", "hospital readmission heart"],
            "hospital_natural_hints": [],
            "hospital_selection": hsel,
            "compare_focus": "metrics_first",
            "retrieval_intent": "Retrieve comparable hospital quality measures for the selected states.",
            "ranking_bias": "neutral",
            "include_national": True,
            "metric_candidates": [
                {
                    "search_query": "heart failure mortality",
                    "clinical_theme": "heart failure",
                    "rationale": "Core outcome bundle",
                    "priority": 1.0,
                },
                {
                    "search_query": "heart failure readmission",
                    "clinical_theme": "readmission",
                    "rationale": "Utilization / follow-up",
                    "priority": 0.8,
                },
            ],
            "rationale": "Stub intent: focus on heart-failure style outcomes; server will resolve measure ids from the full glossary.",
            "planning_events": [
                {"id": "parse_intent", "label": "Parse intent", "detail": "Stub: themes and search phrases for metric resolution."},
                {"id": "choose_measures", "label": "Choose measures", "detail": "Server ranks the full glossary from metric_search_queries."},
                {"id": "validate_plan", "label": "Validate", "detail": "Dataset intersection and caps apply before retrieve."},
            ],
        }

    def pick_metrics_from_candidates(
        self,
        *,
        question: str,
        clinical_themes: list[str],
        candidates: list[dict[str, Any]],
        max_metrics: int,
    ) -> dict[str, Any] | None:
        _ = question, clinical_themes, candidates, max_metrics
        return None

    def summarize(self, retrieval_snapshot: dict[str, Any]) -> str:
        md, _ev = self.summarize_structured(retrieval_snapshot)
        return md


_PLAN_SYSTEM = """You are a CMS hospital quality **retrieval planner** (not an analyst). Output ONLY one valid JSON object, no markdown fences.

Your job is to propose what the Python backend should fetch from CMS data. Do NOT answer the user's clinical question.

Top-level keys:
- states: 2-letter US codes relevant to the user (max 8)
- intent: compare_geographies | compare_hospitals | explore | unknown
- ranking_bias: favorable | neutral | concerning — REQUIRED. favorable = user wants best/top/safest/lowest mortality outcomes; concerning = worst/risk/underperform; neutral = neither (balanced or exploratory retrieval).
- retrieval_intent: one short sentence describing the retrieval goal in plain English
- include_national: boolean — true when national baseline would help comparisons
- clinical_themes: 0-6 short strings (e.g. "cardiology", "HAI")
- metric_search_queries: 1-10 concise search phrases for the measure glossary
- metric_candidates: 0-10 objects, each optional fields:
  - measure_id: only if user pasted an exact known id (otherwise omit)
  - search_query: natural phrase to match glossary text
  - clinical_theme: short label
  - rationale: why this metric matters for the question
  - priority: number (higher = more important)
  - hospital_policy: optional object with:
      mode: none | explicit_hospitals | ranked_in_state | ranked_national | state_overview
      state: two-letter code when a single state applies
      sort: best | worst | improved | worsened | volume_high | volume_low | balanced
      limit: 1-50 (smaller when the user asked for only a few hospitals)
      rationale: why this policy fits
- hospital_natural_hints: 0-8 hospital name/city fragments if user named facilities
- explicit_hospital_hints: same as above if the user named hospitals distinctly
- hospital_selection legacy: none | search_hints | top_ranked_in_state (server may override)
- Do not set hospital_selection to top_ranked_in_state unless you also list the relevant US states in ``states``, or the user named hospitals / hospital_natural_hints that can be resolved.
- compare_focus: metrics_first | hospitals_first | balanced
- needs_clarification (boolean), clarifying_questions (0-3 strings)
- highlight_spans: array of {term, role} where role is geography|clinical|comparison|other
- planning_events: 3-5 objects {id, label, detail}
- rationale: one short user-facing sentence

Optional legacy fields (only if user pasted exact ids): measure_ids (strings), hospital_tokens (H:###### only).

Rules:
- Never invent CCNs or hospital_tokens. Never invent measure_ids unless user supplied them; prefer search_query.
- If geography or clinical scope is ambiguous, set needs_clarification true with specific questions.
- Always set ranking_bias from the user wording (favorable vs concerning vs neutral). The server uses it for hospital ranking defaults; do not rely on hidden text heuristics.
- When ranking_bias is favorable, prefer hospital_policy.sort best on outcome measures (when you emit per-metric hospital_policy).
- When ranking_bias is concerning, prefer worst on outcomes and worsened when trends matter.
- For state-only comparisons without hospitals, use state_overview or hospital_policy.mode none.
- Do NOT add volume measure ids (suffix _VOLUME) to measure_ids; volume is loaded as a chart sibling server-side.
- For heart failure mortality questions, use metric_search_queries focused on heart failure (e.g. "heart failure mortality", "MORT_30_HF"); do not broaden to AMI/payment measures unless the user asked about heart attack or AMI.
"""

_SUMMARY_SYSTEM = """You write camera-ready markdown reports for hospital quality analysts and clinicians.

The user message is one JSON object with string values for:
- USER_QUESTION
- READINESS_JSON (stringified JSON)
- PLAN_ECHO_JSON (stringified JSON)
- RETRIEVAL_SNAPSHOT_JSON (stringified JSON — numeric series evidence lives here)

Hard rules:
- Use ONLY facts and numeric values that appear inside RETRIEVAL_SNAPSHOT_JSON after parsing. Never invent measure ids, CCNs, hospitals, or statistics.
- Parse READINESS_JSON for coverage status (ok|thin|blocked). If status is blocked or thin, say so clearly and do not sound overconfident.
- PLAN_ECHO_JSON and USER_QUESTION describe retrieval intent; never treat them as numeric evidence unless the same facts appear in RETRIEVAL_SNAPSHOT_JSON.
- Do not sound like a system prompt or describe JSON keys. Translate scope into plain English.
- Frame the analysis around the user's original question (repeat it briefly in your own words if it helps).
- If the snapshot is thin or empty, say what is missing instead of speculating.
- Do not provide patient-specific medical advice or tell someone which hospital to choose; phrase patient-choice questions as aggregate CMS reporting context only.

Required markdown sections (use these ## headings in order):
## What you asked
## What we pulled (scope)
## Findings
## How to read the charts
## Limitations and data gaps

Style:
- Short paragraphs; use bullet lists for findings; bold key numbers.
- Cite values inline with the entity (hospital/state) they belong to.
- In Findings, tie each bullet to retrieved values (no generic clinical advice).
- Explain briefly how hospitals were chosen when hospital_selection metadata appears on measure blocks inside RETRIEVAL_SNAPSHOT_JSON after parsing."""


_SUMMARY_JSON_SYSTEM = """You write a structured research evidence panel for hospital quality analysts.

The user message is one JSON object with string values for:
- USER_QUESTION
- READINESS_JSON (stringified JSON — status is ok|thin|blocked)
- PLAN_ECHO_JSON (stringified JSON)
- RETRIEVAL_SNAPSHOT_JSON (stringified JSON — numeric series evidence lives here)
- EVIDENCE_DIGEST_JSON (optional stringified JSON — bounded hospital peek; prefer for Findings when many hospitals appear in READINESS coverage)

Output ONLY one valid JSON object (no markdown fences) with exactly these keys:
- title: short paper-style title (max 120 chars)
- abstract: 2-4 sentences summarizing scope and main quantitative takeaways from retrieved data only
- key_findings: array of 3-10 short strings; each must cite concrete values/entities present in RETRIEVAL_SNAPSHOT_JSON
- retrieval_scope: array of plain-English bullets (metrics, states/hospitals, years) derived from snapshot + plan echo
- limitations: array of strings (data gaps, thin coverage, missing national baseline if applicable)
- markdown: full markdown report with the same section headings as the narrative policy: ## What you asked, ## What we pulled (scope), ## Findings, ## How to read the charts, ## Limitations and data gaps

Hard rules:
- Use ONLY facts inside RETRIEVAL_SNAPSHOT_JSON and (when present) EVIDENCE_DIGEST_JSON after parsing. Never invent measure ids, CCNs, hospitals, or statistics.
- If READINESS_JSON.status is thin, use cautious language in abstract and limitations.
- Do not provide patient-specific medical advice.
- JSON string values must escape newlines properly; keep markdown inside the markdown field as a single escaped string if needed."""


_RANK_POLICY_SYSTEM = """You assign per-measure hospital ranking for CMS quality measures (server has already resolved measure ids).

Output ONLY a JSON array (no markdown fences). Each element is an object with exactly keys: measure_id, sort, limit.

Rules:
- measure_id must be copied exactly from MEASURES_JSON (never invent ids).
- sort must be one of: best, worst, improved, worsened, volume_high, volume_low, balanced
- limit is an integer 1–50 (use smaller limits when the user asked for only a few hospitals).
- Return at most one object per measure_id from MEASURES_JSON.

ranking_bias is favorable | neutral | concerning — align sorts with safer vs risk-oriented retrieval when ambiguous."""


_METRIC_PICK_SYSTEM = """You select CMS hospital quality measure_ids for data retrieval.

Output ONLY one JSON object (no markdown fences) with exactly these keys:
- selected_metrics: array of 1–10 strings — each MUST appear verbatim in CANDIDATE_METRICS_JSON[].measure_id
- unresolved_metric_needs: array of 0–6 short strings describing clinical gaps if the candidate list is insufficient

Hard rules:
- Never invent or normalize measure_ids; copy them exactly from the candidate list.
- Prefer clinical diversity when the question spans multiple themes (e.g. COPD outcomes vs patient safety).
- Do not select duplicate aliases for the same PSI number (e.g. only one of PSI_3 or PSI_03).
"""


def _default_model() -> str:
    return (os.environ.get("CMS_QUALITY_OLLAMA_MODEL") or "gpt-oss:20b").strip()


class OllamaLLMProvider:
    """Ollama Cloud via HTTPS (Bearer token from env)."""

    def __init__(self, model: str | None = None) -> None:
        self.model = model or _default_model()

    def _plan_user_message(
        self, question: str, *, planner_context: dict[str, Any], conversation_context: str | None
    ) -> str:
        ctx_json = json.dumps(planner_context, ensure_ascii=False)[:80_000]
        user_parts = [
            "DATASET_CONTEXT_JSON (not exhaustive — use it for scale only; do not copy ids as your only source):\n" + ctx_json,
            "\nUSER_QUESTION:\n" + question.strip(),
        ]
        if conversation_context and conversation_context.strip():
            user_parts.append("\nADDITIONAL_CONTEXT:\n" + conversation_context.strip())
        return "\n".join(user_parts)

    def plan(
        self,
        question: str,
        *,
        planner_context: dict[str, Any],
        conversation_context: str | None,
    ) -> dict[str, Any]:
        user_msg = self._plan_user_message(question, planner_context=planner_context, conversation_context=conversation_context)
        content = ollama_chat(
            [
                {"role": "system", "content": _PLAN_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            model=self.model,
        )
        try:
            return parse_json_object(content)
        except (json.JSONDecodeError, ValueError, TypeError, KeyError) as e:
            repair = (
                "Your previous assistant message was not valid JSON for the planner schema.\n"
                f"Parse error: {e!s}\n\n"
                "RAW_OUTPUT (fix into one JSON object only):\n"
                f"{content[:14_000]}\n\n"
                "Return ONLY a corrected JSON object; no markdown fences."
            )
            content2 = ollama_chat(
                [
                    {"role": "system", "content": _PLAN_SYSTEM},
                    {"role": "user", "content": user_msg},
                    {"role": "assistant", "content": content[:12_000]},
                    {"role": "user", "content": repair},
                ],
                model=self.model,
            )
            return parse_json_object(content2)

    def pick_metrics_from_candidates(
        self,
        *,
        question: str,
        clinical_themes: list[str],
        candidates: list[dict[str, Any]],
        max_metrics: int,
    ) -> dict[str, Any] | None:
        payload = {
            "USER_QUESTION": question.strip(),
            "CLINICAL_THEMES_JSON": clinical_themes[:12],
            "MAX_METRICS": max_metrics,
            "CANDIDATE_METRICS_JSON": candidates[: min(len(candidates), 60)],
        }
        user_msg = json.dumps(payload, ensure_ascii=False)[:48_000]
        try:
            content = ollama_chat(
                [{"role": "system", "content": _METRIC_PICK_SYSTEM}, {"role": "user", "content": user_msg}],
                model=self.model,
            )
            return parse_json_object(content.strip())
        except (json.JSONDecodeError, ValueError, TypeError, KeyError, RuntimeError):
            return None

    def plan_ranking_policies(
        self,
        question: str,
        *,
        ranking_bias: str,
        measures: list[dict[str, Any]],
        plan_context: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        _ = plan_context
        user_obj = {
            "USER_QUESTION": question.strip(),
            "ranking_bias": ranking_bias,
            "MEASURES_JSON": measures,
        }
        user_msg = json.dumps(user_obj, ensure_ascii=False)[:42_000]
        content = ollama_chat(
            [{"role": "system", "content": _RANK_POLICY_SYSTEM}, {"role": "user", "content": user_msg}],
            model=self.model,
        )
        t = content.strip()
        try:
            parsed: Any = json.loads(t)
        except json.JSONDecodeError:
            try:
                parsed = parse_json_object(t)
                if isinstance(parsed, dict):
                    inner = parsed.get("policies") or parsed.get("measures") or parsed.get("ranking_policies")
                    if isinstance(inner, list):
                        parsed = inner
                    else:
                        parsed = []
            except (json.JSONDecodeError, ValueError, TypeError, KeyError):
                return []
        if isinstance(parsed, dict) and isinstance(parsed.get("policies"), list):
            parsed = parsed["policies"]
        return parsed if isinstance(parsed, list) else []

    def summarize_structured(self, retrieval_snapshot: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
        rd = retrieval_snapshot.get("readiness") or {}
        q = str(retrieval_snapshot.get("question") or "")
        plan_echo = retrieval_snapshot.get("plan_echo") or {}
        digest = retrieval_snapshot.get("evidence_digest")
        digest_nonempty = isinstance(digest, dict) and bool(digest.get("by_measure"))
        cov = rd.get("coverage") if isinstance(rd.get("coverage"), dict) else {}
        try:
            n_rows = int(cov.get("num_rows", 0) or 0)
            n_ent = int(cov.get("num_entities", 0) or 0)
        except (TypeError, ValueError):
            n_rows, n_ent = 0, 0
        high_cardinality = n_rows > 180 or n_ent > 32
        core = {k: v for k, v in retrieval_snapshot.items() if k not in ("readiness", "question", "plan_echo")}
        core_cap = 48_000 if (digest_nonempty and high_cardinality) else 88_000
        payload: dict[str, str] = {
            "USER_QUESTION": q,
            "READINESS_JSON": json.dumps(rd, ensure_ascii=False)[:12_000],
            "PLAN_ECHO_JSON": json.dumps(plan_echo, ensure_ascii=False)[:16_000],
            "RETRIEVAL_SNAPSHOT_JSON": json.dumps(core, ensure_ascii=False)[:core_cap],
        }
        if digest_nonempty:
            payload["EVIDENCE_DIGEST_JSON"] = json.dumps(digest, ensure_ascii=False)[:28_000]
        user = json.dumps(payload, ensure_ascii=False)[:120_000]
        content = ollama_chat(
            [
                {"role": "system", "content": _SUMMARY_JSON_SYSTEM},
                {"role": "user", "content": user},
            ],
            model=self.model,
        )
        text = content.strip()
        try:
            obj = parse_json_object(text)
            if isinstance(obj, dict) and "title" in obj and "abstract" in obj:
                md = str(obj.get("markdown") or "").strip() or text
                return md, obj
        except (json.JSONDecodeError, ValueError, TypeError, KeyError):
            pass
        return text, None

    def summarize(self, retrieval_snapshot: dict[str, Any]) -> str:
        md, _ev = self.summarize_structured(retrieval_snapshot)
        return md
