import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { ChevronRight, Send, TextSearch } from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { StateHoneyCombMap } from '@/components/charts/StateHoneyCombMap';
import { RankingStateToolbar } from '@/components/dashboard/RankingStateToolbar';
import { StateHospitalBrowser } from '@/components/dashboard/StateHospitalBrowser';
import { useDashboardUi } from '@/context/DashboardUiContext';
import { useUnifiedDatasetSearch } from '@/hooks/useUnifiedDatasetSearch';
import { useTokenDisplayLabels } from '@/hooks/useTokenDisplayLabels';
import { US_STATE_NAMES } from '@/lib/usStateNames';
import { hasLiveApi, useMockDemo } from '@/services/api';
import { emptyCountsRecord, fetchHospitalCountsByState } from '@/services/hospitalCounts';
import { postResolveQuery, resolveQueryEnabled } from '@/services/resolveQuery';
import type { HospitalRankingSort } from '@/services/rankings';
import type { LocationOption } from '@/types/hospital';
import type { MetricSearchHit } from '@/types/metric';

const SLOW_RESOLVE_MS = 480;

/** Shared interactive row: lift, glow, and press feedback for filtered search hits. */
const filteredRowBase =
  'group flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-2.5 text-left text-xs outline-none transition-[transform,background-color,box-shadow,border-color] duration-200 ease-out active:scale-[0.985] active:duration-100';

const filteredRowStates = `${filteredRowBase} hover:border-[color-mix(in_srgb,var(--color-accent-cyan)_38%,var(--color-border))] hover:bg-[color-mix(in_srgb,var(--color-accent-cyan)_11%,var(--color-panel-alt))] hover:shadow-[0_0_26px_-8px_color-mix(in_srgb,var(--color-accent-cyan)_42%,transparent)] focus-visible:ring-2 focus-visible:ring-cyan-400/40`;

const filteredRowMetrics = `${filteredRowBase} hover:border-[color-mix(in_srgb,var(--color-accent-blue)_38%,var(--color-border))] hover:bg-[color-mix(in_srgb,var(--color-accent-blue)_11%,var(--color-panel-alt))] hover:shadow-[0_0_26px_-8px_color-mix(in_srgb,var(--color-accent-blue)_38%,transparent)] focus-visible:ring-2 focus-visible:ring-blue-400/35`;

const filteredRowHospitals = `${filteredRowBase} hover:border-[color-mix(in_srgb,#d9735c_42%,var(--color-border))] hover:bg-[color-mix(in_srgb,#e89582_10%,var(--color-panel-alt))] hover:shadow-[0_0_26px_-8px_color-mix(in_srgb,#d9735c_35%,transparent)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,#d9735c_45%,transparent)]`;

type Props = {
  measureId: string;
  metricTitle: string;
  locationTokens: string[];
  includeNational: boolean;
  onApplyMetric: (m: MetricSearchHit) => void;
  onClearMetric: () => void;
  onAddLocation: (opt: LocationOption) => void;
  onAddToken: (tok: string) => void;
  onRemoveToken: (tok: string) => void;
  onToggleNational: (v: boolean) => void;
  onRunAnalysis: () => void | Promise<void>;
  onClearAllScope: () => void;
  scopeStaleMessage: string | null;
  onAddHospitalTokens: (tokens: string[]) => void;
  volumeMeasureId: string;
  hasVolume: boolean;
  rankingSort: HospitalRankingSort;
  onRankingSortChange: (sort: HospitalRankingSort) => void;
};

