import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChartSeriesControls } from '@/components/dashboard/ChartSeriesControls';
import { LatestValueBarCard } from '@/components/charts/LatestValueBarCard';
import { ChartBottomLegend } from '@/components/charts/ChartBottomLegend';
import { TrendLineCard } from '@/components/charts/TrendLineCard';
import { planToLocationTokens } from '@/features/research/useResearchSession';
import {
  chartEvidenceSubtitle,
  displayStateName,
  humanGeographySummary,
  measureTabLabel,
  orderMeasuresForTabs,
  promptLinkCaption,
} from '@/lib/researchDisplay';
import {
  pickSeriesRowsForChartSort,
  type ChartSeriesSortColumn,
  type ChartSeriesSortOrder,
} from '@/lib/chartSeriesSelection';
import { slicePivotByIndex } from '@/lib/chartTimeRange';
import { buildSeriesSwatchesForPivotKeys } from '@/lib/chartPalette';
import { maxDistinctYearsPerSeries, pivotForLine } from '@/lib/seriesTransforms';
import { hasLiveApi, useMockDemo } from '@/services/api';
import { fetchVolumeSibling } from '@/services/metaVolume';
import type { ResearchPlanModel, ResearchRetrieveResult } from '@/services/researchApi';
import type { SeriesRow } from '@/types/metric';
import { useMetricSeries } from '@/hooks/useMetricSeries';

type Props = {
  plan: ResearchPlanModel | null;
  retrieval: ResearchRetrieveResult | null;
  userQuestion?: string;
  measureTitles?: Record<string, string>;
  locationLabels?: Record<string, string>;
};

function locationTokensForActiveMeasure(
  plan: ResearchPlanModel,
  retrieval: ResearchRetrieveResult | null,
  measureId: string,
): string[] {
  const ev = retrieval?.metric_evidence?.find((e) => e.measure_id === measureId);
  const toks = ev?.location_tokens?.filter((t): t is string => typeof t === 'string' && t.length > 0);
  if (toks?.length) return toks;
  return planToLocationTokens(plan);
}

