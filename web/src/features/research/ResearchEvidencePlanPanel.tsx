import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { displayStateName } from '@/lib/researchDisplay';
import type { ResearchPlanResult, ResearchRetrieveResult } from '@/services/researchApi';

type Props = {
  plan: ResearchPlanResult;
  retrieval: ResearchRetrieveResult | null;
  userQuestion: string;
};

export function ResearchEvidencePlanPanel({ plan, retrieval, userQuestion }: Props) {
  const [open, setOpen] = useState(true);
  const p = plan.plan;
  const readiness = retrieval?.readiness;
  const status = readiness?.status ?? '—';
  const cov = readiness?.coverage;
  const intent = (p.retrieval_intent || '').trim() || p.metric_search_queries[0] || userQuestion.slice(0, 120);
  const nat = p.include_national !== false ? 'Included when available' : 'Off';

  return (
    <div
      className="rounded-[var(--radius-frame)] border px-4 py-3 text-left md:px-5"
      style={{
        borderColor: 'var(--color-border-strong)',
        background: 'var(--color-panel)',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Research plan & evidence
        </span>
        {readiness ? (
          <span
            className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{
              background:
                status === 'blocked'
                  ? 'var(--color-accent-danger)'
                  : status === 'thin'
                    ? 'var(--color-accent-cyan)'
                    : 'var(--color-accent-blue)',
              color: '#fff',
            }}
          >
            {status}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="mt-3 space-y-3 text-xs leading-relaxed md:text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <p>
            <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Intent
            </span>
            <br />
            {intent}
          </p>
          <p>
            <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Geography
            </span>
            <br />
            {p.states.length ? p.states.map((s) => displayStateName(s)).join(' · ') : 'Not specified'}
          </p>
          <p>
            <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Metrics selected
            </span>
            <br />
            {p.measure_ids.length} measure{p.measure_ids.length === 1 ? '' : 's'}
            {p.measure_ids.length ? `: ${p.measure_ids.join(', ')}` : ''}
          </p>
          {retrieval?.metric_evidence && retrieval.metric_evidence.length > 0 ? (
            <div>
              <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Hospital strategy (per measure)
              </span>
              <ul className="mt-1 list-inside list-disc space-y-1">
                {retrieval.metric_evidence.map((m) => {
                  const hs = m.hospital_selection;
                  const stateBits = hs?.states_ranked?.length
                    ? hs.states_ranked.map((s) => displayStateName(s)).join(' · ')
                    : hs?.state
                      ? displayStateName(hs.state)
                      : null;
                  const bits = hs
                    ? [
                        hs.mode,
                        hs.sort,
                        hs.limit != null ? `limit ${hs.limit}` : null,
                        stateBits,
                        hs.ranked_measure_id ? `ranked_measure_id ${hs.ranked_measure_id}` : null,
                      ].filter(Boolean)
                    : ['—'];
                  return (
                    <li key={m.measure_id}>
                      <span className="font-mono text-[11px]">{m.measure_id}</span>: {bits.join(' · ')}
                      {m.row_count != null ? ` · ${m.row_count} rows` : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <p>
            <span className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              National baseline
            </span>
            <br />
            {nat}
          </p>
          {readiness?.warnings && readiness.warnings.length > 0 ? (
            <div>
              <span className="font-semibold" style={{ color: 'var(--color-accent-danger)' }}>
                Warnings
              </span>
              <ul className="mt-1 list-inside list-disc">
                {readiness.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {cov ? (
            <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Coverage: {cov.num_rows ?? 0} rows · {cov.num_entities ?? 0} entities ·{' '}
              {Array.isArray(cov.years) && cov.years.length ? `${cov.years[0]}–${cov.years[cov.years.length - 1]}` : 'no years'}
              {cov.missing_geography ? ' · missing geography in plan echo' : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
