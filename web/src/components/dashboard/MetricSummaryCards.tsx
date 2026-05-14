import type { MetricSummary } from '@/types/metric';

type Props = {
  summaries: MetricSummary[];
};

export function MetricSummaryCards({ summaries }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {summaries.map((s) => (
        <article
          key={s.measureId}
          className="rounded-2xl border p-4"
          style={{
            borderColor: 'var(--color-border-strong)',
            background: 'var(--color-panel)',
            boxShadow: 'var(--shadow-panel)',
            backdropFilter: 'var(--glass-blur)',
          }}
        >
          <div className="font-mono text-xs" style={{ color: 'var(--color-accent-blue)' }}>
            {s.measureId}
          </div>
          <h3 className="mt-2 text-sm font-semibold leading-snug" style={{ color: 'var(--color-text-primary)' }}>
            {s.title}
          </h3>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {s.interpretation}
          </p>
          {s.hasNational !== undefined && (
            <p
              className="mt-3 text-[11px] font-medium uppercase tracking-wide"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              National series: {s.hasNational ? 'available' : 'not available'}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