export function ResultsCanvas({
  plan,
  retrieval,
  userQuestion = '',
  measureTitles = {},
  locationLabels = {},
}: Props) {
  const measureIdsOrdered = useMemo(() => {
    if (!plan?.measure_ids.length) return [] as string[];
    if (!retrieval?.series_by_measure) return plan.measure_ids;
    const filtered = plan.measure_ids.filter((m) => m in retrieval.series_by_measure);
    return orderMeasuresForTabs(filtered, plan, measureTitles);
  }, [plan, retrieval, measureTitles]);

  const [tab, setTab] = useState<string | null>(null);
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null);
  const [chartSortColumn, setChartSortColumn] = useState<ChartSeriesSortColumn>('lastValue');
  const [chartSortOrder, setChartSortOrder] = useState<ChartSeriesSortOrder>('best');
  const [chartTopK, setChartTopK] = useState<number | 'all'>(8);

  const onToggleLegendSeries = useCallback((key: string) => {
    setFocusedSeriesKey((prev) => (prev === key ? null : key));
  }, []);

  useEffect(() => {
    setTab((prev) => {
      if (!measureIdsOrdered.length) return null;
      if (prev && measureIdsOrdered.includes(prev)) return prev;
      return measureIdsOrdered[0] ?? null;
    });
  }, [measureIdsOrdered]);

  const active = tab && measureIdsOrdered.includes(tab) ? tab : measureIdsOrdered[0] ?? null;

  useEffect(() => {
    setFocusedSeriesKey(null);
    setChartSortColumn('lastValue');
    setChartSortOrder('best');
    setChartTopK(8);
  }, [active]);

  const rowsForActive = useMemo(() => {
    if (!active || !retrieval?.series_by_measure?.[active]) return [] as SeriesRow[];
    return (retrieval.series_by_measure[active].rows ?? []) as SeriesRow[];
  }, [active, retrieval]);

  const locTokens = useMemo(() => {
    if (!plan || !active) return [] as string[];
    return locationTokensForActiveMeasure(plan, retrieval, active);
  }, [plan, retrieval, active]);

  const includeNational = plan?.include_national ?? true;
  const mockDemo = useMockDemo();
  const live = hasLiveApi();

  const volumeMetaQ = useQuery({
    queryKey: ['research-meta', 'volume-sibling', active],
    queryFn: () => fetchVolumeSibling(active!),
    enabled: Boolean(active) && (mockDemo || live),
    staleTime: 300_000,
  });

  const volumeId = volumeMetaQ.data?.volume_measure_id ?? '';
  const hasVolumeSibling = Boolean(volumeMetaQ.data?.has_volume && volumeId);

  const volumeSeriesQ = useMetricSeries(volumeId || undefined, locTokens, includeNational, {
    enabled: Boolean(active && volumeId && hasVolumeSibling && (mockDemo || live)),
  });

  const volRows =
    volumeId && volumeSeriesQ.data?.measure_id === volumeId ? (volumeSeriesQ.data.rows ?? []) : ([] as SeriesRow[]);

  const hasVolumeBars = Boolean(hasVolumeSibling && volRows.length > 0);

  const interpretationForActive = useMemo(() => {
    if (!active || !retrieval?.metric_evidence?.length) return '';
    return retrieval.metric_evidence.find((e) => e.measure_id === active)?.interpretation ?? '';
  }, [active, retrieval]);

  const interpretationForVolume = useMemo(() => {
    if (!volumeId || !retrieval?.metric_evidence?.length) return '';
    return retrieval.metric_evidence.find((e) => e.measure_id === volumeId)?.interpretation ?? '';
  }, [volumeId, retrieval]);

  const chartLimitForPick = chartTopK === 'all' ? Number.POSITIVE_INFINITY : chartTopK;

  const trendResearchPick = useMemo(
    () =>
      active
        ? pickSeriesRowsForChartSort(rowsForActive, {
            sortColumn: chartSortColumn,
            order: chartSortOrder,
            limit: chartLimitForPick,
            interpretation: interpretationForActive,
            includeAggregates: true,
          })
        : { rows: [] as SeriesRow[], totalHospitalSeries: 0, capped: false, summary: '' },
    [active, rowsForActive, chartSortColumn, chartSortOrder, chartLimitForPick, interpretationForActive],
  );

  const volumeResearchPick = useMemo(
    () =>
      active && volRows.length
        ? pickSeriesRowsForChartSort(volRows, {
            sortColumn: chartSortColumn,
            order: chartSortOrder,
            limit: chartLimitForPick,
            interpretation: interpretationForVolume || interpretationForActive,
            preferHigherLatest: true,
            includeAggregates: false,
          })
        : { rows: [] as SeriesRow[], totalHospitalSeries: 0, capped: false, summary: '' },
    [
      active,
      volRows,
      chartSortColumn,
      chartSortOrder,
      chartLimitForPick,
      interpretationForVolume,
      interpretationForActive,
    ],
  );

  const latestOnlyPick = useMemo(
    () =>
      active && rowsForActive.length && !hasVolumeBars
        ? pickSeriesRowsForChartSort(rowsForActive, {
            sortColumn: chartSortColumn,
            order: chartSortOrder,
            limit: chartLimitForPick,
            interpretation: interpretationForActive,
            includeAggregates: true,
          })
        : { rows: [] as SeriesRow[], totalHospitalSeries: 0, capped: false, summary: '' },
    [active, rowsForActive, hasVolumeBars, chartSortColumn, chartSortOrder, chartLimitForPick, interpretationForActive],
  );

  const multiYear = useMemo(
    () =>
      trendResearchPick.rows.length ? maxDistinctYearsPerSeries(trendResearchPick.rows) > 1 : false,
    [trendResearchPick.rows],
  );

  const trendPivotForBrush = useMemo(() => {
    if (!trendResearchPick.rows.length) return null;
    const y = maxDistinctYearsPerSeries(trendResearchPick.rows);
    if (y <= 1) return null;
    const p = pivotForLine(trendResearchPick.rows);
    return { data: p.data, keys: p.keys };
  }, [trendResearchPick.rows]);

  const { colorByKey: seriesColorByKey, legendItems: sharedTrendVolumeLegendItems } = useMemo(() => {
    if (!trendPivotForBrush) return { colorByKey: {} as Record<string, string>, legendItems: [] as { key: string; label: string; color: string }[] };
    return buildSeriesSwatchesForPivotKeys(trendPivotForBrush.keys);
  }, [trendPivotForBrush]);

  const sharedTrendVolumeLegend = Boolean(hasVolumeBars && trendPivotForBrush);

  const [trendYearBrushIdx, setTrendYearBrushIdx] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!sharedTrendVolumeLegend || !trendPivotForBrush) {
      setTrendYearBrushIdx(null);
      return;
    }
    const last = Math.max(0, trendPivotForBrush.data.length - 1);
    setTrendYearBrushIdx({ start: 0, end: last });
  }, [sharedTrendVolumeLegend, trendPivotForBrush]);

  const handleTrendYearBrush = useCallback((start: number, end: number) => {
    setTrendYearBrushIdx({ start, end });
  }, []);

  const visibleVolumeYearLabels = useMemo(() => {
    if (!sharedTrendVolumeLegend || !trendPivotForBrush) return undefined as string[] | undefined;
    const last = Math.max(0, trendPivotForBrush.data.length - 1);
    const b = trendYearBrushIdx ?? { start: 0, end: last };
    const lo = Math.max(0, Math.min(b.start, last));
    const hi = Math.max(lo, Math.min(b.end, last));
    return slicePivotByIndex(trendPivotForBrush.data, lo, hi).map((r) => String(r.yearLabel));
  }, [sharedTrendVolumeLegend, trendPivotForBrush, trendYearBrushIdx]);

  const geoLine = plan ? humanGeographySummary(plan, locationLabels) : '';

  if (!plan) {
    return (
      <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
        Results appear here: resolved geography, metric bundle, charts, and a grounded summary.
      </p>
    );
  }

  const linkCaption = promptLinkCaption(plan, userQuestion);
  const evidenceSub = chartEvidenceSubtitle(plan);
  const trendSubtitle = multiYear ? measureTabLabel(active ?? '', measureTitles) : evidenceSub;

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        {linkCaption}
      </p>

      <div>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent-cyan)' }}>
          Geography
        </span>
        <div className="mt-1 flex flex-wrap gap-2">
          {plan.states.map((s) => (
            <span
              key={s}
              className="rounded-full border px-2 py-0.5 text-xs"
              style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-panel-alt)' }}
              title={String(s).trim().toUpperCase().slice(0, 2)}
            >
              {displayStateName(s)}
            </span>
          ))}
          {plan.hospital_tokens.map((h) => (
            <span
              key={h}
              className="rounded-full border px-2 py-0.5 text-xs"
              style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-panel-alt)' }}
              title={h}
            >
              {locationLabels[h] ?? h}
            </span>
          ))}
        </div>
        <p className="mt-1 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          Scope: {geoLine}
        </p>
      </div>

      <div>
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent-cyan)' }}>
          Measures in this run
        </span>
        <div className="mt-1 flex flex-wrap gap-2">
          {plan.measure_ids.map((m) => (
            <span
              key={m}
              className="rounded-full border px-2 py-0.5 text-xs"
              style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-panel-alt)' }}
              title={m}
            >
              {measureTitles[m] ?? m}
            </span>
          ))}
        </div>
      </div>

      {retrieval?.validation_warnings?.length ? (
        <ul className="list-inside list-disc text-left text-xs" style={{ color: 'var(--color-accent-warning)' }}>
          {retrieval.validation_warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {measureIdsOrdered.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
            Chart bundle by measure
          </p>
          <div className="mt-2 flex flex-wrap gap-1 border-b pb-2" style={{ borderColor: 'var(--color-border)' }}>
            {measureIdsOrdered.map((mid) => (
              <button
                key={mid}
                type="button"
                onClick={() => setTab(mid)}
                className="max-w-[220px] truncate rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{
                  background: active === mid ? 'var(--color-accent-blue)' : 'var(--color-panel-alt)',
                  color: active === mid ? '#fff' : 'var(--color-text-secondary)',
                }}
                title={mid}
              >
                {measureTabLabel(mid, measureTitles)}
              </button>
            ))}
          </div>
          <div className="mt-4 min-h-0 space-y-4">
            {rowsForActive.length > 0 && active ? (
              <>
                <ChartSeriesControls
                  sortColumn={chartSortColumn}
                  onSortColumnChange={setChartSortColumn}
                  order={chartSortOrder}
                  onOrderChange={setChartSortOrder}
                  topK={chartTopK}
                  onTopKChange={setChartTopK}
                  restrictToRanking={false}
                  onRestrictToRankingChange={() => {}}
                  rankingDisabled
                  rankingSortLabel="N/A"
                  selectedState={String(plan.states[0] ?? '')
                    .trim()
                    .toUpperCase()
                    .slice(0, 2) || '—'}
                />
                <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  Same table-style columns as the dashboard; ranking shortlist is not used in research results.
                </p>
                <div className={`grid gap-4 ${hasVolumeBars ? 'lg:grid-cols-2' : ''}`}>
                  <div className={hasVolumeBars ? '' : 'lg:col-span-2'}>
                    <TrendLineCard
                      rows={trendResearchPick.rows}
                      title={`${measureTabLabel(active, measureTitles)} — trend`}
                      subtitle={multiYear ? trendSubtitle : 'Multi-year history required for the area trend view.'}
                      chartFooter={trendResearchPick.summary}
                      focusedSeriesKey={focusedSeriesKey}
                      onToggleLegendSeries={onToggleLegendSeries}
                      fillHeight={hasVolumeBars}
                      hideLegend={sharedTrendVolumeLegend}
                      seriesColors={sharedTrendVolumeLegend ? seriesColorByKey : null}
                      onYearIndexRangeChange={sharedTrendVolumeLegend ? handleTrendYearBrush : undefined}
                    />
                  </div>
                  {hasVolumeBars ? (
                    <LatestValueBarCard
                      rows={volumeResearchPick.rows}
                      title="Volume"
                      subtitle={`Horizontal grouped by facility · ${volumeId}`}
                      chartFooter={`${volumeResearchPick.summary} Grouped by facility within each reporting year.`}
                      focusedSeriesKey={focusedSeriesKey}
                      onToggleLegendSeries={onToggleLegendSeries}
                      fillHeight={hasVolumeBars}
                      hideLegend={sharedTrendVolumeLegend}
                      seriesColors={sharedTrendVolumeLegend ? seriesColorByKey : null}
                      visibleYearLabels={visibleVolumeYearLabels}
                    />
                  ) : null}
                </div>
                {sharedTrendVolumeLegend ? (
                  <ChartBottomLegend
                    items={sharedTrendVolumeLegendItems}
                    focusedKey={focusedSeriesKey}
                    onToggleFocus={onToggleLegendSeries}
                  />
                ) : null}
                {!hasVolumeBars ? (
                  <LatestValueBarCard
                    rows={latestOnlyPick.rows}
                    title="Latest values"
                    subtitle={evidenceSub}
                    chartFooter={latestOnlyPick.summary}
                    focusedSeriesKey={focusedSeriesKey}
                    onToggleLegendSeries={onToggleLegendSeries}
                  />
                ) : null}
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                No chartable rows for {active} in this retrieval.
              </p>
            )}
          </div>
        </div>
      ) : retrieval ? (
        <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
          No series blocks returned for the planned measures yet.
        </p>
      ) : null}
    </div>
  );
}
