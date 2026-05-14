import type { ChartSeriesSortColumn, ChartSeriesSortOrder } from '@/lib/chartSeriesSelection';
import { CHART_SORT_COLUMN_LABELS } from '@/lib/chartSeriesSelection';

const SORT_OPTIONS: ChartSeriesSortColumn[] = [
  'lastValue',
  'mean',
  'netChange',
  'maxFluctAbs',
  'upStepsLast5',
  'lastYear',
  'nYears',
  'name',
];

const TOP_K_OPTIONS = [8, 12, 16, 24, 'all'] as const;

type Props = {
  sortColumn: ChartSeriesSortColumn;
  onSortColumnChange: (c: ChartSeriesSortColumn) => void;
  order: ChartSeriesSortOrder;
  onOrderChange: (o: ChartSeriesSortOrder) => void;
  topK: number | 'all';
  onTopKChange: (k: number | 'all') => void;
  restrictToRanking: boolean;
  onRestrictToRankingChange: (v: boolean) => void;
  rankingDisabled?: boolean;
  rankingSortLabel: string;
  selectedState: string;
};

export function ChartSeriesControls({
  sortColumn,
  onSortColumnChange,
  order,
  onOrderChange,
  topK,
  onTopKChange,
  restrictToRanking,
  onRestrictToRankingChange,
  rankingDisabled = false,
  rankingSortLabel,
  selectedState,
}: Props) {
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border px-3 py-3 sm:flex-row sm:flex-wrap sm:items-end"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-solid)' }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
          Line & volume — sort like comparison table
        </span>
        <select
          className="max-w-md rounded-lg border px-2 py-1.5 text-xs outline-none"
          style={{
            borderColor: 'var(--color-border-strong)',
            background: 'var(--color-panel-alt)',
            color: 'var(--color-text-primary)',
          }}
          value={sortColumn}
          onChange={(e) => onSortColumnChange(e.target.value as ChartSeriesSortColumn)}
        >
          {SORT_OPTIONS.map((id) => (
            <option key={id} value={id}>
              {CHART_SORT_COLUMN_LABELS[id]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
          Order
        </span>
        <div className="flex gap-1">
          {(['best', 'worst'] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onOrderChange(o)}
              className="rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-opacity"
              style={{
                opacity: order === o ? 1 : 0.75,
                border: `1px solid ${order === o ? 'var(--color-accent-cyan)' : 'var(--color-border)'}`,
                color: order === o ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                background:
                  order === o
                    ? 'color-mix(in srgb, var(--color-accent-cyan) 12%, var(--color-panel-alt))'
                    : 'var(--color-panel-alt)',
              }}
            >
              {o === 'best' ? 'Best first' : 'Worst first'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
          Show top
        </span>
        <select
          className="rounded-lg border px-2 py-1.5 text-xs outline-none"
          style={{
            borderColor: 'var(--color-border-strong)',
            background: 'var(--color-panel-alt)',
            color: 'var(--color-text-primary)',
          }}
          value={topK === 'all' ? 'all' : String(topK)}
          onChange={(e) => {
            const v = e.target.value;
            onTopKChange(v === 'all' ? 'all' : Number(v));
          }}
        >
          {TOP_K_OPTIONS.map((k) => (
            <option key={String(k)} value={String(k)}>
              {k === 'all' ? `All (max 32)` : k}
            </option>
          ))}
        </select>
      </div>

      <label
        className={`flex cursor-pointer items-center gap-2 text-[11px] ${rankingDisabled ? 'cursor-not-allowed opacity-50' : ''}`}
        style={{ color: 'var(--color-text-secondary)' }}
      >
        <input
          type="checkbox"
          className="rounded border"
          style={{ borderColor: 'var(--color-border-strong)' }}
          checked={restrictToRanking}
          disabled={rankingDisabled}
          onChange={(e) => onRestrictToRankingChange(e.target.checked)}
        />
        <span>
          Restrict chart pool to state ranking ({selectedState}) — {rankingSortLabel}
        </span>
      </label>
    </div>
  );
}
