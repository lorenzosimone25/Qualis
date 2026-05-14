"""Stable query surface for the CMS Quality dataset.

Used by the Dash app, automated tests, and (later) HTTP / agent integrations.
Implementations live in :mod:`dashboard.data`; this module re-exports the
public API so consumers depend on a single import path.
"""

from __future__ import annotations

from .data import (
    STATE_NAMES,
    DataStore,
    fetch_series,
    get_store,
    list_hospitals_by_state,
    load,
    measure_has_national,
    resolve_location_token_label,
    resolve_location_token_labels,
    search_locations,
)

__all__ = [
    "STATE_NAMES",
    "DataStore",
    "fetch_series",
    "get_store",
    "list_hospitals_by_state",
    "load",
    "measure_has_national",
    "resolve_location_token_label",
    "resolve_location_token_labels",
    "search_locations",
]
