import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LatestValueBarCard } from '@/components/charts/LatestValueBarCard';
import { ChartBottomLegend } from '@/components/charts/ChartBottomLegend';
import { TrendLineCard } from '@/components/charts/TrendLineCard';

import { ChartSeriesControls } from '@/components/dashboard/ChartSeriesControls';
import { DataSummary } from '@/components/dashboard/DataSummary';
import { HospitalTable } from '@/components/dashboard/HospitalTable';

import { PromptBar } from '@/components/search/PromptBar';

import { TopToolbar } from '@/components/layout/TopToolbar';

import { BRANDING } from '@/config/branding';

import { useDashboardUi } from '@/context/DashboardUiContext';
import { filterSeriesRowsForRankingLens } from '@/lib/chartRankingLens';
import {
  pickSeriesRowsForChartSort,
  type ChartSeriesSortColumn,
  type ChartSeriesSortOrder,
} from '@/lib/chartSeriesSelection';

import { useMetricSeries } from '@/hooks/useMetricSeries';

import { slicePivotByIndex } from '@/lib/chartTimeRange';
import { buildSeriesSwatchesForPivotKeys } from '@/lib/chartPalette';
import { maxDistinctYearsPerSeries, pivotForLine } from '@/lib/seriesTransforms';

import { hasLiveApi, useMockDemo } from '@/services/api';

import { fetchMetricSeries } from '@/services/metricSeries';

import { fetchVolumeSibling } from '@/services/metaVolume';

import { MAX_H_TOKENS } from '@/lib/dashboardConstants';

import { fetchHospitalRankings, type HospitalRankingSort } from '@/services/rankings';

import { MOCK_METRICS } from '@/services/mock/fixtures';

import type { LocationOption } from '@/types/hospital';

import type { MetricSearchHit } from '@/types/metric';