export function PromptBar({
  measureId,
  metricTitle,
  locationTokens,
  includeNational,
  onApplyMetric,
  onClearMetric,
  onAddLocation,
  onAddToken,
  onRemoveToken,
  onToggleNational,
  onRunAnalysis,
  onClearAllScope,
  scopeStaleMessage,
  onAddHospitalTokens,
  volumeMeasureId,
  hasVolume,
  rankingSort,
  onRankingSortChange,
}: Props) {
  const { selectedState, setSelectedState } = useDashboardUi();
  const reduceMotion = useReducedMotion();
  const live = hasLiveApi();
  const mock = useMockDemo();
  const [draft, setDraft] = useState('');
  const deferred = useDeferredValue(draft.trim());
  const inputRef = useRef<HTMLInputElement>(null);

  const [slowDebounced, setSlowDebounced] = useState('');
  useEffect(() => {
    const t = deferred.trim();
    if (t.length < 2) {
      setSlowDebounced('');
      return;
    }
    const id = window.setTimeout(() => setSlowDebounced(t), SLOW_RESOLVE_MS);
    return () => window.clearTimeout(id);
  }, [deferred]);

  const stateName = US_STATE_NAMES[selectedState] ?? selectedState;
  const labelQ = useTokenDisplayLabels(locationTokens);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        onRunAnalysis();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRunAnalysis]);

  const typedMode = deferred.length >= 2;

  const resolveSlowQ = useQuery({
    queryKey: ['resolve-slow', slowDebounced],
    queryFn: () =>
      postResolveQuery({
        q: slowDebounced,
        metric_limit: 20,
        hospital_limit: 40,
      }),
    enabled: resolveQueryEnabled() && slowDebounced.length >= 2,
    staleTime: 30_000,
  });

  const unifiedQ = useUnifiedDatasetSearch(draft);

  const countsQ = useQuery({
    queryKey: ['hospitals-counts-by-state'],
    queryFn: fetchHospitalCountsByState,
    enabled: live && !mock,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });

  const mapCounts = useMemo(() => {
    if (mock || !live) return emptyCountsRecord();
    return countsQ.data?.counts ?? emptyCountsRecord();
  }, [mock, live, countsQ.data]);

  const countForSelected =
    mapCounts[selectedState] !== undefined ? mapCounts[selectedState] : undefined;
  const countsErrorMessage =
    live && !mock && countsQ.isError ? (countsQ.error as Error).message : null;

  const showExplore = resolveQueryEnabled();

  const stateChips = useMemo(() => locationTokens.filter((t) => /^S:[A-Za-z]{2}$/i.test(t)), [locationTokens]);
  const hospitalChips = useMemo(() => locationTokens.filter((t) => t.startsWith('H:')), [locationTokens]);
  const otherChips = useMemo(
    () => locationTokens.filter((t) => !/^S:[A-Za-z]{2}$/i.test(t) && !t.startsWith('H:')),
    [locationTokens],
  );

  const hasScope =
    Boolean(measureId) || locationTokens.length > 0 || includeNational || Boolean(metricTitle);

  return (
    <motion.section
      className="rounded-2xl border p-4 md:p-5"
      style={{
        borderColor: 'var(--color-border-strong)',
        background: 'var(--color-panel)',
        boxShadow: 'var(--shadow-panel)',
      }}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <p className="text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
          Ask the Dataset
        </p>
        <button
          type="button"
          onClick={onClearAllScope}
          disabled={!hasScope}
          className="text-[11px] font-semibold uppercase tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
          style={{ color: 'var(--color-accent-cyan)' }}
        >
          Clear all
        </button>
      </div>

      {scopeStaleMessage ? (
        <p
          className="mb-3 rounded-lg border px-3 py-2 text-xs leading-relaxed"
          style={{
            borderColor: 'var(--color-border-strong)',
            color: 'var(--color-accent-warning)',
            background: 'var(--color-panel-alt)',
          }}
          role="status"
        >
          {scopeStaleMessage}
        </p>
      ) : null}

      <div
        className="flex items-center gap-2 rounded-[14px] border px-3 py-1.5 md:px-4"
        style={{
          borderColor: 'var(--color-border-strong)',
          background: 'var(--color-panel-solid)',
          minHeight: 56,
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search metrics, states, hospitals (2+ letters)…"
          className="min-w-0 flex-1 border-0 bg-transparent py-2 text-sm outline-none"
          style={{ color: 'var(--color-text-primary)' }}
        />
        <button
          type="button"
          onClick={onRunAnalysis}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-opacity hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, var(--color-accent-blue), var(--color-accent-violet))',
            boxShadow: '0 8px 24px var(--color-map-glow)',
          }}
          aria-label="Run analysis"
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {measureId ? (
          <button
            type="button"
            onClick={onClearMetric}
            className="group inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium"
            style={{
              borderColor: 'var(--color-accent-blue)',
              background: 'color-mix(in srgb, var(--color-accent-blue) 10%, var(--color-panel-alt))',
              color: 'var(--color-text-primary)',
            }}
          >
            <span className="font-mono text-[10px] opacity-80">{measureId}</span>
            <span className="truncate text-left">{metricTitle.slice(0, 48)}</span>
            <span className="opacity-50 group-hover:opacity-100">×</span>
          </button>
        ) : null}
        {stateChips.map((tok) => (
          <button
            key={tok}
            type="button"
            onClick={() => onRemoveToken(tok)}
            className="inline-flex max-w-[min(100%,20rem)] items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90"
            style={{
              borderColor: 'var(--color-accent-cyan)',
              background: 'var(--color-panel-alt)',
              color: 'var(--color-text-secondary)',
            }}
            title={labelQ.data?.[tok] ?? tok}
          >
            <span className="truncate">{labelQ.data?.[tok] ?? (labelQ.isLoading ? '…' : tok)}</span>
            <span className="shrink-0 opacity-50">×</span>
          </button>
        ))}
        {hospitalChips.map((tok) => (
          <button
            key={tok}
            type="button"
            onClick={() => onRemoveToken(tok)}
            className="inline-flex max-w-[min(100%,20rem)] items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-panel-alt)',
              color: 'var(--color-text-secondary)',
            }}
            title={labelQ.data?.[tok] ?? tok}
          >
            <span className="truncate">{labelQ.data?.[tok] ?? (labelQ.isLoading ? 'Loading…' : tok)}</span>
            <span className="shrink-0 opacity-50">×</span>
          </button>
        ))}
        {otherChips.map((tok) => (
          <button
            key={tok}
            type="button"
            onClick={() => onRemoveToken(tok)}
            className="inline-flex max-w-[min(100%,20rem)] items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium"
            style={{
              borderColor: 'var(--color-border)',
              background: 'var(--color-panel-alt)',
              color: 'var(--color-text-secondary)',
            }}
            title={labelQ.data?.[tok] ?? tok}
          >
            <span className="truncate">{labelQ.data?.[tok] ?? tok}</span>
            <span className="shrink-0 opacity-50">×</span>
          </button>
        ))}
        <label
          className="inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-secondary)',
            background: 'var(--color-panel-solid)',
          }}
        >
          <input
            type="checkbox"
            checked={includeNational}
            onChange={(e) => onToggleNational(e.target.checked)}
            className="h-3.5 w-3.5 rounded border"
            style={{ accentColor: 'var(--color-accent-cyan)' }}
          />
          National
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onRunAnalysis}
          className="rounded-full px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{
            background: 'linear-gradient(90deg, var(--color-accent-blue), var(--color-accent-violet))',
          }}
        >
          Run analysis
        </button>
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          <kbd className="rounded border px-1 font-mono text-[10px]" style={{ borderColor: 'var(--color-border)' }}>
            ⌘
          </kbd>
          <kbd className="ml-0.5 rounded border px-1 font-mono text-[10px]" style={{ borderColor: 'var(--color-border)' }}>
            Enter
          </kbd>{' '}
          ·{' '}
          <kbd className="rounded border px-1 font-mono text-[10px]" style={{ borderColor: 'var(--color-border)' }}>
            ⌘
          </kbd>
          <kbd className="ml-0.5 rounded border px-1 font-mono text-[10px]" style={{ borderColor: 'var(--color-border)' }}>
            K
          </kbd>
        </span>
      </div>

      {showExplore ? (
        <>
          <div className="mt-4 grid min-w-0 gap-4 text-left md:grid-cols-2 md:items-stretch">
            <div
              className="flex min-h-0 min-w-0 flex-col rounded-xl border p-3 md:min-h-[min(280px,40vh)]"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-solid)' }}
            >
              <h3 className="mb-1 text-xs font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
                Filtered results
              </h3>
              <p className="mb-4 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
                Section labels show type (teal = state, blue = measure, coral = hospital). Rows lift and glow on hover; chevron nudges when you point.
              </p>

              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1" style={{ maxHeight: 'min(38vh,320px)' }}>
                {typedMode && unifiedQ.isFetching && !unifiedQ.data ? (
                  <div className="h-28 animate-pulse rounded-lg" style={{ background: 'var(--color-panel-alt)' }} aria-hidden />
                ) : null}
                {typedMode && unifiedQ.isError ? (
                  <p className="text-xs" style={{ color: 'var(--color-accent-danger)' }}>
                    {(unifiedQ.error as Error).message}
                  </p>
                ) : null}
                {typedMode && unifiedQ.data ? (
                  <>
                    {unifiedQ.data.states.length > 0 ? (
                      <div>
                        <p
                          className="mb-1.5 text-[10px] font-medium uppercase tracking-wider"
                          style={{ color: 'var(--color-accent-cyan)' }}
                        >
                          States
                        </p>
                        <ul className="rounded-md border" style={{ borderColor: 'var(--color-border)' }}>
                          {unifiedQ.data.states.map((s) => (
                            <li key={s.token} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                              <button
                                type="button"
                                aria-label={`Add state ${s.label}`}
                                className={filteredRowStates}
                                style={{ color: 'var(--color-text-secondary)' }}
                                onClick={() => {
                                  onAddToken(s.token);
                                  setDraft('');
                                }}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                    {s.token}
                                  </span>
                                  <span className="ml-2">{s.label}</span>
                                </span>
                                <ChevronRight
                                  className="h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:opacity-90"
                                  style={{ color: 'var(--color-accent-cyan)' }}
                                  aria-hidden
                                />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {unifiedQ.data.metrics.length > 0 ? (
                      <div>
                        <p
                          className="mb-1.5 text-[10px] font-medium uppercase tracking-wider"
                          style={{ color: 'var(--color-accent-blue)' }}
                        >
                          Measures
                        </p>
                        <ul className="rounded-md border" style={{ borderColor: 'var(--color-border)' }}>
                          {unifiedQ.data.metrics.map((m) => (
                            <li key={m.measure_id} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                              <button
                                type="button"
                                aria-label={`Select measure ${m.label}`}
                                className={filteredRowMetrics}
                                style={{ color: 'var(--color-text-secondary)' }}
                                onClick={() => {
                                  onApplyMetric(m);
                                  setDraft('');
                                }}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                                    {m.measure_id}
                                  </span>
                                  <span className="ml-2 line-clamp-2">{m.label}</span>
                                </span>
                                <ChevronRight
                                  className="h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:opacity-90"
                                  style={{ color: 'var(--color-accent-blue)' }}
                                  aria-hidden
                                />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {unifiedQ.data.hospitals.length > 0 ? (
                      <div>
                        <p
                          className="mb-1.5 text-[10px] font-medium uppercase tracking-wider"
                          style={{ color: '#c45d4e' }}
                        >
                          Hospitals
                        </p>
                        <ul className="rounded-md border" style={{ borderColor: 'var(--color-border)' }}>
                          {unifiedQ.data.hospitals.map((o) => (
                            <li key={o.value} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                              <button
                                type="button"
                                aria-label={`Add hospital ${o.label}`}
                                className={filteredRowHospitals}
                                style={{ color: 'var(--color-text-secondary)' }}
                                onClick={() => {
                                  onAddLocation(o);
                                  setDraft('');
                                }}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
                                    Hospital
                                  </span>
                                  <span className="mt-0.5 block leading-snug">{o.label}</span>
                                </span>
                                <ChevronRight
                                  className="h-3.5 w-3.5 shrink-0 opacity-0 transition-[opacity,transform] duration-200 group-hover:translate-x-0.5 group-hover:opacity-90"
                                  style={{ color: '#d9735c' }}
                                  aria-hidden
                                />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {!unifiedQ.isFetching &&
                    unifiedQ.data.metrics.length === 0 &&
                    unifiedQ.data.hospitals.length === 0 &&
                    unifiedQ.data.states.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        No matches.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div
                    className="flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center"
                    style={{
                      borderColor: 'var(--color-border-strong)',
                      background: 'color-mix(in srgb, var(--color-panel-alt) 65%, var(--color-panel-solid))',
                    }}
                  >
                    <div
                      className="flex h-12 w-12 items-center justify-center rounded-xl border"
                      style={{
                        borderColor: 'var(--color-border)',
                        background: 'var(--color-panel-alt)',
                        color: 'var(--color-accent-violet)',
                      }}
                      aria-hidden
                    >
                      <TextSearch className="h-6 w-6" strokeWidth={1.75} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                        Search to see matches
                      </p>
                      <p className="mt-1 max-w-[18rem] text-[11px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
                        Type at least <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>2 characters</span> to
                        search measures, hospitals, and states.
                      </p>
                    </div>
                  </div>
                )}
                {typedMode && resolveSlowQ.data?.warnings && resolveSlowQ.data.warnings.length > 0 ? (
                  <ul className="text-[11px]" style={{ color: 'var(--color-accent-warning)' }}>
                    {resolveSlowQ.data.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {live && !mock ? (
                <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
                  <StateHospitalBrowser stateCode={selectedState} disabled={!measureId} onPick={onAddLocation} />
                </div>
              ) : null}
            </div>

            <div
              className="flex min-h-0 min-w-0 flex-col rounded-xl border p-3 md:min-h-[min(280px,40vh)]"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-solid)' }}
            >
              <h3 className="mb-1 text-xs font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
                Geography
              </h3>
              <p className="mb-4 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
                {stateName}: lighter map blues = fewer hospitals, deeper blues = more. Selected state uses a clear outline.
                Rankings below use the same state.
              </p>
              <div
                className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border md:min-h-[200px]"
                style={{
                  borderColor: 'var(--color-border)',
                  background: 'var(--color-panel-alt)',
                }}
              >
                <StateHoneyCombMap
                  counts={mapCounts}
                  selectedState={selectedState}
                  onSelectState={setSelectedState}
                  className="h-full w-full min-h-[200px]"
                  loading={live && !mock && countsQ.isLoading}
                />
              </div>
              <RankingStateToolbar
                embedded
                measureId={measureId}
                locationTokens={locationTokens}
                onAddHospitalTokens={onAddHospitalTokens}
                volumeMeasureId={volumeMeasureId}
                hasVolume={hasVolume}
                rankingSort={rankingSort}
                onRankingSortChange={onRankingSortChange}
                countForSelected={countForSelected}
                countsErrorMessage={countsErrorMessage}
              />
            </div>
          </div>
        </>
      ) : null}

      {!resolveQueryEnabled() && (
        <p className="mt-3 text-left text-sm" style={{ color: 'var(--color-accent-warning)' }}>
          Connect data: set <code className="font-mono text-xs">VITE_API_BASE_URL=/api</code> and run FastAPI, or set{' '}
          <code className="font-mono text-xs">VITE_USE_MOCK=true</code> for local fixtures.
        </p>
      )}
    </motion.section>
  );
}
