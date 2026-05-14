import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartCard } from '@/components/cards/ChartCard';
import { ChartBottomLegend, type ChartLegendItem } from '@/components/charts/ChartBottomLegend';
import { CHART_SERIES_PALETTE } from '@/lib/chartPalette';
import { slugKey } from '@/lib/seriesTransforms';
import type { SeriesRow } from '@/types/metric';

function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function xExtentFromRows(data: Record<string, unknown>[], keys: string[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of data) {
    for (const k of keys) {
      const v = row[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) {
    const pad = Math.max(Math.abs(lo) * 0.04, 0.02);
    return [Math.max(0, lo - pad), hi + pad];
  }
  const span = hi - lo;
  const pad = Math.max(span * 0.06, span * 0.01);
  return [Math.max(0, lo - pad), hi + pad];
}

type BarTipProps = {
  active?: boolean;
  label?: string;
  payload?: ReadonlyArray<{ name?: string; value?: number | string | null; color?: string }>;
};

function BarTooltip({ active, payload, label }: BarTipProps) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => typeof p.value === 'number' && Number.isFinite(p.value));
  if (!rows.length) return null;
  return (
    <div
      className="max-w-[min(100vw-2rem,22rem)] rounded-xl border px-3 py-2.5 shadow-lg"
      style={{
        background: 'var(--color-panel-solid)',
        borderColor: 'var(--color-accent-cyan)',
        boxShadow: '0 8px 28px var(--color-map-glow)',
      }}
    >
      <p className="text-[11px] font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
        Year {label}
      </p>
      <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {rows.map((row) => (
          <div key={`${row.name}`} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium" style={{ color: row.color }}>
              {row.name}
            </span>
            <span className="shrink-0 font-mono tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {Number(row.value).toFixed(3)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

type Props = {
  rows: SeriesRow[];
  title?: string;
  subtitle?: string;
  chartFooter?: string | null;
  focusedSeriesKey?: string | null;
  onToggleLegendSeries?: (seriesKey: string) => void;
  fillHeight?: boolean;
  /** When set, only these reporting years appear (same `yearLabel` strings as the trend pivot). */
  visibleYearLabels?: readonly string[] | null;
  /** When true, omit the built-in legend (parent renders a shared legend). */
  hideLegend?: boolean;
  /** Bar / legend color per series key (slug); falls back to the shared palette when absent. */
  seriesColors?: Record<string, string> | null;
};

/** Exclude national aggregate from facility-focused volume comparison. */
function filterHospitalSeries(rows: SeriesRow[]): SeriesRow[] {
  return rows.filter((r) => r.entity_value !== '__NATIONAL__');
}

export function LatestValueBarCard({
  rows,
  title = 'Latest values',
  subtitle,
  chartFooter = null,
  focusedSeriesKey = null,
  onToggleLegendSeries,
  fillHeight = false,
  visibleYearLabels = null,
  hideLegend = false,
  seriesColors = null,
}: Props) {
  const hospitalRows = useMemo(() => filterHospitalSeries(rows), [rows]);

  const byYearData = useMemo(() => {
    let years = [...new Set(hospitalRows.map((r) => r.year))].sort((a, b) => a - b);
    if (visibleYearLabels?.length) {
      const want = new Set(visibleYearLabels.map(String));
      years = years.filter((y) => want.has(String(y)));
      const order = new Map(visibleYearLabels.map((yl, i) => [String(yl), i]));
      years.sort((a, b) => (order.get(String(a)) ?? 0) - (order.get(String(b)) ?? 0));
    }
    const pairs = new Map<string, { label: string; entity_value: string }>();
    for (const r of hospitalRows) {
      const composite = `${r.entity_value}\u0000${r.label}`;
      if (!pairs.has(composite)) pairs.set(composite, { label: r.label, entity_value: r.entity_value });
    }
    const seriesMeta = [...pairs.values()].map(({ label, entity_value }) => ({
      key: slugKey(label, entity_value),
      label,
      entity_value,
      shortLabel: truncateLabel(label, 28),
    }));

    const data = years.map((year) => {
      const row: Record<string, number | string | null> = { yearLabel: String(year) };
      for (const series of seriesMeta) {
        const point = hospitalRows.find(
          (r) => r.year === year && r.label === series.label && r.entity_value === series.entity_value,
        );
        row[series.key] = point?.value ?? null;
      }
      return row;
    });

    const legendItems: ChartLegendItem[] = seriesMeta.map((s, i) => ({
      key: s.key,
      label: s.label,
      color: seriesColors?.[s.key] ?? CHART_SERIES_PALETTE[i % CHART_SERIES_PALETTE.length],
    }));

    return { data, seriesMeta, legendItems };
  }, [hospitalRows, visibleYearLabels, seriesColors]);

  const valueKeys = useMemo(() => byYearData.seriesMeta.map((s) => s.key), [byYearData.seriesMeta]);
  const xDomain = useMemo(() => xExtentFromRows(byYearData.data, valueKeys), [byYearData.data, valueKeys]);

  const barKeysSet = useMemo(() => new Set(byYearData.seriesMeta.map((s) => s.key)), [byYearData.seriesMeta]);
  const focusHitsBars = focusedSeriesKey != null && barKeysSet.has(focusedSeriesKey);

  const nSeries = byYearData.seriesMeta.length;
  const nYears = byYearData.data.length;
  const maxBarSize = Math.max(20, Math.min(52, Math.floor(240 / Math.max(1, nSeries * 0.62))));
  const barCategoryGapPct = nYears <= 2 ? '8%' : nSeries >= 6 ? '12%' : '14%';
  const barGapPx = nSeries >= 6 ? 2 : 4;

  if (!hospitalRows.length) {
    return (
      <ChartCard title={title} subtitle={subtitle} fillHeight={fillHeight}>
        <div
          className="flex h-56 items-center justify-center rounded-xl border text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}
        >
          No data — run analysis with at least one location.
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      fillHeight={fillHeight}
      footer={chartFooter ? <span style={{ color: 'var(--color-text-tertiary)' }}>{chartFooter}</span> : undefined}
    >
      <div
        className={
          fillHeight
            ? 'min-h-0 w-full min-w-0 flex-1'
            : 'min-h-[200px] w-full'
        }
        style={
          fillHeight
            ? undefined
            : {
                height: Math.min(
                  620,
                  Math.max(
                    260,
                    140 + byYearData.data.length * (40 + Math.max(1, byYearData.seriesMeta.length) * 6),
                  ),
                ),
              }
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={byYearData.data}
            margin={{ top: 8, right: 16, left: 4, bottom: 8 }}
            barCategoryGap={barCategoryGapPct}
            barGap={barGapPx}
            style={{ cursor: 'default' }}
          >
            <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="4 4" vertical={false} />
            <XAxis
              type="number"
              domain={xDomain}
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => {
                const n = Number(v);
                if (!Number.isFinite(n)) return '';
                return n.toFixed(3);
              }}
            />
            <YAxis
              type="category"
              dataKey="yearLabel"
              tick={{ fill: 'var(--color-text-secondary)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              content={<BarTooltip />}
              cursor={{ fill: 'var(--color-chart-cursor)' }}
              wrapperStyle={{ outline: 'none' }}
            />
            {byYearData.seriesMeta.map((series, i) => {
              const fill = seriesColors?.[series.key] ?? CHART_SERIES_PALETTE[i % CHART_SERIES_PALETTE.length];
              let fillOpacity = 1;
              if (focusedSeriesKey != null) {
                fillOpacity = focusHitsBars ? (series.key === focusedSeriesKey ? 1 : 0.28) : 0.28;
              }
              return (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  name={series.shortLabel}
                  fill={fill}
                  fillOpacity={fillOpacity}
                  maxBarSize={maxBarSize}
                  radius={[0, 3, 3, 0]}
                  isAnimationActive={false}
                />
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {!hideLegend ? (
        <div className="shrink-0">
          <ChartBottomLegend
            items={byYearData.legendItems}
            focusedKey={focusedSeriesKey}
            onToggleFocus={onToggleLegendSeries}
          />
        </div>
      ) : null}
    </ChartCard>
  );
}
