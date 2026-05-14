import { useEffect, useState } from 'react';
import { displayStateName } from '@/lib/researchDisplay';
import { fetchLocationLabels } from '@/services/locationLabels';
import type { ResearchPlanModel } from '@/services/researchApi';

type Props = {
  plan: ResearchPlanModel | null;
  resolutionNotes: string[];
};

/** Shows server-resolved measures/hospitals with human-readable labels. */
export function ResolvedPicksPanel({ plan, resolutionNotes }: Props) {
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!plan) {
      setLabels({});
      return;
    }
    const toks = [
      ...plan.states.map((s) => `S:${String(s).trim().toUpperCase().slice(0, 2)}`),
      ...plan.hospital_tokens,
    ];
    let cancelled = false;
    void fetchLocationLabels(toks).then((r) => {
      if (!cancelled) setLabels(r.labels);
    });
    return () => {
      cancelled = true;
    };
  }, [plan]);

  if (!plan) return null;

  const hasPicks =
    plan.measure_ids.length > 0 ||
    plan.hospital_tokens.length > 0 ||
    plan.metric_search_queries.length > 0 ||
    plan.clinical_themes.length > 0;

  if (!hasPicks && !resolutionNotes.length) return null;

  return (
    <div
      className="rounded-xl border p-4 text-left text-sm"
      style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-panel-alt)' }}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-accent-cyan)' }}>
        Resolved picks
      </p>
      {plan.clinical_themes.length ? (
        <div className="mt-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>
            Themes
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {plan.clinical_themes.map((t) => (
              <span key={t} className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--color-border)' }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {plan.metric_search_queries.length ? (
        <div className="mt-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>
            Metric queries used
          </span>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {plan.metric_search_queries.join(' · ')}
          </p>
        </div>
      ) : null}
      <p className="mt-2 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Hospital selection mode: <span className="font-mono">{plan.hospital_selection}</span> · focus:{' '}
        <span className="font-mono">{plan.compare_focus}</span>
      </p>
      {plan.states.length ? (
        <div className="mt-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>
            States
          </span>
          <ul className="mt-1 space-y-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {plan.states.map((s) => {
              const tok = `S:${String(s).trim().toUpperCase().slice(0, 2)}`;
              const api = labels[tok];
              return (
                <li key={s} title={tok}>
                  {api ? api.replace(/\s*\(state\)\s*$/i, '').trim() : displayStateName(s)}
                  <span className="ml-1 font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    ({String(s).trim().toUpperCase().slice(0, 2)})
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {plan.measure_ids.length ? (
        <div className="mt-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>
            Measures
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {plan.measure_ids.map((m) => (
              <span key={m} className="rounded-full border px-2 py-0.5 font-mono text-xs" style={{ borderColor: 'var(--color-border-strong)' }}>
                {m}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {plan.hospital_tokens.length ? (
        <div className="mt-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>
            Hospitals
          </span>
          <ul className="mt-1 space-y-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {plan.hospital_tokens.map((tok) => (
              <li key={tok}>
                <span>{labels[tok] ?? tok}</span>
                {labels[tok] ? (
                  <span className="ml-1 font-mono text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    ({tok})
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {resolutionNotes.length ? (
        <ul className="mt-3 list-inside list-disc text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {resolutionNotes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
