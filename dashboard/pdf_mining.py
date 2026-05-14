"""Mine the CMS data-dictionary PDFs for measure-id descriptions.

The local PDFs in ``data/`` are *structural* dictionaries (column
definitions, character widths, file layouts). They do NOT contain
direction-of-better methodology text — we verified zero hits for
phrases like "higher percentages are better" / "lower is better"
across the 2019, 2020, and 2021 dictionaries. Therefore the
"interpretation" column in the dashboard is derived from clinical
knowledge encoded as a rule table in :mod:`dashboard.glossary`, not
parsed out of the PDFs.

What the PDFs DO contain that's useful:

- Measure-id ↔ human-readable name mappings — including HVBP / HRRP /
  HAC variants that aren't listed in ``Measure_Dates.csv``.
- Short descriptions for some measures (a sentence or two), generally
  on a "Measure ID | Measure Name" tabular line in the dictionary.

This module extracts those mappings into a single ``measure_id ->
descriptive_phrase`` dictionary cached as JSON so we only re-parse the
PDFs when their mtime changes.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

try:
    import pypdf  # type: ignore
except ImportError:  # pragma: no cover - optional at runtime
    pypdf = None  # type: ignore

from .data import PROJECT_ROOT

DATA_ROOT = PROJECT_ROOT / "data"
CACHE_DIR = PROJECT_ROOT / "dashboard" / "_cache"
CACHE_FILE = CACHE_DIR / "pdf_glossary.json"


def _normalize_id(raw: str) -> str:
    """Same canonicaliser the pipeline uses, applied to a raw id from PDF text."""
    return re.sub(r"[^A-Za-z0-9]+", "_", str(raw)).strip("_")


def _clean_phrase(text: str) -> str:
    """Tidy a phrase mined out of PDF text — collapse whitespace, drop junk."""
    text = re.sub(r"\s+", " ", text).strip()
    # Drop trailing footnote markers and quarter / date noise.
    text = re.sub(r"\s*\(?\d{1,2}/\d{1,2}/\d{4}\)?", "", text)
    text = re.sub(r"\s*[1-4]Q20\d{2}\b", "", text)
    text = re.sub(r"\s*\*+\s*$", "", text)
    text = text.strip(" -—:|.,")
    return text


def _list_pdfs() -> list[Path]:
    return sorted(DATA_ROOT.glob("20*_HOSPITALS_*/*.pdf"))


def _extract_text(path: Path) -> str:
    if pypdf is None:
        return ""
    try:
        reader = pypdf.PdfReader(str(path))
    except Exception:
        return ""
    out: list[str] = []
    for page in reader.pages:
        try:
            out.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n".join(out)


# Patterns we recognise in PDF text. Each pattern function takes the full
# PDF text and yields ``(measure_id_canonical, phrase)`` pairs.
_ID_TOKEN = r"[A-Z][A-Z0-9_\-]{1,80}"


def _yield_alternate_id_phrases(text: str):
    """Pattern: "<Measure Name>(...alternate Measure ID: <ID>)".

    Common in 2019 Hospital.pdf for HAI_*_SIR, PSI alternate IDs etc.
    """
    pat = re.compile(
        r"([A-Z][A-Za-z0-9 ,/\-\(\):]+?)\s*\([^)]*?alternate\s+Measure\s+ID:\s*([A-Z][A-Z0-9_\-]+)\s*\)",
        re.IGNORECASE,
    )
    for m in pat.finditer(text):
        phrase = _clean_phrase(m.group(1))
        mid = _normalize_id(m.group(2))
        if phrase and mid:
            yield mid, phrase


def _yield_two_column_rows(text: str):
    """Pattern: a row that looks like '<Description>  <MEASURE_ID>'.

    These come from tables CMS publishes where the first column is
    the human-readable measure name and the second is the canonical id.
    We split on long whitespace runs.
    """
    line_pat = re.compile(rf"^\s*(.{{4,}}?)\s{{2,}}({_ID_TOKEN})\s*$", re.MULTILINE)
    for m in line_pat.finditer(text):
        desc = _clean_phrase(m.group(1))
        mid = _normalize_id(m.group(2))
        if not mid or mid.isdigit():
            continue
        # Ignore rows whose left side looks like a column header.
        if desc.lower() in {"measure id", "measure name", "ccn", "field"}:
            continue
        if 6 <= len(desc) <= 200 and mid not in desc.upper():
            yield mid, desc


def _yield_inline_phrase(text: str):
    """Pattern: '<MEASURE_ID> <description>' on the same line, often inside a list.

    We require the line to start with the id and have a space + at least
    a 6-char description following.
    """
    line_pat = re.compile(
        rf"^\s*({_ID_TOKEN})\s+([A-Z][A-Za-z0-9 ,/\-\(\):;%]+)$",
        re.MULTILINE,
    )
    for m in line_pat.finditer(text):
        mid = _normalize_id(m.group(1))
        desc = _clean_phrase(m.group(2))
        if not mid or len(desc) < 8 or len(desc) > 200:
            continue
        # Skip when description is just upper-case shouted (likely a header).
        if desc == desc.upper() and len(desc.split()) < 3:
            continue
        yield mid, desc


def mine_pdfs() -> dict[str, str]:
    """Return ``{canonical_measure_id: best_phrase}`` mined across every PDF.

    "Best" = the longest non-redundant phrase we found (within reason),
    preferring phrases that don't simply echo the measure id.
    """
    if pypdf is None:
        return {}
    candidates: dict[str, list[str]] = {}
    for pdf in _list_pdfs():
        text = _extract_text(pdf)
        if not text:
            continue
        for fn in (_yield_alternate_id_phrases, _yield_two_column_rows, _yield_inline_phrase):
            for mid, phrase in fn(text):
                if not mid:
                    continue
                # Reject phrases that are themselves an id token.
                if re.fullmatch(_ID_TOKEN, phrase):
                    continue
                candidates.setdefault(mid, []).append(phrase)

    # Pick a single best phrase per measure id.
    chosen: dict[str, str] = {}
    for mid, phrases in candidates.items():
        # Score: prefer longer phrases that aren't shouted in caps.
        def score(p: str) -> tuple:
            lower = p.lower()
            return (
                "alternate" not in lower,            # avoid echoing the id
                int(p != p.upper()),                  # mixed case beats SHOUTING
                min(len(p), 160),                     # length up to 160 is good
            )
        chosen[mid] = max(phrases, key=score)
    return chosen


def _cache_key() -> str:
    """Build a stable signature of the PDFs so we know when to re-mine."""
    parts = []
    for pdf in _list_pdfs():
        try:
            stat = pdf.stat()
            parts.append(f"{pdf.name}:{stat.st_size}:{int(stat.st_mtime)}")
        except FileNotFoundError:
            continue
    return "|".join(parts)


def load_or_build() -> dict[str, str]:
    """Load the cached mapping or build it if the PDFs have changed."""
    sig = _cache_key()
    if CACHE_FILE.exists():
        try:
            cached = json.loads(CACHE_FILE.read_text())
            if cached.get("__signature__") == sig:
                return {k: v for k, v in cached.items() if not k.startswith("__")}
        except Exception:
            pass
    mapping = mine_pdfs()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"__signature__": sig, **mapping}
    try:
        CACHE_FILE.write_text(json.dumps(payload, indent=2, sort_keys=True))
    except Exception:
        pass
    return mapping


__all__ = ["load_or_build", "mine_pdfs"]