export function DashboardPage() {

  const mockDemo = useMockDemo();

  const live = hasLiveApi();

  const queryClient = useQueryClient();

  const { setSelectedState, selectedState } = useDashboardUi();



  const [measureId, setMeasureId] = useState(() => (mockDemo ? MOCK_METRICS[0]!.measure_id : ''));

  const [metricTitle, setMetricTitle] = useState(() => (mockDemo ? MOCK_METRICS[0]!.label : ''));

  const [interpretation, setInterpretation] = useState(() =>

    mockDemo ? MOCK_METRICS[0]!.interpretation : '',

  );

  const [locationTokens, setLocationTokens] = useState<string[]>(() =>

    mockDemo ? ['H:070001', 'H:070002'] : [],

  );

  const [includeNational, setIncludeNational] = useState(false);

  const [focusedSeriesKey, setFocusedSeriesKey] = useState<string | null>(null);

  const [analyticsUnlocked, setAnalyticsUnlocked] = useState(mockDemo);

  const [runBusy, setRunBusy] = useState(false);

  const [lastRankingSort, setLastRankingSort] = useState<HospitalRankingSort>('best');

  const [scopeStaleMessage, setScopeStaleMessage] = useState<string | null>(null);

  /** When true, chart pool is intersected with state ranking API results (toolbar sort). */
  const [restrictRankingPool, setRestrictRankingPool] = useState(false);

  const [chartSortColumn, setChartSortColumn] = useState<ChartSeriesSortColumn>('lastValue');

  const [chartSortOrder, setChartSortOrder] = useState<ChartSeriesSortOrder>('best');

  const [chartTopK, setChartTopK] = useState<number | 'all'>(8);

  const lastCommittedFingerprintRef = useRef<string | null>(null);



  const fetchSeriesEnabled = Boolean(measureId) && (mockDemo || live);



  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- chart focus tied to query inputs */
    setFocusedSeriesKey(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [measureId, locationTokens]);

  const scopeFingerprint = useMemo(
    () =>
      JSON.stringify({
        m: measureId,
        n: includeNational,
        t: [...locationTokens].sort(),
      }),
    [measureId, includeNational, locationTokens],
  );

  const prevScopeFingerprintRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevScopeFingerprintRef.current === null) {
      prevScopeFingerprintRef.current = scopeFingerprint;
      return;
    }
    if (prevScopeFingerprintRef.current !== scopeFingerprint) {
      prevScopeFingerprintRef.current = scopeFingerprint;
      setRestrictRankingPool(false);
      setChartSortColumn('lastValue');
      setChartSortOrder('best');
      setChartTopK(8);
    }
  }, [scopeFingerprint]);

  useEffect(() => {
    if (mockDemo) return;
    if (!analyticsUnlocked) return;
    const committed = lastCommittedFingerprintRef.current;
    if (committed === null) return;
    if (committed !== scopeFingerprint) {
      /* eslint-disable react-hooks/set-state-in-effect -- scope drift invalidates committed retrieval */
      setAnalyticsUnlocked(false);
      setScopeStaleMessage('Scope changed — run analysis again to refresh charts.');
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [analyticsUnlocked, mockDemo, scopeFingerprint]);

  useEffect(() => {
    if (!mockDemo) {
      /* eslint-disable react-hooks/set-state-in-effect -- changing metric invalidates prior analysis */
      setAnalyticsUnlocked(false);
      setScopeStaleMessage(null);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [measureId, mockDemo]);



  const onToggleLegendSeries = useCallback((key: string) => {

    setFocusedSeriesKey((prev) => (prev === key ? null : key));

  }, []);



  const volumeMetaQ = useQuery({

    queryKey: ['meta', 'volume-sibling', measureId],

    queryFn: () => fetchVolumeSibling(measureId),

    enabled: live && Boolean(measureId),

    staleTime: 300_000,

  });



  const volumeId = volumeMetaQ.data?.volume_measure_id ?? '';

  const hasVolumeSibling = Boolean(volumeMetaQ.data?.has_volume && volumeId);



  const seriesGate = mockDemo || analyticsUnlocked;



  const seriesQuery = useMetricSeries(measureId, locationTokens, includeNational, {

    enabled: fetchSeriesEnabled && seriesGate,

  });



  const volumeSeriesQuery = useMetricSeries(volumeId || undefined, locationTokens, includeNational, {

    enabled: fetchSeriesEnabled && Boolean(volumeId) && hasVolumeSibling && seriesGate,

  });



  const rawSeries = seriesQuery.data;

  const effectiveSeries =

    measureId && fetchSeriesEnabled && rawSeries && rawSeries.measure_id === measureId

      ? rawSeries

      : undefined;



  const volSeries =

    volumeId && volumeSeriesQuery.data?.measure_id === volumeId ? volumeSeriesQuery.data : undefined;



  const showAnalyticPanels = Boolean(measureId && effectiveSeries && (mockDemo || analyticsUnlocked));

  const hCcnsInScope = useMemo(
    () =>
      locationTokens
        .filter((t) => t.startsWith('H:'))
        .map((t) => t.slice(2).replace(/\D/g, '').padStart(6, '0')),
    [locationTokens],
  );

  const midForChartRank = useMemo(() => {
    return lastRankingSort === 'volume_high' || lastRankingSort === 'volume_low'
      ? volumeId || measureId
      : measureId;
  }, [lastRankingSort, volumeId, measureId]);

  const rankingChartLensQ = useQuery({
    queryKey: ['chart-ranking-lens', midForChartRank, selectedState, lastRankingSort],
    queryFn: () => fetchHospitalRankings(midForChartRank, selectedState, { limit: 64, sort: lastRankingSort }),
    enabled:
      live &&
      !mockDemo &&
      restrictRankingPool &&
      hCcnsInScope.length > 0 &&
      Boolean(midForChartRank) &&
      Boolean(selectedState) &&
      showAnalyticPanels,
    staleTime: 120_000,
  });

  const rankedCcnsForLens = useMemo(() => {
    const rows = rankingChartLensQ.data?.results;
    if (!rows?.length) return [];
    const scope = new Set(hCcnsInScope);
    const out: string[] = [];
    for (const r of rows) {
      const c = String(r.ccn).replace(/\D/g, '').padStart(6, '0');
      if (scope.has(c)) out.push(c);
      if (out.length >= 24) break;
    }
    return out;
  }, [rankingChartLensQ.data, hCcnsInScope]);

  const chartRowsTrend = useMemo(() => {
    const raw = effectiveSeries?.rows ?? [];
    if (!restrictRankingPool || hCcnsInScope.length === 0) return raw;
    if (!rankingChartLensQ.isSuccess || rankedCcnsForLens.length === 0) return raw;
    const next = filterSeriesRowsForRankingLens(raw, rankedCcnsForLens);
    const hadH = raw.some((r) => r.type === 'hospital');
    const hasH = next.some((r) => r.type === 'hospital');
    if (hadH && !hasH) return raw;
    return next;
  }, [
    effectiveSeries?.rows,
    restrictRankingPool,
    hCcnsInScope.length,
    rankingChartLensQ.isSuccess,
    rankedCcnsForLens,
  ]);

  const chartRowsVolume = useMemo(() => {
    const raw = volSeries?.rows ?? [];
    if (!restrictRankingPool || hCcnsInScope.length === 0) return raw;
    if (!rankingChartLensQ.isSuccess || rankedCcnsForLens.length === 0) return raw;
    const next = filterSeriesRowsForRankingLens(raw, rankedCcnsForLens);
    const hadH = raw.some((r) => r.type === 'hospital');
    const hasH = next.some((r) => r.type === 'hospital');
    if (hadH && !hasH) return raw;
    return next;
  }, [
    volSeries?.rows,
    restrictRankingPool,
    hCcnsInScope.length,
    rankingChartLensQ.isSuccess,
    rankedCcnsForLens,
  ]);

  const chartLimitForPick = chartTopK === 'all' ? Number.POSITIVE_INFINITY : chartTopK;

  const trendChartPick = useMemo(
    () =>
      pickSeriesRowsForChartSort(chartRowsTrend, {
        sortColumn: chartSortColumn,
        order: chartSortOrder,
        limit: chartLimitForPick,
        interpretation,
        includeAggregates: true,
      }),
    [chartRowsTrend, chartSortColumn, chartSortOrder, chartLimitForPick, interpretation],
  );

  const volumeChartPick = useMemo(
    () =>
      pickSeriesRowsForChartSort(chartRowsVolume, {
        sortColumn: chartSortColumn,
        order: chartSortOrder,
        limit: chartLimitForPick,
        interpretation,
        preferHigherLatest: true,
        includeAggregates: false,
      }),
    [chartRowsVolume, chartSortColumn, chartSortOrder, chartLimitForPick, interpretation],
  );

  const hasVolumeBars = Boolean(
    volumeId && hasVolumeSibling && (volSeries?.rows?.length ?? 0) > 0 && showAnalyticPanels,
  );

  const multiYear = useMemo(
    () =>
      trendChartPick.rows.length ? maxDistinctYearsPerSeries(trendChartPick.rows) > 1 : false,
    [trendChartPick.rows],
  );

  const trendPivotForBrush = useMemo(() => {
    if (!trendChartPick.rows.length) return null;
    const y = maxDistinctYearsPerSeries(trendChartPick.rows);
    if (y <= 1) return null;
    const p = pivotForLine(trendChartPick.rows);
    return { data: p.data, keys: p.keys };
  }, [trendChartPick.rows]);

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

  const rankingLensLabel = useMemo(() => {
    const m: Record<HospitalRankingSort, string> = {
      best: 'Best outlook',
      worst: 'Worst outlook',
      improved: 'Improved YoY',
      worsened: 'Worsened YoY',
      volume_high: 'High volume',
      volume_low: 'Low volume',
    };
    return m[lastRankingSort];
  }, [lastRankingSort]);



  const onApplyMetric = (m: MetricSearchHit) => {

    setMeasureId(m.measure_id);

    setMetricTitle(m.label);

    setInterpretation(m.interpretation);

  };



  const onClearMetric = () => {

    setMeasureId('');

    setMetricTitle('');

    setInterpretation('');

  };



  const onAddLocation = (opt: LocationOption) => {

    setLocationTokens((prev) => {

      if (prev.includes(opt.value)) return prev;

      if (opt.type === 'hospital' && opt.value.startsWith('H:')) {

        const hCount = prev.filter((t) => t.startsWith('H:')).length;

        if (hCount >= MAX_H_TOKENS) return prev;

      }

      return [...prev, opt.value];

    });

  };



  const onAddToken = (tok: string) => {
    setLocationTokens((prev) => {
      if (prev.includes(tok)) return prev;
      if (tok.startsWith('H:')) {
        const hCount = prev.filter((t) => t.startsWith('H:')).length;
        if (hCount >= MAX_H_TOKENS) return prev;
      }
      return [...prev, tok];
    });
  };



  const onRemoveToken = (tok: string) => {

    setLocationTokens((prev) => prev.filter((t) => t !== tok));

  };



  const onAddHospitalTokens = useCallback((tokens: string[]) => {

    setLocationTokens((prev) => {

      const next = [...prev];

      const seen = new Set(prev);

      let hCount = prev.filter((t) => t.startsWith('H:')).length;

      for (const t of tokens) {

        if (!t.startsWith('H:')) continue;

        if (hCount >= MAX_H_TOKENS) break;

        if (!seen.has(t)) {

          seen.add(t);

          next.push(t);

          hCount += 1;

        }

      }

      return next;

    });

  }, []);



  const onRunAnalysis = useCallback(async () => {
    if (!measureId) return;
    setRunBusy(true);
    setScopeStaleMessage(null);
    try {
      await queryClient.fetchQuery({
        queryKey: ['series', measureId, locationTokens, includeNational],
        queryFn: () => fetchMetricSeries(measureId, locationTokens, includeNational),
      });
      if (volumeId && hasVolumeSibling) {
        await queryClient.fetchQuery({
          queryKey: ['series', volumeId, locationTokens, includeNational],
          queryFn: () => fetchMetricSeries(volumeId, locationTokens, includeNational),
        });
      }
      const ranFp = JSON.stringify({
        m: measureId,
        n: includeNational,
        t: [...locationTokens].sort(),
      });
      lastCommittedFingerprintRef.current = ranFp;
      setAnalyticsUnlocked(true);
    } finally {
      setRunBusy(false);
    }
    requestAnimationFrame(() => {
      document.getElementById('dashboard-analytics')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [hasVolumeSibling, includeNational, locationTokens, measureId, queryClient, volumeId]);

  const onClearAllScope = useCallback(() => {
    setMeasureId('');
    setMetricTitle('');
    setInterpretation('');
    setLocationTokens([]);
    setIncludeNational(false);
    setSelectedState('CA');
    setLastRankingSort('best');
    setRestrictRankingPool(false);
    setChartSortColumn('lastValue');
    setChartSortOrder('best');
    setChartTopK(8);
    setAnalyticsUnlocked(mockDemo);
    setScopeStaleMessage(null);
    lastCommittedFingerprintRef.current = null;
  }, [mockDemo, setSelectedState]);



  return (

    <>

      <TopToolbar title={BRANDING.appTitle} subtitle={BRANDING.appSubtitle} />



      <div className="flex flex-col gap-5">
        <PromptBar
          measureId={measureId}
          metricTitle={metricTitle}
          locationTokens={locationTokens}
          includeNational={includeNational}
          onApplyMetric={onApplyMetric}
          onClearMetric={onClearMetric}
          onAddLocation={onAddLocation}
          onAddToken={onAddToken}
          onRemoveToken={onRemoveToken}
          onToggleNational={setIncludeNational}
          onRunAnalysis={onRunAnalysis}
          onClearAllScope={onClearAllScope}
          scopeStaleMessage={scopeStaleMessage}
          onAddHospitalTokens={onAddHospitalTokens}
          volumeMeasureId={volumeId}
          hasVolume={hasVolumeSibling}
          rankingSort={lastRankingSort}
          onRankingSortChange={setLastRankingSort}
        />
      </div>



      <div id="dashboard-analytics" className="mt-6 space-y-6 scroll-mt-6">

        {!live && !mockDemo && (
          <div

            className="rounded-2xl border px-6 py-12 text-center"

            style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-panel)' }}

          >

            <p className="text-base font-medium" style={{ color: 'var(--color-text-primary)' }}>

              No data backend configured

            </p>

            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>

              Set <code className="font-mono text-xs">VITE_API_BASE_URL=/api</code> and run{' '}

              <code className="font-mono text-xs">uvicorn dashboard.api_app:app --port 8765</code>, or set{' '}

              <code className="font-mono text-xs">VITE_USE_MOCK=true</code> for local demo fixtures.

            </p>

          </div>

        )}



        {(mockDemo || live) && runBusy && measureId ? (

          <div className="space-y-4">

            <div className="h-32 animate-pulse rounded-2xl" style={{ background: 'var(--color-panel-alt)' }} />

            <div className={`grid gap-4 ${hasVolumeBars ? 'lg:grid-cols-2' : ''}`}>

              <div className="h-64 animate-pulse rounded-xl" style={{ background: 'var(--color-panel-alt)' }} />

              {hasVolumeBars ? (

                <div className="h-64 animate-pulse rounded-xl" style={{ background: 'var(--color-panel-alt)' }} />

              ) : null}

            </div>

          </div>

        ) : null}



        {(mockDemo || live) && !runBusy && seriesQuery.isLoading && measureId && seriesGate ? (

          <div className="space-y-4">

            <div className="h-32 animate-pulse rounded-2xl" style={{ background: 'var(--color-panel-alt)' }} />

            <div className={`grid gap-4 ${hasVolumeBars ? 'lg:grid-cols-2' : ''}`}>

              <div className="h-64 animate-pulse rounded-xl" style={{ background: 'var(--color-panel-alt)' }} />

              {hasVolumeBars ? (

                <div className="h-64 animate-pulse rounded-xl" style={{ background: 'var(--color-panel-alt)' }} />

              ) : null}

            </div>

          </div>

        ) : null}



        {(mockDemo || live) && seriesQuery.error && seriesGate ? (

          <p className="text-center text-sm" style={{ color: 'var(--color-accent-danger)' }}>

            {(seriesQuery.error as Error).message}

          </p>

        ) : null}



        {(mockDemo || live) && showAnalyticPanels && effectiveSeries ? (
          <>
            <DataSummary
              measureId={measureId}
              locationTokens={locationTokens}
              rows={effectiveSeries.rows}
              interpretation={interpretation}
              hasNational={includeNational}
              measureTitle={metricTitle}
              insightEnabled
            />

            <ChartSeriesControls
              sortColumn={chartSortColumn}
              onSortColumnChange={setChartSortColumn}
              order={chartSortOrder}
              onOrderChange={setChartSortOrder}
              topK={chartTopK}
              onTopKChange={setChartTopK}
              restrictToRanking={restrictRankingPool}
              onRestrictToRankingChange={setRestrictRankingPool}
              rankingDisabled={hCcnsInScope.length === 0 || mockDemo || !live}
              rankingSortLabel={rankingLensLabel}
              selectedState={selectedState}
            />
            <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Charts use the same derived columns as the comparison table below. The table always lists every loaded
              series.
            </p>

            <div className={`grid items-stretch gap-4 lg:min-h-[min(580px,75vh)] ${hasVolumeBars ? 'lg:grid-cols-2' : ''}`}>
              <div className={`flex min-h-0 min-w-0 flex-col ${hasVolumeBars ? '' : 'lg:col-span-2'}`}>
                <TrendLineCard
                  rows={trendChartPick.rows}
                  title="Measure trend"
                  subtitle={multiYear ? metricTitle : 'Multi-year history required for the area trend view.'}
                  chartFooter={trendChartPick.summary}
                  focusedSeriesKey={focusedSeriesKey}
                  onToggleLegendSeries={onToggleLegendSeries}
                  fillHeight={hasVolumeBars}
                  hideLegend={sharedTrendVolumeLegend}
                  seriesColors={sharedTrendVolumeLegend ? seriesColorByKey : null}
                  onYearIndexRangeChange={sharedTrendVolumeLegend ? handleTrendYearBrush : undefined}
                />
              </div>
              {hasVolumeBars ? (
                <div className="flex min-h-0 min-w-0 flex-col">
                  <LatestValueBarCard
                    rows={volumeChartPick.rows}
                    title="Volume"
                    subtitle={`Horizontal grouped by facility · ${volumeId}`}
                    chartFooter={`${volumeChartPick.summary} Grouped by facility within each reporting year.`}
                    focusedSeriesKey={focusedSeriesKey}
                    onToggleLegendSeries={onToggleLegendSeries}
                    fillHeight
                    hideLegend={sharedTrendVolumeLegend}
                    seriesColors={sharedTrendVolumeLegend ? seriesColorByKey : null}
                    visibleYearLabels={visibleVolumeYearLabels}
                  />
                </div>
              ) : null}
            </div>
            {sharedTrendVolumeLegend ? (
              <ChartBottomLegend
                items={sharedTrendVolumeLegendItems}
                focusedKey={focusedSeriesKey}
                onToggleFocus={onToggleLegendSeries}
              />
            ) : null}

            <HospitalTable rows={effectiveSeries.rows} interpretation={interpretation} />
          </>
        ) : null}



        {(mockDemo || live) &&

          measureId &&

          !seriesQuery.isLoading &&

          !runBusy &&

          seriesGate &&

          effectiveSeries?.rows.length === 0 && (

            <p className="py-8 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>

              No values for this measure with the selected locations — try another metric or add hospitals/states.

            </p>

          )}

      </div>



      <footer className="mt-10 border-t pt-6 text-center text-[11px]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>

        Dev server is currently running the <code className="font-mono">/api</code> proxy to FastAPI (

        <code className="font-mono">127.0.0.1:8765</code>).

      </footer>

    </>

  );

}

