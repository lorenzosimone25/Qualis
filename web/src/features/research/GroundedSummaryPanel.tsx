import { useMemo, type ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sparkles } from 'lucide-react';
import { humanGeographySummary } from '@/lib/researchDisplay';
import type { ResearchPlanModel, ResearchRetrieveResult, ResearchSummaryResult } from '@/services/researchApi';

type Props = {
  plan: ResearchPlanModel | null;
  retrieval: ResearchRetrieveResult | null;
  summary: ResearchSummaryResult;
  locationLabels?: Record<string, string>;
  measureTitles?: Record<string, string>;
};

function yearSpan(rows: { year?: number }[]): string | null {
  const ys = rows.map((r) => r.year).filter((y): y is number => typeof y === 'number' && Number.isFinite(y));
  if (!ys.length) return null;
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

export function GroundedSummaryPanel({
  plan,
  retrieval,
  summary,
  locationLabels = {},
  measureTitles = {},
}: Props) {
  const headerBits = useMemo(() => {
    const mids = retrieval ? Object.keys(retrieval.series_by_measure) : plan?.measure_ids ?? [];
    const locLabel = plan ? humanGeographySummary(plan, locationLabels) : 'locations TBD';
    let ySpan: string | null = null;
    if (retrieval?.series_by_measure) {
      const allRows = Object.values(retrieval.series_by_measure).flatMap((b) => b.rows ?? []);
      ySpan = yearSpan(allRows as { year?: number }[]);
    }
    const measureLine = mids
      .map((id) => measureTitles[id] ?? id)
      .filter(Boolean)
      .join(' · ');
    return { mids, locLabel, ySpan, measureLine };
  }, [plan, retrieval, locationLabels, measureTitles]);

  const mdComponents = useMemo(
    () => ({
      h1: ({ ...props }: ComponentProps<'h1'>) => (
        <h1 className="mb-3 mt-6 text-xl font-bold first:mt-0" style={{ color: 'var(--color-text-primary)' }} {...props} />
      ),
      h2: ({ ...props }: ComponentProps<'h2'>) => (
        <h2 className="mb-2 mt-5 text-lg font-bold first:mt-0" style={{ color: 'var(--color-text-primary)' }} {...props} />
      ),
      h3: ({ ...props }: ComponentProps<'h3'>) => (
        <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0" style={{ color: 'var(--color-text-primary)' }} {...props} />
      ),
      p: ({ ...props }: React.ComponentProps<'p'>) => (
        <p className="mb-3 text-sm leading-relaxed last:mb-0" style={{ color: 'var(--color-text-secondary)' }} {...props} />
      ),
      ul: ({ ...props }: ComponentProps<'ul'>) => (
        <ul className="mb-3 list-disc space-y-1.5 pl-5 text-sm" style={{ color: 'var(--color-text-secondary)' }} {...props} />
      ),
      ol: ({ ...props }: ComponentProps<'ol'>) => (
        <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm" style={{ color: 'var(--color-text-secondary)' }} {...props} />
      ),
      li: ({ ...props }: ComponentProps<'li'>) => <li className="leading-relaxed" {...props} />,
      strong: ({ ...props }: ComponentProps<'strong'>) => (
        <strong className="font-semibold" style={{ color: 'var(--color-text-primary)' }} {...props} />
      ),
      a: ({ ...props }: React.ComponentProps<'a'>) => (
        <a className="underline underline-offset-2" style={{ color: 'var(--color-accent-cyan)' }} {...props} />
      ),
      blockquote: ({ ...props }: ComponentProps<'blockquote'>) => (
        <blockquote
          className="my-3 border-l-4 py-1 pl-4 text-sm italic"
          style={{ borderColor: 'var(--color-accent-warning)', color: 'var(--color-text-secondary)' }}
          {...props}
        />
      ),
      table: ({ ...props }: ComponentProps<'table'>) => (
        <div className="my-3 overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border-strong)' }}>
          <table className="w-full min-w-[280px] border-collapse text-left text-xs" {...props} />
        </div>
      ),
      th: ({ ...props }: React.ComponentProps<'th'>) => (
        <th
          className="border-b px-3 py-2 font-semibold"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-alt)', color: 'var(--color-text-primary)' }}
          {...props}
        />
      ),
      td: ({ ...props }: ComponentProps<'td'>) => (
        <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }} {...props} />
      ),
      pre: ({ children, ...props }: ComponentProps<'pre'>) => (
        <pre
          className="my-2 overflow-x-auto rounded-lg p-3 font-mono text-[11px]"
          style={{ background: 'var(--color-panel-alt)', color: 'var(--color-accent-cyan)' }}
          {...props}
        >
          {children}
        </pre>
      ),
      code: ({ className, children, ...props }: ComponentProps<'code'>) => {
        const isBlock = Boolean(className?.includes('language-'));
        if (isBlock) {
          return (
            <code className={`font-mono text-[11px] ${className ?? ''}`} {...props}>
              {children}
            </code>
          );
        }
        return (
          <code
            className="rounded px-1 py-0.5 font-mono text-[11px]"
            style={{ background: 'var(--color-panel-alt)', color: 'var(--color-accent-cyan)' }}
            {...props}
          >
            {children}
          </code>
        );
      },
    }),
    [],
  );

  return (
    <section className="scroll-mt-4">
      <div
        className="rounded-[22px] p-[1px]"
        style={{
          background: 'linear-gradient(135deg, var(--color-accent-cyan), var(--color-accent-violet) 45%, var(--color-accent-blue))',
          boxShadow: '0 12px 40px var(--color-map-glow)',
        }}
      >
        <div
          className="rounded-[21px] px-5 py-5 text-left md:px-7 md:py-6"
          style={{
            background: 'linear-gradient(165deg, var(--color-app-shell-2) 0%, var(--color-panel-solid) 55%, var(--color-app-shell-2) 100%)',
          }}
        >
          <div className="flex flex-wrap items-start gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
              style={{
                background: 'linear-gradient(135deg, var(--color-accent-blue), var(--color-accent-violet))',
                boxShadow: '0 0 20px var(--color-map-glow)',
              }}
            >
              <Sparkles className="h-5 w-5 text-white" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--color-accent-cyan)' }}>
                Grounded on retrieval
              </p>
              <p className="mt-1 text-xs leading-relaxed md:text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  Measures:{' '}
                </span>
                {headerBits.measureLine || '—'}
                <br />
                <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                  Location scope:{' '}
                </span>
                {headerBits.locLabel}
                {headerBits.ySpan ? (
                  <>
                    <br />
                    <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                      Years in data:{' '}
                    </span>
                    {headerBits.ySpan}
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <div className="mt-5 max-w-none md:mt-6 [&_.markdown-body]:max-w-none">
            {summary.evidence && (summary.evidence.title || summary.evidence.abstract) ? (
              <div className="mb-6 rounded-xl border px-4 py-3 md:px-5" style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-panel-alt)' }}>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--color-accent-cyan)' }}>
                  Evidence panel
                </p>
                {summary.evidence.title ? (
                  <h2 className="mt-2 text-lg font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
                    {summary.evidence.title}
                  </h2>
                ) : null}
                {summary.evidence.abstract ? (
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    {summary.evidence.abstract}
                  </p>
                ) : null}
                {summary.evidence.key_findings?.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {summary.evidence.key_findings.map((k, i) => (
                      <li key={i}>{k}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {summary.markdown}
            </ReactMarkdown>
          </div>
          {summary.citations.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="w-full text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                Citations
              </span>
              {summary.citations.map((c) => (
                <span
                  key={c}
                  className="rounded-full border px-2.5 py-1 text-[11px] font-medium"
                  style={{
                    borderColor: 'var(--color-border-strong)',
                    background: 'var(--color-panel-alt)',
                    color: 'var(--color-accent-cyan)',
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
