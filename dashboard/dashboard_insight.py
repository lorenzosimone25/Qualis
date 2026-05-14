"""Grounded dashboard narrative via Ollama (same stack as research summaries)."""

from __future__ import annotations

import json
import os
from typing import Any

import httpx
from pydantic import BaseModel, Field

from .research.ollama_client import ollama_chat, ollama_configured


class InsightSummaryBody(BaseModel):
    measure_id: str = Field(..., min_length=1)
    measure_title: str = ""
    interpretation: str = ""
    has_national: bool = False
    location_tokens: list[str] = Field(default_factory=list)
    series_rows: list[dict[str, Any]] = Field(default_factory=list)


_DASHBOARD_SUMMARY_SYSTEM = """You write 200 words, markdown summaries for CMS hospital quality dashboards.

Hard rules:
- Use ONLY facts, labels, and numeric values present in FACTS_JSON. Never invent hospitals, CCNs, measure ids, or statistics.
- Maximum 200 words. Output Markdown only (no JSON fences).
- Bold (**like this**) facility names and numeric values exactly as they appear in FACTS_JSON when you cite them removing token identifiers.
- Do not diagnose or recommend treatment; do not imply individual patient outcomes. This is aggregate reporting data for context only.
- Explain briefly what the metric represents using measure_title and interpretation from FACTS_JSON.
- Describe selected locations (location_tokens) and reporting years (reporting_years) using only FACTS_JSON.
- Show only a max of 3 decimal places for numeric values.

Sections (use ## headings):
## What this metric measures
## Limitations

"""


def _default_model() -> str:
    return (os.environ.get("CMS_QUALITY_OLLAMA_MODEL") or "gpt-oss:20b").strip()


def build_facts_pack(body: InsightSummaryBody) -> dict[str, Any]:
    rows = list(body.series_rows or [])
    years: list[int] = []
    for r in rows:
        y = r.get("year")
        if y is None:
            continue
        try:
            years.append(int(y))
        except (TypeError, ValueError):
            continue
    years_sorted = sorted(set(years))

    latest_by_key: dict[str, dict[str, Any]] = {}
    for r in rows:
        lab = str(r.get("label", ""))
        ev = str(r.get("entity_value", ""))
        y_raw = r.get("year")
        v_raw = r.get("value")
        if y_raw is None or v_raw is None:
            continue
        try:
            yr = int(y_raw)
            val = float(v_raw)
        except (TypeError, ValueError):
            continue
        key = f"{ev}|{lab}"
        cur = latest_by_key.get(key)
        if cur is None or yr > int(cur["year"]):
            latest_by_key[key] = {
                "entity_value": ev,
                "label": lab,
                "year": yr,
                "value": val,
            }

    return {
        "measure_id": body.measure_id,
        "measure_title": body.measure_title,
        "interpretation": body.interpretation,
        "has_national": body.has_national,
        "location_tokens": list(body.location_tokens),
        "reporting_years": years_sorted,
        "latest_per_entity": sorted(latest_by_key.values(), key=lambda x: str(x.get("label", "")))[:48],
        "series_rows": rows[:800],
        "row_count": len(rows),
    }


def stub_dashboard_summary(facts: dict[str, Any]) -> str:
    mid = facts.get("measure_id", "")
    n = int(facts.get("row_count") or len(facts.get("series_rows") or []))
    return (
        "## Overview\n\n"
        "A grounded narrative requires **Ollama** (`OLLAMA_API_KEY` or `CMS_QUALITY_OLLAMA_API_KEY`). "
        "Expand **Statistical detail** below for deterministic facts from the same numbers as the charts.\n\n"
        f"- Measure id: **{mid}**\n"
        f"- Data rows in view: **{n}**\n\n"
        "## Limitations\n\n"
        "Without an API key, we only show template statistics—not an LLM rewrite."
    )


def dashboard_insight_summary(body: InsightSummaryBody) -> dict[str, str]:
    facts = build_facts_pack(body)
    if not ollama_configured():
        return {"markdown": stub_dashboard_summary(facts)}

    snap = json.dumps(facts, ensure_ascii=False)[:120_000]
    user_msg = "FACTS_JSON:\n" + snap
    model = _default_model()
    try:
        content = ollama_chat(
            [
                {"role": "system", "content": _DASHBOARD_SUMMARY_SYSTEM},
                {"role": "user", "content": user_msg},
            ],
            model=model,
        )
        return {"markdown": content.strip()}
    except (httpx.HTTPStatusError, httpx.TimeoutException, RuntimeError, OSError) as e:
        err = str(e)[:200]
        base = stub_dashboard_summary(facts)
        return {
            "markdown": base + f"\n\n## Narrative unavailable\n\n_{err}_",
        }
