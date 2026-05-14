import { useCallback, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useDashboardUi } from '@/context/DashboardUiContext';
import { US_STATE_NAMES } from '@/lib/usStateNames';
import { MAX_H_TOKENS } from '@/lib/dashboardConstants';
import { hasLiveApi, useMockDemo } from '@/services/api';
import { fetchHospitalRankings, type HospitalRankingSort } from '@/services/rankings';

const RANK_ROWS: { sort: HospitalRankingSort; label: string; Icon: LucideIcon; volumeOnly?: boolean }[] = [
  { sort: 'best', label: 'Best outlook', Icon: Award },
  { sort: 'worst', label: 'Worst outlook', Icon: AlertTriangle },
  { sort: 'improved', label: 'Most improved (YoY)', Icon: TrendingUp },
  { sort: 'worsened', label: 'Most worsened (YoY)', Icon: TrendingDown },
  { sort: 'volume_high', label: 'High volume', Icon: BarChart3, volumeOnly: true },
  { sort: 'volume_low', label: 'Low volume', Icon: Activity, volumeOnly: true },
];

type Props = {
  measureId: string;
  locationTokens: string[];
  onAddHospitalTokens: (tokens: string[]) => void;
  volumeMeasureId?: string;
  hasVolume?: boolean;
  rankingSort: HospitalRankingSort;
  onRankingSortChange: (sort: HospitalRankingSort) => void;
  /** Hospital count for selected map state (from shared counts query in parent). */
  countForSelected?: number;
  countsErrorMessage?: string | null;
  /** When true, no outer card — sits inside Geography panel under the map. */
  embedded?: boolean;
};

