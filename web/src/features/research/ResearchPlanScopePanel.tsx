import type { ResearchPlanScopeDraft, ResearchAnalysisFocus } from '@/features/research/researchPlanScope';
import { statesFromScopeGeography } from '@/features/research/researchPlanScope';

const FOCUS_OPTIONS: { value: ResearchAnalysisFocus; label: string }[] = [
  { value: 'unspecified', label: 'Infer focus from question' },
  { value: 'national_trends', label: 'National / population trends' },
  { value: 'state_hospitals', label: 'States + hospital ranking' },
  { value: 'named_hospitals', label: 'Named hospitals / search' },
  { value: 'explore', label: 'Broad exploration' },
];

const BIAS_OPTIONS: { value: ResearchPlanScopeDraft['rankingBias']; label: string }[] = [
  { value: 'neutral', label: 'Neutral' },
  { value: 'favorable', label: 'Favorable (best / safest)' },
  { value: 'concerning', label: 'Concerning (worst / risk)' },
];

type Props = {
  value: ResearchPlanScopeDraft;
  onChange: (next: ResearchPlanScopeDraft) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function ResearchPlanScopePanel({ value, onChange, disabled, compact }: Props) {
  const parsedStates = statesFromScopeGeography(value);
  return (
    <div
      className={`rounded-2xl border text-left ${compact ? 'p-3' : 'p-4'}`}
      style={{
        borderColor: 'var(--color-border-strong)',
        background: 'var(--color-panel-alt)',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
        Plan scope (optional)
      </p>
      <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
        These hints are sent with your question to improve planner JSON (states, intent, ranking bias). They are not
        treated as data values.
      </p>
      <div className={`mt-3 grid gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Analysis focus
          </span>
          <select
            disabled={disabled}
            value={value.analysisFocus}
            onChange={(e) => onChange({ ...value, analysisFocus: e.target.value as ResearchAnalysisFocus })}
            className="rounded-lg border px-2 py-2 text-sm outline-none"
            style={{
              borderColor: 'var(--color-border-strong)',
              background: 'var(--color-panel-solid)',
              color: 'var(--color-text-primary)',
            }}
          >
            {FOCUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Ranking bias hint
          </span>
          <select
            disabled={disabled}
            value={value.rankingBias}
            onChange={(e) =>
              onChange({ ...value, rankingBias: e.target.value as ResearchPlanScopeDraft['rankingBias'] })
            }
            className="rounded-lg border px-2 py-2 text-sm outline-none"
            style={{
              borderColor: 'var(--color-border-strong)',
              background: 'var(--color-panel-solid)',
              color: 'var(--color-text-primary)',
            }}
          >
            {BIAS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            US states (optional)
          </span>
          <input
            type="text"
            disabled={disabled}
            value={value.geographyText}
            onChange={(e) => onChange({ ...value, geographyText: e.target.value })}
            placeholder="e.g. NY CA or New York California"
            className="rounded-lg border px-2 py-2 text-sm outline-none"
            style={{
              borderColor: 'var(--color-border-strong)',
              background: 'var(--color-panel-solid)',
              color: 'var(--color-text-primary)',
            }}
          />
          {parsedStates.length ? (
            <span className="text-[10px]" style={{ color: 'var(--color-accent-success)' }}>
              Parsed codes: {parsedStates.join(', ')}
            </span>
          ) : value.geographyText.trim() ? (
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              No two-letter state codes detected yet — spell states as CA, NY, etc.
            </span>
          ) : null}
        </label>
      </div>
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.includeNational}
          onChange={(e) => onChange({ ...value, includeNational: e.target.checked })}
          className="rounded border"
          style={{ borderColor: 'var(--color-border-strong)' }}
        />
        Prefer national baseline in charts when the measure supports it
      </label>
    </div>
  );
}
