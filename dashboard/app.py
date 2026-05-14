"""CMS Hospital Compare interactive dashboard.

Run with::

    python -m dashboard.app

then open http://127.0.0.1:8050 in a browser.
"""

from __future__ import annotations

import argparse
import io
from datetime import date

import dash
from dash import Input, Output, State, dcc, html, dash_table, no_update
import dash_bootstrap_components as dbc
import plotly.graph_objects as go

from .data import fetch_series, get_store, measure_has_national, search_locations
from .figure import build_export_figure, build_figure
from .glossary import build_glossary

# ---------------------------------------------------------------------------
# Boot — load data once.
# ---------------------------------------------------------------------------
STORE = get_store()
GLOSSARY = build_glossary()

NON_VOLUME_MEASURES = sorted(m for m in STORE.measure_ids if not m.endswith("_VOLUME"))
VOLUME_MEASURES = sorted(STORE.volume_ids)


def _measure_options(ids: list[str]) -> list[dict]:
    """Build dropdown options for the measure picker, joining glossary meanings."""
    meaning_map = dict(zip(GLOSSARY["measure_id"], GLOSSARY["meaning"]))
    out = []
    for mid in ids:
        meaning = meaning_map.get(mid, "")
        # Truncate the meaning a bit so the dropdown stays readable; full text is
        # always available in tooltips and the glossary table.
        short = meaning if len(meaning) <= 110 else meaning[:107] + "..."
        out.append({"label": f"{mid} — {short}" if short else mid, "value": mid,
                    "search": f"{mid} {meaning}".lower()})
    return out


MEASURE_OPTIONS_M = _measure_options(NON_VOLUME_MEASURES)
MEASURE_OPTIONS_V = _measure_options(VOLUME_MEASURES)
_MAX_FILTERED_MEASURE_OPTIONS = 500


def _filter_measure_options(
    full_opts: list[dict],
    search_value: str | None,
    current_value: str | None,
) -> list[dict]:
    """Narrow large measure lists while the user types (Dash ``search_value``)."""
    if not search_value or len(search_value.strip()) < 2:
        return full_opts
    q = search_value.lower().strip()
    out = [
        o for o in full_opts
        if q in f"{o.get('label', '')} {o.get('value', '')} {o.get('search', '')}".lower()
    ]
    if current_value:
        have = {o["value"] for o in out}
        if current_value not in have:
            sel = next((o for o in full_opts if o["value"] == current_value), None)
            if sel is not None:
                out.insert(0, sel)
    if len(out) > _MAX_FILTERED_MEASURE_OPTIONS:
        out = out[:_MAX_FILTERED_MEASURE_OPTIONS]
    return out


try:
    _DROPDOWN_SUPPORTS_SEARCH_VALUE = "search_value" in dcc.Dropdown(id="_cms_dd_probe").available_properties
except Exception:
    _DROPDOWN_SUPPORTS_SEARCH_VALUE = False

LOCATION_STATE_OPTIONS = [o for o in STORE.location_options if o.get("type") == "state"]
LOCATION_OPTION_BY_VALUE = {o["value"]: o for o in STORE.location_options}
LOC_INITIAL_OPTIONS = LOCATION_STATE_OPTIONS if _DROPDOWN_SUPPORTS_SEARCH_VALUE else STORE.location_options
_MIN_LOC_SEARCH_CHARS = 2
_MAX_LOCATION_OPTIONS = 250


def _merge_location_options(search_value: str | None, current_values: list[str] | None) -> list[dict]:
    """Server-side hospital search + state list; avoids shipping every hospital to the browser."""
    current_values = current_values or []
    if not search_value or len(str(search_value).strip()) < _MIN_LOC_SEARCH_CHARS:
        out = list(LOCATION_STATE_OPTIONS)
        have = {o["value"] for o in out}
        for v in current_values:
            if v not in have and v in LOCATION_OPTION_BY_VALUE:
                out.append(LOCATION_OPTION_BY_VALUE[v])
                have.add(v)
        return out
    q = str(search_value).strip().lower()
    states = [
        o for o in LOCATION_STATE_OPTIONS
        if q in o.get("search", "").lower() or q in o.get("label", "").lower()
    ]
    hospitals = search_locations(STORE, search_value, limit=100)
    seen: set[str] = set()
    merged: list[dict] = []
    for o in states + hospitals:
        if o["value"] not in seen:
            seen.add(o["value"])
            merged.append(o)
    for v in current_values:
        if v not in seen and v in LOCATION_OPTION_BY_VALUE:
            merged.insert(0, LOCATION_OPTION_BY_VALUE[v])
            seen.add(v)
    return merged[:_MAX_LOCATION_OPTIONS]


