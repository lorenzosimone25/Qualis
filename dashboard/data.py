"""Data loading layer for the CMS dashboard.

Reads the three harmonised long-format CSVs (hospital, state, national) and
the corresponding rowMetadata files into a single in-memory store. The
store is built once at import time so every Dash callback can filter
without touching disk.

Memory budget (measured on a typical laptop, M-series Mac):
    hospital master (12.4M rows) ~150 MB after dtype downcast
    state master (49k rows)       ~ 2 MB
    national master (~1k rows)    < 1 MB
    rowMetadata (hospitals)        ~5 MB
    columnMetadata cross-year     <10 MB

Optional: set ``CMS_QUALITY_USE_PARQUET=1`` and place ``master_long.parquet``
beside ``master_long.csv`` under ``processed/merged/`` (requires pyarrow) for
potentially faster loads / lower peak RAM.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROCESSED = PROJECT_ROOT / "processed"

# US state code -> full state / territory name. We support all entity ids
# the pipeline produces, so this includes DC and the major US territories.
STATE_NAMES: dict[str, str] = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida",
    "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
    "AS": "American Samoa", "GU": "Guam", "MP": "Northern Mariana Islands",
    "PR": "Puerto Rico", "VI": "U.S. Virgin Islands",
}


@dataclass
class DataStore:
    """In-memory store of every dataframe the dashboard needs."""

    hospital: pd.DataFrame
    state: pd.DataFrame
    national: pd.DataFrame

    hospital_meta: pd.DataFrame
    state_meta: pd.DataFrame
    national_meta: pd.DataFrame

    column_meta_hospital: pd.DataFrame
    column_meta_state: pd.DataFrame
    column_meta_national: pd.DataFrame

    location_options: list[dict]
    measure_ids: list[str]
    volume_ids: list[str]

    entity_label: dict[str, str]

    hospital_by_measure: Any = None
    state_by_measure: Any = None
    national_by_measure: Any = None

    national_measures_with_values: frozenset[str] = field(default_factory=frozenset)
    hospital_entity_ids: frozenset[str] = field(default_factory=frozenset)

    # O(1) lookups: ZIP5 and 2-letter state -> CCNs present in hospital long data.
    zip_to_ccns: dict[str, tuple[str, ...]] = field(default_factory=dict)
    state_to_ccns: dict[str, tuple[str, ...]] = field(default_factory=dict)


def _slim_long(path: Path) -> pd.DataFrame:
    """Read a master_long.csv with downcast dtypes."""
    df = pd.read_csv(
        path,
        dtype={"entity_id": "string", "measure_id": "string", "year": "int16"},
    )
    df["value"] = pd.to_numeric(df["value"], errors="coerce").astype("float32")
    df["measure_id"] = df["measure_id"].astype("category")
    return df


def _slim_long_parquet(path: Path) -> pd.DataFrame:
    """Read Parquet with the same logical schema as :func:`_slim_long`."""
    df = pd.read_parquet(path)
    df = df.rename(columns={c: c.lower() for c in df.columns})
    for col in ("entity_id", "measure_id", "year", "value"):
        if col not in df.columns:
            raise ValueError(f"Parquet missing column {col!r}: {path}")
    df["entity_id"] = df["entity_id"].astype("string")
    df["measure_id"] = df["measure_id"].astype("category")
    df["year"] = df["year"].astype("int16")
    df["value"] = pd.to_numeric(df["value"], errors="coerce").astype("float32")
    return df


def _read_merged_hospital_long() -> pd.DataFrame:
    """Load merged hospital long table from CSV, or Parquet when enabled."""
    merged_dir = PROCESSED / "merged"
    use_pq = os.environ.get("CMS_QUALITY_USE_PARQUET", "").strip().lower() in ("1", "true", "yes")
    pq_path = merged_dir / "master_long.parquet"
    csv_path = merged_dir / "master_long.csv"
    if use_pq and pq_path.exists():
        return _slim_long_parquet(pq_path)
    return _slim_long(csv_path)


def _read_row_metadata(path: Path) -> pd.DataFrame:
    """Read a transposed rowMetadata.csv and return a frame indexed by entity id."""
    raw = pd.read_csv(path, dtype=str)
    raw = raw.rename(columns={raw.columns[0]: "_attr"})
    df = raw.set_index("_attr").transpose()
    df.index.name = "entity_id"
    df.index = df.index.astype(str)
    return df


def _resolve_measure_group_key(grp: Any, measure_id: str):
    """Return the groupby key matching ``measure_id`` (handles categorical dtype quirks)."""
    if grp is None:
        return None
    if measure_id in grp.groups:
        return measure_id
    for k in grp.groups:
        if str(k) == measure_id:
            return k
    return None


def _load_column_meta(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(
            columns=["measure_id", "year", "start_date", "end_date", "interval_months", "details"]
        )
    df = pd.read_csv(path, dtype={"measure_id": str})
    if "interval_months" in df.columns:
        df["interval_months"] = pd.to_numeric(df["interval_months"], errors="coerce")
    return df


def _safe_str(s) -> str:
    if isinstance(s, str):
        return s.strip()
    return ""


def _zip_search_tokens(z: str) -> str:
    """Include raw ZIP and digits-only form so typing partial ZIP matches."""
    z = z.strip()
    if not z:
        return ""
    digits = "".join(ch for ch in z if ch.isdigit())
    parts = [z.lower()]
    if digits and digits != z.lower():
        parts.append(digits)
    return " ".join(parts)


def _hospital_location_option(ccn: str, n: str, c: str, s: str, a: str, z: str) -> dict:
    """Single hospital entry for :class:`dcc.Dropdown` (label/value/search)."""
    n_disp = n.title() if n.isupper() else n
    c_disp = c.title() if c.isupper() else c
    loc_bits = []
    if c_disp:
        loc_bits.append(c_disp)
    if s:
        loc_bits.append(s)
    loc_str = ", ".join(loc_bits)
    if n_disp and loc_str:
        label = f"{n_disp} — {loc_str}  ·  CCN {ccn}"
    elif n_disp:
        label = f"{n_disp}  ·  CCN {ccn}"
    else:
        label = f"CCN {ccn}"
    zip_bits = _zip_search_tokens(z)
    search_blob = f"{label} {a} {ccn} {zip_bits}".lower()
    return {
        "label": label,
        "value": f"H:{ccn}",
        "search": search_blob,
        "type": "hospital",
    }


def _build_location_options(store: DataStore) -> tuple[list[dict], dict[str, str]]:
    """Build the dcc.Dropdown option list combining hospitals + states."""
    options: list[dict] = []
    label_for: dict[str, str] = {}

    hm = store.hospital_meta
    hospital_present = store.hospital_entity_ids
    hm = hm[hm.index.isin(hospital_present)].copy()

    name = hm["name"].fillna("").map(_safe_str) if "name" in hm.columns else pd.Series("", index=hm.index)
    city = hm["city"].fillna("").map(_safe_str) if "city" in hm.columns else pd.Series("", index=hm.index)
    state = hm["state"].fillna("").map(_safe_str) if "state" in hm.columns else pd.Series("", index=hm.index)
    address = hm["address"].fillna("").map(_safe_str) if "address" in hm.columns else pd.Series("", index=hm.index)
    zip_col = hm["zip"].fillna("").map(_safe_str) if "zip" in hm.columns else pd.Series("", index=hm.index)

    for ccn, n, c, s, a, z in zip(hm.index, name, city, state, address, zip_col):
        ccn = str(ccn)
        opt = _hospital_location_option(ccn, n, c, s, a, z)
        options.append(opt)
        n_disp = n.title() if n.isupper() else n
        legend = n_disp if n_disp else f"Hospital {ccn}"
        label_for[f"H:{ccn}"] = legend

    options.sort(key=lambda o: o["label"].lower())

    state_codes = sorted(set(store.state["entity_id"].dropna().unique()))
    state_options: list[dict] = []
    for code in state_codes:
        full = STATE_NAMES.get(code, code)
        state_options.append(
            {
                "label": f"{full} ({code})",
                "value": f"S:{code}",
                "search": f"{full} {code}".lower(),
                "type": "state",
            }
        )
        label_for[f"S:{code}"] = full

    options = state_options + options
    label_for["__NATIONAL__"] = "National (USA)"
    return options, label_for


def _normalize_zip5(raw: str) -> str | None:
    digits = "".join(c for c in str(raw) if c.isdigit())
    if len(digits) >= 5:
        return digits[:5]
    return None


def _normalize_state_code(raw: str) -> str | None:
    s = re.sub(r"[^A-Za-z]", "", str(raw)).upper()
    if len(s) >= 2:
        return s[:2]
    return None


def _build_geo_indices(
    hm: pd.DataFrame, present: frozenset[str]
) -> tuple[dict[str, tuple[str, ...]], dict[str, tuple[str, ...]]]:
    """ZIP5 and state-code maps for indexed hospital discovery."""
    from collections import defaultdict

    zmap: dict[str, set[str]] = defaultdict(set)
    smap: dict[str, set[str]] = defaultdict(set)
    hm = hm[hm.index.astype(str).isin(present)]
    for ccn in hm.index:
        ccn_s = str(ccn)
        row = hm.loc[ccn]
        if isinstance(row, pd.DataFrame):
            row = row.iloc[0]
        zraw = row["zip"] if "zip" in hm.columns else ""
        z5 = _normalize_zip5(str(zraw))
        if z5:
            zmap[z5].add(ccn_s)
        st_raw = row["state"] if "state" in hm.columns else ""
        sc = _normalize_state_code(str(st_raw))
        if sc:
            smap[sc].add(ccn_s)
    return (
        {k: tuple(sorted(v)) for k, v in zmap.items()},
        {k: tuple(sorted(v)) for k, v in smap.items()},
    )


def _hospital_match_score(q: str, n: str, c: str, s: str, a: str, z: str, ccn: str) -> float:
    """Higher = better match for substring ``q`` (already lowercased)."""
    score = 0.0
    for raw in (n, c, s, z, ccn):
        t = raw.strip().lower()
        if not t:
            continue
        if t.startswith(q):
            score += 55.0
        elif q in t:
            score += 22.0
    al = a.strip().lower()
    if al and q in al:
        score += 12.0
    score += 5.0 / (1.0 + len(n))
    return score


def search_locations(store: DataStore, query: str, *, limit: int = 50) -> list[dict]:
    """Return up to ``limit`` hospital dropdown options matching ``query``.

    Searches :attr:`DataStore.hospital_meta` only (no scans of the long
    measure table). Requires at least two non-space characters in ``query``.
    """
    q = (query or "").strip().lower()
    if len(q) < 2:
        return []
    hm = store.hospital_meta
    if hm.empty:
        return []
    hm = hm[hm.index.astype(str).isin(store.hospital_entity_ids)]

    name = hm["name"].fillna("").map(_safe_str) if "name" in hm.columns else pd.Series("", index=hm.index)
    city = hm["city"].fillna("").map(_safe_str) if "city" in hm.columns else pd.Series("", index=hm.index)
    st = hm["state"].fillna("").map(_safe_str) if "state" in hm.columns else pd.Series("", index=hm.index)
    address = hm["address"].fillna("").map(_safe_str) if "address" in hm.columns else pd.Series("", index=hm.index)
    zip_col = hm["zip"].fillna("").map(_safe_str) if "zip" in hm.columns else pd.Series("", index=hm.index)

    ccn_str = hm.index.astype(str)
    zip_tok = zip_col.map(_zip_search_tokens)
    blob = (
        name.str.lower()
        + " "
        + city.str.lower()
        + " "
        + st.str.lower()
        + " "
        + address.str.lower()
        + " "
        + zip_col.fillna("").astype(str).str.lower()
        + " "
        + zip_tok.fillna("").astype(str)
        + " "
        + ccn_str.str.lower()
    )
    mask = blob.str.contains(q, regex=False, na=False)
    hits = hm.loc[mask]
    if hits.empty:
        return []

    scored: list[tuple[float, str, dict]] = []
    for ccn, row in hits.iterrows():
        n = _safe_str(row["name"]) if "name" in row.index else ""
        c = _safe_str(row["city"]) if "city" in row.index else ""
        s = _safe_str(row["state"]) if "state" in row.index else ""
        a = _safe_str(row["address"]) if "address" in row.index else ""
        z = _safe_str(row["zip"]) if "zip" in row.index else ""
        ccn_s = str(ccn)
        score = _hospital_match_score(q, n, c, s, a, z, ccn_s)
        scored.append((score, ccn_s, _hospital_location_option(ccn_s, n, c, s, a, z)))
    scored.sort(key=lambda x: (-x[0], x[1]))

    return [opt for _, _, opt in scored[:limit]]


def list_hospitals_by_state(
    store: DataStore,
    state: str,
    *,
    query: str = "",
    offset: int = 0,
    limit: int = 100,
    sort: str = "name",
) -> tuple[list[dict], int]:
    """Paginated hospital options for a USPS state (metadata only).

    Uses :attr:`DataStore.state_to_ccns` and :attr:`DataStore.hospital_meta`.
    """
    st = _normalize_state_code(state) or ""
    if len(st) != 2:
        return [], 0
    ccns = list(store.state_to_ccns.get(st, ()))
    if not ccns:
        return [], 0
    hm = store.hospital_meta
    q = (query or "").strip().lower()
    opts: list[dict] = []
    for ccn in ccns:
        ccn_s = str(ccn).strip()
        if not ccn_s:
            continue
        if hm.empty:
            n, c, sa, a, z = "", "", st, "", ""
        else:
            mask = hm.index.astype(str) == ccn_s
            if not mask.any():
                n, c, sa, a, z = "", "", st, "", ""
            else:
                row = hm.loc[mask].iloc[0]
                n = _safe_str(row["name"]) if "name" in row.index else ""
                c = _safe_str(row["city"]) if "city" in row.index else ""
                sa = _safe_str(row["state"]) if "state" in row.index else st
                a = _safe_str(row["address"]) if "address" in row.index else ""
                z = _safe_str(row["zip"]) if "zip" in row.index else ""
        opt = _hospital_location_option(ccn_s, n, c, sa, a, z)
        if q and q not in opt["search"] and q not in ccn_s.lower():
            continue
        opts.append(opt)
    if sort == "ccn":
        opts.sort(key=lambda o: str(o.get("value", "")))
    else:
        opts.sort(key=lambda o: str(o.get("label", "")).lower())
    total = len(opts)
    start = max(0, int(offset))
    lim = max(1, int(limit))
    return opts[start : start + lim], total


def load() -> DataStore:
    """Build the full in-memory store. Called once at app startup."""
    hospital = _read_merged_hospital_long()
    state = _slim_long(PROCESSED / "state" / "master_long.csv")
    national = _slim_long(PROCESSED / "national" / "master_long.csv")

    hospital_meta = _read_row_metadata(PROCESSED / "merged" / "rowMetadata.csv")
    state_meta = _read_row_metadata(PROCESSED / "state" / "rowMetadata.csv")
    national_meta = _read_row_metadata(PROCESSED / "national" / "rowMetadata.csv")

    column_meta_h = _load_column_meta(PROCESSED / "merged" / "columnMetadata_long.csv")
    column_meta_s = _load_column_meta(PROCESSED / "state" / "columnMetadata_long.csv")
    column_meta_n = _load_column_meta(PROCESSED / "national" / "columnMetadata_long.csv")

    universe: set[str] = set()
    for df in (hospital, state, national):
        universe.update(df["measure_id"].dropna().astype(str).unique())
    measure_ids = sorted(universe)
    volume_ids = sorted(m for m in measure_ids if m.endswith("_VOLUME"))

    national_measures_with_values = frozenset(
        str(x) for x in national.loc[national["value"].notna(), "measure_id"].unique()
    )

    hospital_entity_ids = frozenset(hospital["entity_id"].astype(str).unique())

    hospital_by_measure = hospital.groupby("measure_id", sort=False, observed=True)
    state_by_measure = state.groupby("measure_id", sort=False, observed=True)
    national_by_measure = national.groupby("measure_id", sort=False, observed=True)

    zip_to_ccns, state_to_ccns = _build_geo_indices(hospital_meta, hospital_entity_ids)

    store = DataStore(
        hospital=hospital,
        state=state,
        national=national,
        hospital_meta=hospital_meta,
        state_meta=state_meta,
        national_meta=national_meta,
        column_meta_hospital=column_meta_h,
        column_meta_state=column_meta_s,
        column_meta_national=column_meta_n,
        location_options=[],
        measure_ids=measure_ids,
        volume_ids=volume_ids,
        entity_label={},
        hospital_by_measure=hospital_by_measure,
        state_by_measure=state_by_measure,
        national_by_measure=national_by_measure,
        national_measures_with_values=national_measures_with_values,
        hospital_entity_ids=hospital_entity_ids,
        zip_to_ccns=zip_to_ccns,
        state_to_ccns=state_to_ccns,
    )
    options, label_for = _build_location_options(store)
    store.location_options = options
    store.entity_label = label_for
    return store


@lru_cache(maxsize=None)
def get_store() -> DataStore:
    """Singleton accessor — first call loads, subsequent calls reuse."""
    return load()


def fetch_series(
    store: DataStore,
    measure_id: str,
    locations: Iterable[str],
    include_national: bool,
) -> pd.DataFrame:
    """Return a tidy frame for plotting."""
    rows: list[pd.DataFrame] = []
    if not measure_id:
        return pd.DataFrame(columns=["entity_value", "label", "type", "year", "value"])

    hosp_ids = [v.split(":", 1)[1] for v in locations if v.startswith("H:")]
    state_ids = [v.split(":", 1)[1] for v in locations if v.startswith("S:")]

    if hosp_ids:
        grp = store.hospital_by_measure
        mk = _resolve_measure_group_key(grp, measure_id)
        if mk is not None:
            sub = grp.get_group(mk)
            sub = sub[sub["entity_id"].isin(hosp_ids)].copy()
        else:
            sub = pd.DataFrame()
        if not sub.empty:
            sub["entity_value"] = "H:" + sub["entity_id"].astype(str)
            sub["type"] = "hospital"
            mapped = sub["entity_value"].map(store.entity_label)
            sub["label"] = mapped.fillna(
                sub["entity_id"].astype(str).map(lambda c: f"Hospital (CCN {c})"),
            )
            rows.append(sub[["entity_value", "label", "type", "year", "value"]])

    if state_ids:
        grp = store.state_by_measure
        mk = _resolve_measure_group_key(grp, measure_id)
        if mk is not None:
            sub = grp.get_group(mk)
            sub = sub[sub["entity_id"].isin(state_ids)].copy()
        else:
            sub = pd.DataFrame()
        if not sub.empty:
            sub["entity_value"] = "S:" + sub["entity_id"].astype(str)
            sub["type"] = "state"
            mapped = sub["entity_value"].map(store.entity_label)
            sub["label"] = mapped.fillna(
                sub["entity_id"]
                .astype(str)
                .map(lambda c: STATE_NAMES.get(str(c).upper()[:2], f"State ({c})")),
            )
            rows.append(sub[["entity_value", "label", "type", "year", "value"]])

    if include_national:
        grp = store.national_by_measure
        mk = _resolve_measure_group_key(grp, measure_id)
        if mk is not None:
            sub = grp.get_group(mk).copy()
        else:
            sub = pd.DataFrame()
        if not sub.empty:
            sub["entity_value"] = "__NATIONAL__"
            sub["type"] = "national"
            sub["label"] = "National (USA)"
            rows.append(sub[["entity_value", "label", "type", "year", "value"]])

    if not rows:
        return pd.DataFrame(columns=["entity_value", "label", "type", "year", "value"])

    out = pd.concat(rows, ignore_index=True)
    out = out[~out["value"].isna()].copy()
    out["year"] = out["year"].astype(int)
    out = out.sort_values(["type", "label", "year"])
    return out


def measure_has_national(store: DataStore, measure_id: str) -> bool:
    """True if the national table publishes any non-null value for this measure."""
    if not measure_id:
        return False
    return str(measure_id) in store.national_measures_with_values


def resolve_location_token_label(store: DataStore, token: str) -> str:
    """Human-readable label for a picker token (``H:ccn``, ``S:ST``, ``__NATIONAL__``)."""
    tok = (token or "").strip()
    if not tok:
        return ""
    if tok in store.entity_label:
        lab = store.entity_label[tok]
        if lab and str(lab).strip():
            return str(lab).strip()
    if tok.startswith("H:"):
        ccn = tok.split(":", 1)[1].strip()
        if not ccn:
            return tok
        hm = store.hospital_meta
        if not hm.empty:
            mask = hm.index.astype(str) == ccn
            if mask.any():
                row = hm.loc[mask].iloc[0]
                if "name" in hm.columns:
                    n = str(row.get("name") or "").strip()
                    if n:
                        return n.title() if n.isupper() else n
        return f"Hospital (CCN {ccn})"
    if tok.startswith("S:"):
        code = tok.split(":", 1)[1].strip().upper()[:2]
        if not code:
            return tok
        return STATE_NAMES.get(code, f"State ({code})")
    if tok == "__NATIONAL__":
        return "National (USA)"
    return tok


def resolve_location_token_labels(store: DataStore, tokens: Iterable[str]) -> dict[str, str]:
    """Batch version of :func:`resolve_location_token_label` for API responses."""
    out: dict[str, str] = {}
    for t in tokens:
        if not isinstance(t, str) or not t.strip():
            continue
        key = t.strip()
        out[key] = resolve_location_token_label(store, key)
    return out


__all__ = [
    "DataStore",
    "STATE_NAMES",
    "fetch_series",
    "get_store",
    "load",
    "measure_has_national",
    "resolve_location_token_label",
    "resolve_location_token_labels",
    "search_locations",
    "list_hospitals_by_state",
]
