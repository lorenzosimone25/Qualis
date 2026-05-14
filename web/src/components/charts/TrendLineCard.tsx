import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard } from '@/components/cards/ChartCard';
import { ChartBottomLegend, type ChartLegendItem } from '@/components/charts/ChartBottomLegend';
import { navigatorSeriesFromPivot, slicePivotByIndex } from '@/lib/chartTimeRange';
import { CHART_SERIES_PALETTE } from '@/lib/chartPalette';
import { maxDistinctYearsPerSeries, pivotForLine } from '@/lib/seriesTransforms';
import type { SeriesRow } from '@/types/metric';

const tooltipStyle = {
  background: 'var(--color-panel-solid)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 12,
  fontSize: 12,
  color: 'var(--color-text-primary)',
};

function yExtentFromPivot(
  rows: Record<string, number | string | null>[],
  keyNames: string[],
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of rows) {
    for (const k of keyNames) {
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
    return [lo - pad, hi + pad];
  }
  const span = hi - lo;
  const pad = Math.max(span * 0.06, span * 0.01);
  return [lo - pad, hi + pad];
}

type TooltipProps = {
  active?: boolean;
  label?: string;
  payload?: { dataKey?: string | number; name?: string; value?: number | string; color?: string }[];
};

function TrendTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const rows = [...payload].filter((p) => p.value != null && p.value !== '');
  if (!rows.length) return null;
  return (
    <div
      className="max-w-[min(100vw-2rem,20rem)] rounded-xl border px-3 py-2.5 shadow-lg"
      style={{
        ...tooltipStyle,
        borderColor: 'var(--color-accent-cyan)',
        boxShadow: '0 8px 28px var(--color-map-glow)',
      }}
    >
      <div className="mb-2 border-b pb-2 text-xs font-semibold" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
        Year {label}
      </div>
      <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
        {rows.map((p) => (
          <div key={String(p.dataKey)} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium" style={{ color: p.color }}>
              {p.name}
            </span>
            <span className="shrink-0 font-mono tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {typeof p.value === 'number' ? p.value.toFixed(3) : String(p.value)}
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
  /** Footer line from parent (e.g. how many facilities shown and sort rule). */
  chartFooter?: string | null;
  /** When set, other series render dimmed. Click legend to toggle (via `onToggleLegendSeries`). */
  focusedSeriesKey?: string | null;
  /** Called when a legend entry is clicked; parent toggles focus (same key clears). */
  onToggleLegendSeries?: (seriesKey: string) => void;
  /** Match sibling chart card height in dashboard two-column layout. */
  fillHeight?: boolean;
  /** Inclusive index range over `pivotForLine(rows).data` (same order as brush / year rows). */
  onYearIndexRangeChange?: (startIndex: number, endIndex: number) => void;
  /** When true, omit the built-in legend (e.g. parent renders one shared legend for trend + volume). */
  hideLegend?: boolean;
  /** Optional stroke color per pivot series key (e.g. shared with volume bars). */
  seriesColors?: Record<string, string> | null;
};

export function TrendLineCard({
  rows,
  title = 'Trend by year',
  subtitle,
  chartFooter = null,
  focusedSeriesKey = null,
  onToggleLegendSeries,
  fillHeight = false,
  onYearIndexRangeChange,
  hideLegend = false,
  seriesColors = null,
}: Props) {
  type PivotPack = {
    fullData: Record<string, number | string | null>[];
    keys: { key: string; label: string; entity_value: string }[];
  };

  const pivotPack = useMemo((): PivotPack | null => {
    const y = maxDistinctYearsPerSeries(rows);
    if (!rows.length || y <= 1) return null;
    const { data, keys } = pivotForLine(rows);
    return { fullData: data, keys };
  }, [rows]);

  const [startIndex, setStartIndex] = useState(0);
  const [endIndex, setEndIndex] = useState(0);

  const keyNames = useMemo(() => (pivotPack ? pivotPack.keys.map((k) => k.key) : []), [pivotPack]);
  const navData = useMemo(() => {
    if (!pivotPack) return [] as { yearLabel: string; __nav: number | null }[];
    return navigatorSeriesFromPivot(pivotPack.fullData, keyNames);
  }, [pivotPack, keyNames]);

  const dataSig = useMemo(() => {
    if (!pivotPack) return '';
    return pivotPack.keys.map((k) => k.key).join('|') + pivotPack.fullData.length;
  }, [pivotPack]);

  const fullData = pivotPack?.fullData ?? [];
  const lastIdx = Math.max(0, fullData.length - 1);

  useEffect(() => {
    if (!pivotPack) return;
    setStartIndex(0);
    setEndIndex(Math.max(0, pivotPack.fullData.length - 1));
  }, [dataSig, pivotPack]);

  const safeStart = pivotPack ? Math.max(0, Math.min(startIndex, lastIdx)) : 0;
  const safeEnd = pivotPack ? Math.max(safeStart, Math.min(endIndex, lastIdx)) : 0;

  useEffect(() => {
    if (!pivotPack) return;
    onYearIndexRangeChange?.(safeStart, safeEnd);
  }, [pivotPack, safeStart, safeEnd, onYearIndexRangeChange]);

  const visibleData = useMemo(() => {
    if (!pivotPack) return [];
    return slicePivotByIndex(pivotPack.fullData, safeStart, safeEnd);
  }, [pivotPack, safeStart, safeEnd]);

  const yDomain = useMemo(() => yExtentFromPivot(visibleData, keyNames), [visibleData, keyNames]);

  const lineLegend = useMemo(() => {
    if (!pivotPack)
      return {
        lineItems: [] as { key: string; label: string; entity_value: string; color: string; isNat: boolean }[],
        legendItems: [] as ChartLegendItem[],
      };
    let pal = 0;
    const lineItems: { key: string; label: string; entity_value: string; color: string; isNat: boolean }[] = [];
    const legendItems: ChartLegendItem[] = [];
    for (const k of pivotPack.keys) {
      const isNat = k.entity_value === '__NATIONAL__';
      const fromParent = seriesColors?.[k.key];
      let color: string;
      if (fromParent) color = fromParent;
      else if (isNat) color = 'var(--color-chart-national-stroke)';
      else color = CHART_SERIES_PALETTE[pal++ % CHART_SERIES_PALETTE.length];
      lineItems.push({ ...k, color, isNat });
      legendItems.push({ key: k.key, label: k.label, color });
    }
    return { lineItems, legendItems };
  }, [pivotPack, seriesColors]);

  const onBrushChange = useCallback((e: { startIndex?: number; endIndex?: number }) => {
    if (e.startIndex != null) setStartIndex(e.startIndex);
    if (e.endIndex != null) setEndIndex(e.endIndex);
  }, []);

  const resetRange = useCallback(() => {
    setStartIndex(0);
    setEndIndex(lastIdx);
    onYearIndexRangeChange?.(0, lastIdx);
  }, [lastIdx, onYearIndexRangeChange]);

  if (!pivotPack) {
    return (
      <ChartCard title={title} subtitle={subtitle} fillHeight={fillHeight}>
        <div
          className="flex h-56 items-center justify-center rounded-xl border text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}
        >
          {rows.length === 0
            ? 'No data — run analysis with at least one location.'
            : 'Trend view needs multiple reporting years for the selected series.'}
        </div>
      </ChartCard>
    );
  }

  const { lineItems, legendItems } = lineLegend;

  const yearLo = visibleData[0]?.yearLabel;
  const yearHi = visibleData[visibleData.length - 1]?.yearLabel;
  const fullRange = `${fullData[0]?.yearLabel}–${fullData[fullData.length - 1]?.yearLabel}`;
  const isFiltered = safeStart > 0 || safeEnd < lastIdx;

  const markerFill = 'var(--color-chart-marker-fill)';

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      fillHeight={fillHeight}
      footer={
        chartFooter ? (
          <span style={{ color: 'var(--color-text-tertiary)' }}>{chartFooter}</span>
        ) : undefined
      }
    >
      <div className="mb-2 shrink-0 flex flex-wrap items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <span>
          Years shown: <span style={{ color: 'var(--color-text-secondary)' }}>{yearLo}–{yearHi}</span>
          {isFiltered ? (
            <span className="ml-1 opacity-80">(full {fullRange})</span>
          ) : null}
        </span>
        {isFiltered ? (
          <button
            type="button"
            onClick={resetRange}
            className="rounded-lg border px-2 py-1 text-[11px] font-medium transition-opacity hover:opacity-90"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-accent-cyan)' }}
          >
            Reset range
          </button>
        ) : null}
      </div>

      <div
        className={
          fillHeight
            ? 'min-h-0 w-full min-w-0 flex-1'
            : 'h-[min(22rem,calc(50vh+4rem))] min-h-[14rem] w-full'
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visibleData} margin={{ top: 6, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--color-chart-grid)" strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="yearLabel"
              tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={yDomain}
              tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v) => {
                const n = Number(v);
                if (!Number.isFinite(n)) return '';
                return n.toFixed(3);
              }}
            />
            <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--color-accent-cyan)', strokeWidth: 1, strokeDasharray: '4 4' }} />
            {lineItems.map(({ key, label, color, isNat }) => {
              const dim =
                focusedSeriesKey != null && key !== focusedSeriesKey ? { strokeOpacity: 0.28 } : { strokeOpacity: 1 };
              const strokeW =
                focusedSeriesKey != null && key !== focusedSeriesKey ? (isNat ? 1.35 : 1.65) : isNat ? 2.1 : 2.85;
              return (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={color}
                strokeWidth={strokeW}
                {...dim}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={isNat ? '5 4' : undefined}
                dot={{
                  r: 3,
                  strokeWidth: 2,
                  stroke: color,
                  fill: markerFill,
                }}
                activeDot={{ r: 5, strokeWidth: 2, stroke: color, fill: markerFill }}
                isAnimationActive={false}
                connectNulls
              />
            );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {!hideLegend ? (
        <div className="shrink-0">
          <ChartBottomLegend
            items={legendItems}
            focusedKey={focusedSeriesKey}
            onToggleFocus={onToggleLegendSeries}
          />
        </div>
      ) : null}

      <p className="mb-1 mt-2 shrink-0 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Drag the handles below to focus a reporting window. Y-axis rescales to the visible years.
      </p>
      <div className="h-20 w-full shrink-0 select-none">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={navData} margin={{ top: 2, right: 8, left: 0, bottom: 2 }} syncId="trendBrush">
            <XAxis dataKey="yearLabel" hide tick={{ fontSize: 10 }} />
            <YAxis hide domain={['auto', 'auto']} />
            <Line type="monotone" dataKey="__nav" stroke="var(--color-accent-blue)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Brush
              dataKey="yearLabel"
              height={22}
              stroke="var(--color-border-strong)"
              fill="var(--color-panel-alt)"
              travellerWidth={9}
              startIndex={safeStart}
              endIndex={safeEnd}
              onChange={onBrushChange}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