export function RankingStateToolbar({
  measureId,
  locationTokens,
  onAddHospitalTokens,
  volumeMeasureId = '',
  hasVolume = false,
  rankingSort,
  onRankingSortChange,
  countForSelected,
  countsErrorMessage,
  embedded = false,
}: Props) {
  const { selectedState, setSelectedState } = useDashboardUi();
  const [rankNotice, setRankNotice] = useState<string | null>(null);
  const live = hasLiveApi();
  const mock = useMockDemo();

  const hCount = useMemo(() => locationTokens.filter((t) => t.startsWith('H:')).length, [locationTokens]);
  const slots = Math.max(0, MAX_H_TOKENS - hCount);
  const stateName = US_STATE_NAMES[selectedState] ?? selectedState;

  const addRanked = useCallback(
    async (sort: HospitalRankingSort) => {
      if (!measureId || slots <= 0) return;
      if (mock || !live) return;
      setRankNotice(null);
      onRankingSortChange(sort);
      const mid = sort === 'volume_high' || sort === 'volume_low' ? volumeMeasureId || measureId : measureId;
      try {
        const r = await fetchHospitalRankings(mid, selectedState, { limit: slots, sort });
        const tokens = r.results.map((row) => `H:${row.ccn}`);
        if (tokens.length === 0) {
          if (sort === 'improved' || sort === 'worsened') {
            const ey = r.eligible_with_yoy ?? r.eligible ?? 0;
            const mc = r.matched_criteria ?? 0;
            if (ey > 0 && mc === 0) {
              setRankNotice(
                `No hospitals met strict "${sort}" criteria in ${selectedState} (${ey} with two-year history).`,
              );
            } else {
              setRankNotice(`No hospitals with two-year history for this measure in ${selectedState}.`);
            }
          } else {
            setRankNotice(`No hospitals returned for "${sort.replaceAll('_', ' ')}" in ${selectedState}.`);
          }
          return;
        }
        onAddHospitalTokens(tokens);
      } catch (e) {
        setRankNotice((e as Error).message ?? 'Rankings request failed.');
      }
    },
    [measureId, selectedState, slots, mock, live, onAddHospitalTokens, onRankingSortChange, volumeMeasureId],
  );

  const rankChipClass =
    'group relative flex min-h-[2.85rem] w-full min-w-0 cursor-pointer items-center gap-2.5 overflow-hidden rounded-xl border px-2.5 py-2 text-left text-xs font-semibold tracking-tight text-[var(--color-text-secondary)] outline-none transition-[transform,box-shadow,border-color,background] duration-200 ease-out hover:-translate-y-px hover:shadow-[0_12px_40px_-12px_color-mix(in_srgb,var(--color-map-glow)_80%,transparent)] active:translate-y-0 active:scale-[0.97] active:duration-100 focus-visible:ring-2 focus-visible:ring-cyan-400/45 disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0';

  const rankChipStyle = (active: boolean) =>
    ({
      borderColor: active
        ? 'color-mix(in srgb, var(--color-accent-cyan) 50%, var(--color-border-strong))'
        : 'var(--color-border)',
      background: active
        ? 'linear-gradient(155deg, color-mix(in srgb, var(--color-accent-violet) 16%, var(--color-panel-alt)) 0%, color-mix(in srgb, var(--color-accent-blue) 12%, var(--color-panel-solid)) 100%)'
        : 'linear-gradient(175deg, var(--color-panel-solid) 0%, color-mix(in srgb, var(--color-panel-alt) 62%, var(--color-panel-solid)) 100%)',
      boxShadow: active
        ? 'inset 0 1px 0 color-mix(in srgb, var(--color-text-primary) 9%, transparent), 0 0 0 1px color-mix(in srgb, var(--color-accent-cyan) 24%, transparent), 0 8px 36px color-mix(in srgb, var(--color-map-glow) 90%, transparent)'
        : 'inset 0 1px 0 color-mix(in srgb, var(--color-text-primary) 6%, transparent), 0 4px 20px -8px color-mix(in srgb, var(--color-accent-blue) 16%, transparent)',
    }) as const;

  const shellClass = embedded
    ? 'mt-3 min-w-0 space-y-2 border-t pt-3'
    : 'mt-4 rounded-xl border p-3 md:p-4';
  const shellStyle = embedded
    ? { borderColor: 'var(--color-border)' }
    : { borderColor: 'var(--color-border)', background: 'var(--color-panel-solid)' };

  return (
    <div className={shellClass} style={shellStyle}>
      {!embedded ? (
        <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
          Rankings
        </p>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3">
        <label className="flex w-full min-w-0 flex-col gap-1 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
            State
          </span>
          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="cursor-pointer rounded-lg border px-2 py-2 text-xs outline-none"
            style={{
              borderColor: 'var(--color-border-strong)',
              background: 'var(--color-panel-alt)',
              color: 'var(--color-text-primary)',
            }}
          >
            {Object.keys(US_STATE_NAMES)
              .sort()
              .map((code) => (
                <option key={code} value={code}>
                  {code} — {US_STATE_NAMES[code]}
                </option>
              ))}
          </select>
        </label>

        <p className="w-full min-w-0 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
          <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {stateName}
          </span>
          {live && !mock && countForSelected !== undefined ? <> · {countForSelected.toLocaleString()} hospitals</> : null}
          {slots > 0 ? <> · up to {slots} hospital slots</> : <> · hospital cap reached</>}
        </p>

        {measureId && live && !mock ? (
          <>
            <div
              className={`space-y-1 ${embedded ? '' : 'border-t pt-3'}`}
              style={embedded ? undefined : { borderColor: 'var(--color-border)' }}
            >
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                Ranked hospitals
              </p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
                Click a preset to{' '}
                <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  add up to {slots} hospitals
                </span>{' '}
                for {selectedState} using the current measure.
              </p>
            </div>
            <div className="grid w-full min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {RANK_ROWS.map(({ sort, label, Icon, volumeOnly }) => {
                const volBlocked = Boolean(volumeOnly && (!hasVolume || !volumeMeasureId));
                const disabled = slots <= 0 || volBlocked;
                const active = rankingSort === sort;
                return (
                  <button
                    key={sort}
                    type="button"
                    title={
                      volBlocked
                        ? 'Volume rankings need a volume-capable measure'
                        : `Add hospitals: ${label} in ${selectedState}`
                    }
                    disabled={disabled}
                    onClick={() => void addRanked(sort)}
                    className={rankChipClass}
                    style={rankChipStyle(active)}
                    aria-label={`Add hospitals for ${selectedState}: ${label}`}
                  >
                    <Icon
                      className="h-4 w-4 shrink-0 transition-[transform,color,filter] duration-200 group-hover:scale-110 group-hover:drop-shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent-cyan)_55%,transparent)]"
                      style={{
                        color: active ? 'var(--color-accent-cyan)' : 'var(--color-text-tertiary)',
                        filter: active
                          ? 'drop-shadow(0 0 8px color-mix(in srgb, var(--color-accent-cyan) 42%, transparent))'
                          : undefined,
                      }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 leading-snug">{label}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>

      {rankNotice ? (
        <p
          className="mt-2 rounded-lg border px-2 py-1.5 text-[11px]"
          style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-accent-warning)' }}
        >
          {rankNotice}
        </p>
      ) : null}

      {countsErrorMessage ? (
        <p className="mt-2 text-[11px]" style={{ color: 'var(--color-accent-danger)' }}>
          {countsErrorMessage}
        </p>
      ) : null}

      {mock ? (
        <p className="mt-2 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          Rankings require live API.
        </p>
      ) : null}
    </div>
  );
}
