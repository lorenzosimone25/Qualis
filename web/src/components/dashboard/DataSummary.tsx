import { useQuery } from '@tanstack/react-query';

import { Sparkles } from 'lucide-react';

import { useMemo, useState } from 'react';

import ReactMarkdown from 'react-markdown';

import remarkGfm from 'remark-gfm';

import { buildSummaryFromSeries, type SummaryBullet } from '@/lib/summaryFromSeries';

import { dashboardInsightQueryKey, fetchDashboardInsight } from '@/services/dashboardInsight';

import { hasLiveApi, useMockDemo } from '@/services/api';

import type { SeriesRow } from '@/types/metric';



type Props = {

  measureId: string;

  locationTokens: string[];

  rows: SeriesRow[];

  interpretation: string;

  hasNational: boolean;

  measureTitle: string;

  /** When false, the LLM insight query does not run (live API only). */

  insightEnabled?: boolean;

};



export function DataSummary({

  measureId,

  locationTokens,

  rows,

  interpretation,

  hasNational,

  measureTitle,

  insightEnabled = true,

}: Props) {

  const mock = useMockDemo();

  const live = hasLiveApi();

  const [detailOpen, setDetailOpen] = useState(false);



  const bullets: SummaryBullet[] = useMemo(

    () => buildSummaryFromSeries(rows, { interpretation, hasNational }),

    [rows, interpretation, hasNational],

  );



  const insightQ = useQuery({

    queryKey: dashboardInsightQueryKey({ measureId, locationTokens, rows }),

    queryFn: () =>

      fetchDashboardInsight({

        measure_id: measureId,

        measure_title: measureTitle,

        interpretation,

        has_national: hasNational,

        location_tokens: locationTokens,

        series_rows: rows,

      }),

    enabled: Boolean(insightEnabled && measureId) && live && !mock && rows.length > 0,

    staleTime: 120_000,

  });



  const showNarrative = live && !mock && rows.length > 0;

  const narrativeMd = insightQ.data?.markdown;

  const narrativeLoading = showNarrative && insightEnabled && insightQ.isLoading;

  const narrativeErr = showNarrative && insightEnabled && insightQ.isError;



  return (

    <section id="analysis-insight" className="scroll-mt-6">

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

                Analysis insight

              </p>

              <h3 className="mt-1 text-lg font-bold tracking-tight md:text-xl" style={{ color: 'var(--color-text-primary)' }}>

                {measureTitle || 'Selected measure'}

              </h3>

              <p className="mt-1 text-xs leading-relaxed md:text-sm" style={{ color: 'var(--color-text-secondary)' }}>

                {showNarrative && narrativeMd

                  ? 'Plain-language summary generated from the same numbers shown in the charts and table—informational only, not medical advice.'

                  : mock || !live

                    ? 'Deterministic statistics from your selection (demo mode or offline). Not medical advice.'

                    : 'Grounded readout tied to the data below. Statistical detail expands for exact figures.'}

              </p>

            </div>

          </div>



          {narrativeLoading ? (

            <div

              className="mt-5 h-28 animate-pulse rounded-xl md:mt-6"

              style={{ background: 'var(--color-panel-alt)' }}

              aria-busy

            />

          ) : null}



          {narrativeErr ? (

            <p className="mt-4 text-sm" style={{ color: 'var(--color-accent-danger)' }}>

              {(insightQ.error as Error).message}

            </p>

          ) : null}



          {showNarrative && narrativeMd && !narrativeLoading ? (

            <article

              className="dashboard-insight-md mt-5 max-w-none md:mt-6 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-[var(--color-text-primary)] [&_li]:my-1 [&_p]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-[var(--color-text-primary)] [&_ul]:my-2"

              style={{ color: 'var(--color-text-secondary)' }}

            >

              <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrativeMd}</ReactMarkdown>

            </article>

          ) : null}



          {!showNarrative ? (

            <ol className="mt-5 space-y-3 md:mt-6">

              {bullets.map((b, i) => (

                <li

                  key={i}

                  className="flex gap-3 rounded-xl border px-3 py-3 text-sm leading-relaxed md:px-4"

                  style={{

                    borderColor: 'var(--color-border)',

                    background: 'var(--color-panel-alt)',

                    color: 'var(--color-text-secondary)',

                  }}

                >

                  <span

                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums"

                    style={{

                      background: 'var(--color-panel-solid)',

                      color: 'var(--color-accent-blue)',

                      border: '1px solid var(--color-border-strong)',

                    }}

                  >

                    {i + 1}

                  </span>

                  <span className="min-w-0 pt-0.5">{b.text}</span>

                </li>

              ))}

            </ol>

          ) : (

            <div className="mt-6 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>

              <button

                type="button"

                onClick={() => setDetailOpen((o) => !o)}

                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide transition-opacity hover:opacity-90"

                style={{ color: 'var(--color-accent-blue)', background: 'var(--color-panel-alt)' }}

                aria-expanded={detailOpen}

              >

                Statistical detail

                <span className="tabular-nums">{detailOpen ? '−' : '+'}</span>

              </button>

              {detailOpen ? (

                <ol className="mt-4 space-y-3">

                  {bullets.map((b, i) => (

                    <li

                      key={i}

                      className="flex gap-3 rounded-xl border px-3 py-3 text-sm leading-relaxed md:px-4"

                      style={{

                        borderColor: 'var(--color-border)',

                        background: 'var(--color-panel-alt)',

                        color: 'var(--color-text-secondary)',

                      }}

                    >

                      <span

                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums"

                        style={{

                          background: 'var(--color-panel-solid)',

                          color: 'var(--color-accent-blue)',

                          border: '1px solid var(--color-border-strong)',

                        }}

                      >

                        {i + 1}

                      </span>

                      <span className="min-w-0 pt-0.5">{b.text}</span>

                    </li>

                  ))}

                </ol>

              ) : null}

            </div>

          )}

        </div>

      </div>

    </section>

  );

}

