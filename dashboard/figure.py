"""Plotly figure construction for the dashboard.

Two helpers:

- :func:`build_figure`: builds the on-screen figure given the tidy series
  frame from :func:`dashboard.data.fetch_series`.
- :func:`build_export_figure`: clones the figure and bumps font sizes,
  line widths, and marker sizes for publication-grade export.
"""

from __future__ import annotations

from typing import Iterable

import pandas as pd
import plotly.graph_objects as go
import plotly.colors as pc

from .glossary import lookup_interpretation, lookup_intervals, lookup_meaning

# Color palette: Plotly "Safe" qualitative — colour-blind-friendly.
_PALETTE = pc.qualitative.Safe + pc.qualitative.Dark24

# Distinct color bands per entity type (for legend / future entity-type encoding).
HOSPITAL_LINE_DASH = "solid"
STATE_LINE_DASH = "dash"
NATIONAL_LINE_DASH = "longdash"
NATIONAL_LINE_COLOR = "#222222"


def _full_year_range(df: pd.DataFrame) -> list[int]:
    if df.empty:
        return list(range(2019, 2027))
    return list(range(int(df["year"].min()), int(df["year"].max()) + 1))


def build_figure(
    series: pd.DataFrame,
    measure_id: str,
    *,
    show_national: bool,
    national_available: bool,
    title_suffix: str = "",
) -> go.Figure:
    """Build the on-screen Plotly figure.

    Parameters
    ----------
    series : DataFrame from :func:`dashboard.data.fetch_series`.
    measure_id : the canonical id (e.g. ``MORT_30_AMI``); shown verbatim
        on the y-axis label.
    show_national : whether the user has toggled the national overlay ON.
    national_available : whether national data exists for this measure.
        (Used to render the "national overlay not available" footnote
        when the user has the toggle on but data is missing.)
    title_suffix : ``"(Measures)"`` or ``"(Volumes)"`` for the chart card.
    """
    fig = go.Figure()

    if series.empty:
        # Empty state — keep the layout consistent so the card doesn't jump.
        _apply_layout(fig, measure_id=measure_id, title_suffix=title_suffix,
                      x_range=list(range(2019, 2027)),
                      empty_message="No data published for this measure for the selected entities.")
        return fig

    # Stable trace ordering: states alphabetical, then hospitals alphabetical, then national.
    ordering = {"state": 0, "hospital": 1, "national": 2}
    series = series.assign(_ord=series["type"].map(ordering)).sort_values(
        ["_ord", "label", "year"]
    )

    # National first so it goes underneath user's selected lines.
    color_idx = 0
    drawn_national = False

    for (entity_value, label), grp in series.groupby(["entity_value", "label"], sort=False):
        if grp["type"].iloc[0] == "national":
            color = NATIONAL_LINE_COLOR
            dash = NATIONAL_LINE_DASH
            width = 4
            symbol = "diamond"
            drawn_national = True
        else:
            color = _PALETTE[color_idx % len(_PALETTE)]
            color_idx += 1
            if grp["type"].iloc[0] == "state":
                dash = STATE_LINE_DASH
                width = 2.5
                symbol = "square"
            else:
                dash = HOSPITAL_LINE_DASH
                width = 2.25
                symbol = "circle"

        fig.add_trace(
            go.Scatter(
                x=grp["year"].tolist(),
                y=grp["value"].tolist(),
                mode="lines+markers",
                name=label,
                line=dict(color=color, width=width, dash=dash),
                marker=dict(size=8, symbol=symbol, line=dict(color=color, width=1.25)),
                connectgaps=False,
                hovertemplate=(
                    f"<b>{label}</b><br>Year: %{{x}}<br>Value: %{{y:.4g}}<extra></extra>"
                ),
            )
        )

    note = ""
    if show_national and not national_available and not drawn_national:
        note = "National data not published for this measure."

    _apply_layout(
        fig,
        measure_id=measure_id,
        title_suffix=title_suffix,
        x_range=_full_year_range(series),
        empty_message=None,
        footnote=note,
    )
    return fig


