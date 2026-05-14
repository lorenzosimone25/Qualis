"""Hospital ranking within a state for a single measure (latest year per CCN)."""

from __future__ import annotations

from typing import Literal

import pandas as pd

from .data import DataStore, _resolve_measure_group_key
from .glossary import lookup_interpretation

SortMode = Literal["best", "worst", "volume_high", "volume_low", "improved", "worsened"]

# Strict sign filter for improved / worsened (float noise).
_IMP_EPS = 1e-9


def _lower_is_better(interpretation: str) -> bool | None:
    il = interpretation.lower()
    if "lower" in il and "better" in il:
        return True
    if "higher" in il and "better" in il:
        return False
    return None


def rank_hospitals_for_state_measure(
    store: DataStore,
    measure_id: str,
    state: str,
    *,
    limit: int = 8,
    sort: SortMode = "worst",
) -> tuple[list[dict], int, dict[str, int]]:
    """Return ``(ranked_rows, eligible_count, extra)``.

    ``eligible_count`` is the size of the ranking pool (latest-value count for
    level sorts; hospitals with usable YoY pairs for ``improved`` / ``worsened``).

    ``extra`` may include ``matched_criteria`` (hospitals passing strict improved /
    worsened sign filter) and ``eligible_with_yoy`` (same as eligible for those sorts).

    Each row: ``ccn``, ``label``, ``year``, ``value``.

    ``volume_high`` / ``volume_low`` sort by numeric magnitude of the latest value only.

    ``improved`` / ``worsened`` use YoY change (latest minus prior year) with quality-aligned
    improvement score (same ``_lower_is_better`` heuristic as best/worst). Only hospitals
    whose quality-aligned change has the correct sign are eligible for the list.
    """
    st = (state or "").strip().upper()[:2]
    if not st or not measure_id:
        return [], 0, {}

    ccns = store.state_to_ccns.get(st, ())
    if not ccns:
        return [], 0, {}

    grp = store.hospital_by_measure
    mk = _resolve_measure_group_key(grp, measure_id)
    if mk is None:
        return [], 0, {}

    sub = grp.get_group(mk)
    sub = sub[sub["entity_id"].astype(str).isin(ccns) & sub["value"].notna()].copy()
    if sub.empty:
        return [], 0, {}

    sub = sub.sort_values(["entity_id", "year"])
    interp = lookup_interpretation(measure_id)
    lb = _lower_is_better(interp)

    if sort in ("improved", "worsened"):
        records: list[dict] = []
        for eid, g in sub.groupby("entity_id", sort=False):
            g2 = g.tail(2)
            if len(g2) < 2:
                continue
            prior = g2.iloc[0]
            latest = g2.iloc[-1]
            if lb is True:
                imp = float(prior["value"]) - float(latest["value"])
            elif lb is False:
                imp = float(latest["value"]) - float(prior["value"])
            else:
                imp = float(prior["value"]) - float(latest["value"])
            records.append(
                {
                    "entity_id": latest["entity_id"],
                    "year": int(latest["year"]),
                    "value": float(latest["value"]),
                    "_imp": imp,
                }
            )
        if not records:
            return [], 0, {}
        scored = pd.DataFrame.from_records(records)
        eligible_yoy = int(len(scored))
        if sort == "improved":
            scored_f = scored.loc[scored["_imp"] > _IMP_EPS].copy()
        else:
            scored_f = scored.loc[scored["_imp"] < -_IMP_EPS].copy()
        matched_criteria = int(len(scored_f))
        extra = {"matched_criteria": matched_criteria, "eligible_with_yoy": eligible_yoy}
        if scored_f.empty:
            return [], eligible_yoy, extra
        ascending_imp = sort == "worsened"
        scored_f = scored_f.sort_values("_imp", ascending=ascending_imp)
        rows: list[dict] = []
        for _, row in scored_f.head(limit).iterrows():
            ccn = str(row["entity_id"])
            ev = f"H:{ccn}"
            label = store.entity_label.get(ev)
            if not label or str(label).strip() == str(ccn).strip():
                label = f"Hospital (CCN {ccn})"
            rows.append(
                {
                    "ccn": ccn,
                    "label": label,
                    "year": int(row["year"]),
                    "value": float(row["value"]),
                }
            )
        return rows, eligible_yoy, extra

    latest = sub.groupby("entity_id", as_index=False).last()
    eligible = len(latest)
    if eligible == 0:
        return [], 0, {}

    if sort in ("volume_high", "volume_low"):
        ascending = sort == "volume_low"
        latest = latest.sort_values("value", ascending=ascending)
    elif sort == "worst":
        if lb is True:
            ascending = False
        elif lb is False:
            ascending = True
        else:
            ascending = False
        latest = latest.sort_values("value", ascending=ascending)
    else:
        if lb is True:
            ascending = True
        elif lb is False:
            ascending = False
        else:
            ascending = True
        latest = latest.sort_values("value", ascending=ascending)

    rows = []
    for _, row in latest.head(limit).iterrows():
        ccn = str(row["entity_id"])
        ev = f"H:{ccn}"
        label = store.entity_label.get(ev)
        if not label or str(label).strip() == str(ccn).strip():
            label = f"Hospital (CCN {ccn})"
        rows.append(
            {
                "ccn": ccn,
                "label": label,
                "year": int(row["year"]),
                "value": float(row["value"]),
            }
        )
    return rows, eligible, {}
