import { useDashboardUi } from '@/context/DashboardUiContext';
import { US_STATE_NAMES } from '@/lib/usStateNames';

export function InsightsHeader() {
  const { selectedState } = useDashboardUi();
  const name = US_STATE_NAMES[selectedState] ?? selectedState;

  return (
    <header className="mb-4 text-left">
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
        Analysis scope
      </p>
      <h2 className="mt-1 text-xl font-bold tracking-tight md:text-2xl" style={{ color: 'var(--color-text-primary)' }}>
        {name} focus
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        Choose a CMS measure, add <span className="font-mono text-xs">S:ST</span> and/or <span className="font-mono text-xs">H:CCN</span>{' '}
        tokens (prompt bar), optionally add national benchmark, then run analysis. Use{' '}
        <span className="font-semibold">Top in state</span> when you need a short hospital list for crowded states. In the
        charts, click a <span className="font-semibold">legend</span> entry to focus one series (trend and volume dim the
        rest).
      </p>
    </header>
  );
}