# ---------------------------------------------------------------------------
# Layout primitives.
# ---------------------------------------------------------------------------
def _chart_card(
    prefix: str,
    title: str,
    subtitle: str,
    measure_options: list[dict],
    location_options: list[dict],
) -> dbc.Card:
    """Build a chart card with controls + figure + download buttons.

    Layout inside the card is vertical (controls -> warning -> figure)
    so two cards can sit side-by-side as halves of the page.
    """
    return dbc.Card(
        body=True,
        className="chart-card",
        children=[
            html.Div(
                className="chart-card-header",
                children=[
                    html.Div(
                        [
                            html.H3(title, className="chart-card-title"),
                            html.Span(subtitle, className="chart-card-subtitle"),
                        ],
                        className="chart-card-heading",
                    ),
                    html.Div(
                        className="chart-card-downloads",
                        children=[
                            html.Span("Export", className="dl-label"),
                            dbc.Button("PNG", id=f"{prefix}-dl-png",
                                       size="sm", color="light", className="dl-btn"),
                            dbc.Button("SVG", id=f"{prefix}-dl-svg",
                                       size="sm", color="light", className="dl-btn"),
                            dbc.Button("PDF", id=f"{prefix}-dl-pdf",
                                       size="sm", color="light", className="dl-btn"),
                            dcc.Download(id=f"{prefix}-download"),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="chart-controls-stack",
                children=[
                    html.Div(
                        [
                            html.Label("Hospitals & states", className="ctrl-label"),
                            dcc.Dropdown(
                                id=f"{prefix}-locations",
                                options=location_options,
                                value=[],
                                multi=True,
                                searchable=True,
                                placeholder=(
                                    "Pick a state, or type 2+ letters to search hospitals by "
                                    "name, city, ZIP, or CCN…"
                                ),
                                optionHeight=44,
                                className="loc-dropdown",
                            ),
                        ],
                        className="ctrl-group",
                    ),
                    html.Div(
                        className="ctrl-row",
                        children=[
                            html.Div(
                                [
                                    html.Label("Measure", className="ctrl-label"),
                                    dcc.Dropdown(
                                        id=f"{prefix}-measure",
                                        options=measure_options,
                                        value=measure_options[0]["value"] if measure_options else None,
                                        multi=False,
                                        searchable=True,
                                        clearable=False,
                                        placeholder="Search by ID or description…",
                                        className="measure-dropdown",
                                    ),
                                ],
                                className="ctrl-group ctrl-grow",
                            ),
                            html.Div(
                                [
                                    html.Label("National", className="ctrl-label"),
                                    dbc.Switch(id=f"{prefix}-national",
                                               value=False, className="nat-switch",
                                               label="Overlay"),
                                ],
                                className="ctrl-group ctrl-fixed",
                            ),
                        ],
                    ),
                ],
            ),
            html.Div(id=f"{prefix}-warning", className="chart-warning"),
            dcc.Graph(
                id=f"{prefix}-figure",
                config={
                    "displaylogo": False,
                    "modeBarButtonsToRemove": ["lasso2d", "select2d", "autoScale2d"],
                    "responsive": True,
                },
                style={"height": "520px"},
            ),
        ],
    )


def _glossary_card() -> dbc.Card:
    table_rows = []
    for _, row in GLOSSARY.iterrows():
        intervals = ", ".join(str(i) for i in row["intervals"]) if row["intervals"] else "—"
        kind = "(volume)" if row["is_volume"] else ""
        table_rows.append({
            "measure": row["measure_id"] + (f"  {kind}" if kind else ""),
            "meaning": row["meaning"],
            "intervals": intervals,
            "interpretation": row["interpretation"],
            "_is_volume": "yes" if row["is_volume"] else "no",
        })

    return dbc.Card(
        body=True,
        className="glossary-card",
        children=[
            html.Div(
                className="chart-card-header",
                children=[
                    html.Div(
                        [
                            html.H3("Measure & volume glossary", className="chart-card-title"),
                            html.Span(
                                "Searchable reference for every measure ID in the dataset. "
                                "Type in any column's filter row to narrow it down. "
                                "‘Interpretation’ is a clinical heuristic by measure family — "
                                "see dashboard-design-choices D13 for the rule list.",
                                className="chart-card-subtitle",
                            ),
                        ],
                        className="chart-card-heading",
                    ),
                ],
            ),
            dash_table.DataTable(
                id="glossary-table",
                data=table_rows,
                columns=[
                    {"name": "Measure", "id": "measure"},
                    {"name": "Meaning (description / data dictionary)", "id": "meaning"},
                    {"name": "Lookback (months)", "id": "intervals"},
                    {"name": "Interpretation", "id": "interpretation"},
                ],
                # --- virtualised scrolling ---
                # Disable pagination, render all rows via virtualization with a
                # fixed row height. Filter + sort still work natively.
                virtualization=True,
                page_action="none",
                fixed_rows={"headers": True},
                filter_action="native",
                sort_action="native",
                style_as_list_view=True,
                style_table={
                    "overflowX": "auto",
                    "height": "640px",  # window into the virtualised list
                    "border": "1px solid #eef0f2",
                    "borderRadius": "8px",
                },
                style_header={
                    "backgroundColor": "#1f3a5f",
                    "color": "#ffffff",
                    "fontFamily": "Inter, sans-serif",
                    "fontWeight": "600",
                    "padding": "10px 12px",
                    "border": "none",
                    "position": "sticky",
                    "top": 0,
                },
                style_cell={
                    "fontFamily": "Inter, sans-serif",
                    "fontSize": "13px",
                    "padding": "10px 12px",
                    "border": "none",
                    "borderBottom": "1px solid #eef0f2",
                    "textAlign": "left",
                    "whiteSpace": "normal",
                    "height": "auto",
                    "minHeight": "40px",
                    "verticalAlign": "top",
                    "color": "#222",
                    "backgroundColor": "#ffffff",
                },
                style_cell_conditional=[
                    {"if": {"column_id": "measure"},
                     "fontFamily": "IBM Plex Mono, monospace",
                     "fontWeight": "600",
                     "color": "#1f3a5f",
                     "minWidth": "240px",
                     "maxWidth": "320px",
                     "width": "260px"},
                    {"if": {"column_id": "meaning"},
                     "minWidth": "420px"},
                    {"if": {"column_id": "intervals"},
                     "fontFamily": "IBM Plex Mono, monospace",
                     "minWidth": "120px",
                     "maxWidth": "140px",
                     "width": "130px"},
                    {"if": {"column_id": "interpretation"},
                     "minWidth": "220px",
                     "maxWidth": "320px",
                     "width": "260px",
                     "color": "#444"},
                ],
                style_data_conditional=[
                    {"if": {"filter_query": "{_is_volume} = yes"},
                     "color": "#7a7a7a", "fontStyle": "italic"},
                    {"if": {"filter_query": "{interpretation} contains 'Higher'"},
                     "color": "#1b7837"},
                    {"if": {"filter_query": "{interpretation} contains 'Lower'"},
                     "color": "#762a83"},
                ],
                style_filter={
                    "backgroundColor": "#fafafa",
                    "padding": "6px",
                    "fontFamily": "Inter, sans-serif",
                    "position": "sticky",
                    "top": "44px",
                    "zIndex": 1,
                },
            ),
        ],
    )


# ---------------------------------------------------------------------------
# App.
# ---------------------------------------------------------------------------
external_stylesheets = [
    dbc.themes.LUMEN,
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap",
]

app = dash.Dash(
    __name__,
    external_stylesheets=external_stylesheets,
    title="CMS Quality — Hospital Compare 2019-2026",
    assets_folder="assets",
    suppress_callback_exceptions=True,
)
server = app.server  # WSGI hook (gunicorn etc.)

app.layout = dbc.Container(
    fluid=True,
    className="app-shell",
    children=[
        html.Div(
            className="app-header",
            children=[
                html.Div(
                    [
                        html.H1("CMS Quality Explorer", className="app-title"),
                        html.Span(
                            "Hospital Compare measures & volumes · 2019–2026",
                            className="app-subtitle",
                        ),
                    ],
                    className="app-heading",
                ),
                html.Div(
                    [
                        html.Span(f"{len(STORE.location_options):,}", className="stat-num"),
                        html.Span("hospitals + states", className="stat-label"),
                        html.Span(f"{len(STORE.measure_ids):,}", className="stat-num"),
                        html.Span("measures & volumes", className="stat-label"),
                        html.Span("8", className="stat-num"),
                        html.Span("years", className="stat-label"),
                    ],
                    className="app-stats",
                ),
            ],
        ),
        # Two charts side-by-side on wide screens, stacked on narrow.
        dbc.Row(
            className="charts-row g-3",
            children=[
                dbc.Col(
                    _chart_card(
                        prefix="m",
                        title="Measures",
                        subtitle="Risk-standardised rates, ratios, scores, and survey indicators.",
                        measure_options=MEASURE_OPTIONS_M,
                        location_options=LOC_INITIAL_OPTIONS,
                    ),
                    lg=6, md=12,
                ),
                dbc.Col(
                    _chart_card(
                        prefix="v",
                        title="Volumes",
                        subtitle="Patient / case counts (denominators) for the headline measures.",
                        measure_options=MEASURE_OPTIONS_V,
                        location_options=LOC_INITIAL_OPTIONS,
                    ),
                    lg=6, md=12,
                ),
            ],
        ),
        # Glossary card spans the full content width below the charts.
        _glossary_card(),
        html.Footer(
            className="app-footer",
            children=[
                html.Span("Built from the harmonised pipeline outputs in "),
                html.Code("processed/"),
                html.Span(". Source: CMS Hospital Compare / Care Compare archives 2019–2026."),
            ],
        ),
        # Hidden stores cache the most recently rendered figure JSON so the download
        # callbacks can re-render without re-fetching data.
        dcc.Store(id="m-fig-store"),
        dcc.Store(id="v-fig-store"),
        # Dummy outputs the clientside pill-coloring callback writes to.
        dcc.Store(id="m-pill-tick"),
        dcc.Store(id="v-pill-tick"),
    ],
)


# ---------------------------------------------------------------------------
# Clientside callback: paint multi-select pills with entity-type colors.
#
# The dropdown options use prefixed values ("H:..." for hospital, "S:..." for
# state). After Dash re-renders the pills (which the standard Select widget
# does on every value change), we walk the DOM and add a class to each pill
# so CSS can color it. We correlate by parsing the pill's display label,
# which always ends with " · CCN <id>" for hospitals or " (XX)" for states.
# ---------------------------------------------------------------------------
PILL_COLOR_JS = r"""
(function() {
  function paint() {
    document.querySelectorAll('.Select--multi .Select-value').forEach(function(pill) {
      var labelEl = pill.querySelector('.Select-value-label');
      if (!labelEl) { return; }
      var t = labelEl.textContent || '';
      pill.classList.remove('loc-pill-hospital', 'loc-pill-state');
      if (/CCN\s+\d/.test(t)) {
        pill.classList.add('loc-pill-hospital');
      } else if (/\([A-Z]{2}\)\s*$/.test(t.trim())) {
        pill.classList.add('loc-pill-state');
      }
    });
  }
  // Run twice — once now (after value change), once after Dash repaints.
  paint();
  setTimeout(paint, 50);
  setTimeout(paint, 200);
  return window.dash_clientside && window.dash_clientside.no_update;
})()
"""

app.clientside_callback(
    PILL_COLOR_JS,
    Output("m-pill-tick", "data"),
    Input("m-locations", "value"),
)
app.clientside_callback(
    PILL_COLOR_JS,
    Output("v-pill-tick", "data"),
    Input("v-locations", "value"),
)


# ---------------------------------------------------------------------------
# Callbacks: chart rendering.
# ---------------------------------------------------------------------------
def _render_chart(prefix: str, locations, measure_id, national_on, suffix: str):
    """Shared callback body for measures & volumes charts."""
    locations = locations or []
    has_nat = measure_has_national(STORE, measure_id) if measure_id else False
    series = fetch_series(STORE, measure_id, locations, include_national=national_on and has_nat)

    fig = build_figure(
        series,
        measure_id or "",
        show_national=national_on,
        national_available=has_nat,
        title_suffix=f"({suffix})",
    )

    warning = ""
    if not locations:
        warning = "Pick one or more hospitals or states above to begin."
    if national_on and measure_id and not has_nat:
        warning = (warning + "  ·  " if warning else "") + "National series is not published for this measure."

    return fig, fig.to_json(), warning


@app.callback(
    Output("m-figure", "figure"),
    Output("m-fig-store", "data"),
    Output("m-warning", "children"),
    Input("m-locations", "value"),
    Input("m-measure", "value"),
    Input("m-national", "value"),
)
def _measures_chart(locations, measure_id, national_on):
    return _render_chart("m", locations, measure_id, bool(national_on), "Measures")


@app.callback(
    Output("v-figure", "figure"),
    Output("v-fig-store", "data"),
    Output("v-warning", "children"),
    Input("v-locations", "value"),
    Input("v-measure", "value"),
    Input("v-national", "value"),
)
def _volumes_chart(locations, measure_id, national_on):
    return _render_chart("v", locations, measure_id, bool(national_on), "Volumes")


# ---------------------------------------------------------------------------
# Callbacks: downloads.
# ---------------------------------------------------------------------------
def _send_image(fig_json: str, fmt: str, measure_id: str | None):
    if not fig_json:
        return no_update
    fig = go.Figure(go.Figure().to_dict()) if not fig_json else go.Figure(_load_fig(fig_json))
    export = build_export_figure(fig)
    buf = io.BytesIO()
    today = date.today().isoformat()
    safe_mid = (measure_id or "chart").replace("/", "_")
    fname = f"cms_{safe_mid}_{today}.{fmt}"
    width, height, scale = 2400, 1500, 1
    if fmt == "png":
        scale = 1  # already at 2400x1500 for ~300 DPI on 8x5 in
    try:
        export.write_image(buf, format=fmt, width=width, height=height, scale=scale, engine="kaleido")
    except Exception as exc:  # pragma: no cover - kaleido-environment dependent
        return dict(content=f"Could not render image: {exc}", filename="error.txt")
    buf.seek(0)
    return dcc.send_bytes(buf.getvalue(), filename=fname)


def _load_fig(fig_json: str) -> dict:
    import json
    return json.loads(fig_json)


@app.callback(
    Output("m-download", "data"),
    Input("m-dl-png", "n_clicks"),
    Input("m-dl-svg", "n_clicks"),
    Input("m-dl-pdf", "n_clicks"),
    State("m-fig-store", "data"),
    State("m-measure", "value"),
    prevent_initial_call=True,
)
def _measures_download(n_png, n_svg, n_pdf, fig_json, measure_id):
    triggered = dash.callback_context.triggered
    if not triggered:
        return no_update
    button_id = triggered[0]["prop_id"].split(".")[0]
    fmt = button_id.split("-")[-1]
    return _send_image(fig_json, fmt, measure_id)


@app.callback(
    Output("v-download", "data"),
    Input("v-dl-png", "n_clicks"),
    Input("v-dl-svg", "n_clicks"),
    Input("v-dl-pdf", "n_clicks"),
    State("v-fig-store", "data"),
    State("v-measure", "value"),
    prevent_initial_call=True,
)
def _volumes_download(n_png, n_svg, n_pdf, fig_json, measure_id):
    triggered = dash.callback_context.triggered
    if not triggered:
        return no_update
    button_id = triggered[0]["prop_id"].split(".")[0]
    fmt = button_id.split("-")[-1]
    return _send_image(fig_json, fmt, measure_id)


# ---------------------------------------------------------------------------
# Callbacks: narrow dropdown options while typing (measure + location pickers).
# ---------------------------------------------------------------------------
if _DROPDOWN_SUPPORTS_SEARCH_VALUE:

    @app.callback(
        Output("m-measure", "options"),
        Input("m-measure", "search_value"),
        State("m-measure", "value"),
        prevent_initial_call=True,
    )
    def _narrow_m_measure_options(search_value, current_value):
        return _filter_measure_options(MEASURE_OPTIONS_M, search_value, current_value)

    @app.callback(
        Output("v-measure", "options"),
        Input("v-measure", "search_value"),
        State("v-measure", "value"),
        prevent_initial_call=True,
    )
    def _narrow_v_measure_options(search_value, current_value):
        return _filter_measure_options(MEASURE_OPTIONS_V, search_value, current_value)

    @app.callback(
        Output("m-locations", "options"),
        Input("m-locations", "search_value"),
        State("m-locations", "value"),
        prevent_initial_call=True,
    )
    def _narrow_m_locations(search_value, current_values):
        return _merge_location_options(search_value, current_values)

    @app.callback(
        Output("v-locations", "options"),
        Input("v-locations", "search_value"),
        State("v-locations", "value"),
        prevent_initial_call=True,
    )
    def _narrow_v_locations(search_value, current_values):
        return _merge_location_options(search_value, current_values)


# ---------------------------------------------------------------------------
# Entry point.
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description="CMS Quality dashboard server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8050)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    app.run(host=args.host, port=args.port, debug=args.debug)


if __name__ == "__main__":
    main()
