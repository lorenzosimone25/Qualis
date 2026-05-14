import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { GroundedSummaryPanel } from '@/features/research/GroundedSummaryPanel';
import { ResearchEvidencePlanPanel } from '@/features/research/ResearchEvidencePlanPanel';
import { ResolvedPicksPanel } from '@/features/research/ResolvedPicksPanel';
import { ResultsCanvas } from '@/features/research/ResultsCanvas';
import { planLocationTokens } from '@/lib/researchDisplay';
import { fetchLocationLabels } from '@/services/locationLabels';
import { getResearchMetricCatalog } from '@/services/researchApi';
import type { ResearchPlanResult, ResearchRetrieveResult, ResearchSummaryResult } from '@/services/researchApi';

type TabId = 'overview' | 'charts' | 'scope' | 'debug';

type Props = {
  plan: ResearchPlanResult;
  retrieval: ResearchRetrieveResult | null;
  summary: ResearchSummaryResult | null;
  userQuestion: string;
};

const sectionShell =
  'rounded-[var(--radius-frame)] border p-4 text-left md:p-5 scroll-mt-[72px]' as const;

const debugAllowed = import.meta.env.DEV || import.meta.env.VITE_RESEARCH_DEBUG === 'true';

export function ResearchResultsDeck({ plan, retrieval, summary, userQuestion }: Props) {
  const [traceOpen, setTraceOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');
  const [locationLabels, setLocationLabels] = useState<Record<string, string>>({});
  const [measureTitles, setMeasureTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!debugAllowed && tab === 'debug') setTab('overview');
  }, [debugAllowed, tab]);

  const locToks = useMemo(() => {
    const base = planLocationTokens(plan.plan);
    const extra = (retrieval?.metric_evidence ?? []).flatMap((e) => e.location_tokens ?? []);
    return [...new Set([...base, ...extra])];
  }, [plan.plan, retrieval?.metric_evidence]);

  useEffect(() => {
    if (!locToks.length) {
      setLocationLabels({});
      return;
    }
    let cancelled = false;
    void fetchLocationLabels(locToks).then((r) => {
      if (!cancelled) setLocationLabels(r.labels);
    });
    return () => {
      cancelled = true;
    };
  }, [locToks]);

  useEffect(() => {
    const ids = new Set(plan.plan.measure_ids);
    if (!ids.size) {
      setMeasureTitles({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const map: Record<string, string> = {};
      try {
        const cat = await getResearchMetricCatalog({ limit: 500 });
        for (const it of cat.items) {
          if (ids.has(it.measure_id)) map[it.measure_id] = it.title;
        }
      } catch {
        /* keep empty map */
      }
      if (!cancelled) setMeasureTitles(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [plan.plan.measure_ids.join('\n')]);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'charts', label: 'Charts' },
    { id: 'scope', label: 'Plan details' },
    ...(debugAllowed ? [{ id: 'debug' as TabId, label: 'Debug' }] : []),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ResearchEvidencePlanPanel plan={plan} retrieval={retrieval} userQuestion={userQuestion} />

      <div
        className="rounded-[var(--radius-frame)] border px-4 py-3 md:px-5"
        style={{
          borderColor: 'var(--color-border-strong)',
          background: 'var(--color-panel-solid)',
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight md:text-xl" style={{ color: 'var(--color-text-primary)' }}>
              Research report
            </h2>
            <p className="mt-1 text-xs md:text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Only measures and values in this report are cited. The narrative is grounded on the retrieval snapshot.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setTraceOpen((o) => !o)}
          className="mt-3 flex items-center gap-2 text-left text-xs font-medium"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {traceOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          Trace ID
        </button>
        {traceOpen ? (
          <p className="mt-1 break-all font-mono text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            {plan.trace_id}
          </p>
        ) : null}

        <nav
          className="sticky top-0 z-[1] -mx-4 mt-4 flex flex-wrap gap-1 border-b px-4 pb-2 pt-1 md:-mx-5 md:px-5"
          style={{
            background: 'var(--color-panel-solid)',
            borderColor: 'var(--color-border)',
          }}
          aria-label="Report sections"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{
                background: tab === t.id ? 'var(--color-accent-blue)' : 'var(--color-panel-alt)',
                color: tab === t.id ? '#fff' : 'var(--color-text-secondary)',
                border: '1px solid',
                borderColor: tab === t.id ? 'transparent' : 'var(--color-border-strong)',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'overview' ? (
        <section
          id="report-overview"
          className={sectionShell}
          style={{
            borderColor: 'var(--color-border-strong)',
            background: 'linear-gradient(165deg, var(--color-panel) 0%, var(--color-panel-solid) 100%)',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          {summary ? (
            <GroundedSummaryPanel
              plan={plan.plan}
              retrieval={retrieval}
              summary={summary}
              locationLabels={locationLabels}
              measureTitles={measureTitles}
            />
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              No summary in this run. Try again after enabling grounded narrative on the server.
            </p>
          )}
        </section>
      ) : null}

      {tab === 'charts' ? (
        <section
          id="report-charts"
          className={sectionShell}
          style={{
            borderColor: 'var(--color-border-strong)',
            background: 'linear-gradient(165deg, var(--color-panel) 0%, var(--color-panel-solid) 100%)',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Charts
          </h3>
          <div className="mt-3">
            <ResultsCanvas
              plan={plan.plan}
              retrieval={retrieval}
              userQuestion={userQuestion}
              measureTitles={measureTitles}
              locationLabels={locationLabels}
            />
          </div>
        </section>
      ) : null}

      {tab === 'scope' ? (
        <section
          id="report-scope"
          className={sectionShell}
          style={{
            borderColor: 'var(--color-border-strong)',
            background: 'linear-gradient(165deg, var(--color-panel) 0%, var(--color-panel-solid) 100%)',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <ResolvedPicksPanel plan={plan.plan} resolutionNotes={plan.resolution_notes ?? []} />
        </section>
      ) : null}

      {tab === 'debug' && debugAllowed ? (
        <section
          id="report-debug"
          className={sectionShell}
          style={{
            borderColor: 'var(--color-border-strong)',
            background: 'linear-gradient(165deg, var(--color-panel) 0%, var(--color-panel-solid) 100%)',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Planner and retrieval debug
          </h3>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Raw planner JSON, effective queries, and server resolution (dev or VITE_RESEARCH_DEBUG=true).
          </p>
          <div className="mt-3 max-h-[min(70vh,720px)] overflow-auto rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
            <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {JSON.stringify(
                {
                  user_question: userQuestion,
                  plan_debug: plan.plan_debug ?? null,
                  planning_events: plan.planning_events,
                  resolution_notes: plan.resolution_notes,
                  resolved_retrieval: plan.resolved_retrieval ?? null,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </section>
      ) : null}
    </div>
  );
}