def _apply_layout(
    fig: go.Figure,
    *,
    measure_id: str,
    title_suffix: str,
    x_range: Iterable[int],
    empty_message: str | None,
    footnote: str = "",
) -> None:
    meaning = lookup_meaning(measure_id) if measure_id else ""
    interpretation = lookup_interpretation(measure_id) if measure_id else ""
    intervals = lookup_intervals(measure_id) if measure_id else []
    interval_str = ", ".join(str(i) for i in intervals) if intervals else "—"

    # Y-axis label rendered as a hoverable annotation per spec D9.
    annotations: list[dict] = []
    if measure_id:
        hover = (
            f"<b>{measure_id}</b><br>"
            f"{meaning}<br>"
            f"<i>Lookback (months):</i> {interval_str}<br>"
            f"<i>Interpretation:</i> {interpretation}"
        )
        annotations.append(
            dict(
                x=-0.075, y=0.5, xref="paper", yref="paper",
                text=f"<b>{measure_id}</b>",
                showarrow=False,
                textangle=-90,
                font=dict(family="IBM Plex Mono, monospace", size=14, color="#1f3a5f"),
                hovertext=hover,
                hoverlabel=dict(bgcolor="#ffffff", bordercolor="#1f3a5f"),
                align="center",
                xanchor="center", yanchor="middle",
            )
        )

    if empty_message:
        annotations.append(
            dict(
                x=0.5, y=0.5, xref="paper", yref="paper",
                text=empty_message,
                showarrow=False,
                font=dict(family="Inter, sans-serif", size=15, color="#7a7a7a"),
                align="center",
                xanchor="center", yanchor="middle",
            )
        )

    if footnote:
        annotations.append(
            dict(
                x=0.5, y=-0.18, xref="paper", yref="paper",
                text=f"<i>{footnote}</i>",
                showarrow=False,
                font=dict(family="Inter, sans-serif", size=11, color="#7a7a7a"),
                align="center",
                xanchor="center", yanchor="top",
            )
        )

    title_text = measure_id if measure_id else "Pick a measure to begin"
    if title_suffix:
        title_text = f"{title_text}  <span style='color:#9aa1aa;font-weight:400'>{title_suffix}</span>"

    fig.update_layout(
        title=dict(
            text=title_text,
            x=0.0, xanchor="left",
            font=dict(family="Inter, sans-serif", size=18, color="#1f3a5f"),
            pad=dict(l=8, b=4),
        ),
        margin=dict(l=90, r=24, t=64, b=64),
        xaxis=dict(
            title=dict(text="Year", font=dict(family="Inter, sans-serif", size=13, color="#444")),
            tickmode="array",
            tickvals=list(x_range),
            ticktext=[str(y) for y in x_range],
            showgrid=True,
            gridcolor="#eef0f2",
            zeroline=False,
            ticks="outside",
            tickcolor="#cccccc",
            linecolor="#cccccc",
        ),
        yaxis=dict(
            title=None,  # rendered via annotation above
            showgrid=True,
            gridcolor="#eef0f2",
            zeroline=False,
            ticks="outside",
            tickcolor="#cccccc",
            linecolor="#cccccc",
            tickfont=dict(family="Inter, sans-serif", size=12, color="#444"),
        ),
        legend=dict(
            orientation="v",
            yanchor="top", y=1,
            xanchor="left", x=1.02,
            bgcolor="rgba(255,255,255,0)",
            bordercolor="#e6e6e6",
            font=dict(family="Inter, sans-serif", size=12, color="#222"),
            itemsizing="constant",
        ),
        plot_bgcolor="#ffffff",
        paper_bgcolor="#ffffff",
        hoverlabel=dict(
            bgcolor="#ffffff", bordercolor="#1f3a5f",
            font=dict(family="Inter, sans-serif", size=12, color="#222"),
        ),
        annotations=annotations,
    )


def build_export_figure(fig: go.Figure) -> go.Figure:
    """Return a copy of the figure with publication-grade typography & line widths."""
    if fig is None:
        return go.Figure()
    f = go.Figure(fig)
    # Bump traces.
    for tr in f.data:
        if hasattr(tr, "line") and tr.line is not None:
            try:
                tr.line.width = max((tr.line.width or 2.25) * 1.4, 3)
            except Exception:
                pass
        if hasattr(tr, "marker") and tr.marker is not None:
            try:
                tr.marker.size = max((tr.marker.size or 8) * 1.3, 11)
            except Exception:
                pass
    # Bump fonts.
    f.update_layout(
        font=dict(family="Inter, Helvetica, Arial, sans-serif", size=15, color="#222"),
        title=dict(font=dict(size=22, color="#1f3a5f")),
        legend=dict(font=dict(size=14)),
        margin=dict(l=110, r=40, t=80, b=80),
    )
    f.update_xaxes(title=dict(font=dict(size=16, color="#222")), tickfont=dict(size=13, color="#222"))
    f.update_yaxes(tickfont=dict(size=13, color="#222"))
    # Re-position the y-axis annotation if present so it doesn't collide with the wider margin.
    new_anns = []
    for a in f.layout.annotations or []:
        a = a.to_plotly_json()
        if a.get("textangle") == -90:
            a["x"] = -0.085
            a["font"] = dict(family="IBM Plex Mono, monospace", size=18, color="#1f3a5f")
        new_anns.append(a)
    f.update_layout(annotations=new_anns)
    return f


__all__ = ["build_figure", "build_export_figure"]
