import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ClarificationPanel } from '@/features/research/ClarificationPanel';
import { QueryHero } from '@/features/research/QueryHero';
import { ResearchResultsDeck } from '@/features/research/ResearchResultsDeck';
import { ResearchWorkspace } from '@/features/research/ResearchWorkspace';
import { useResearchSession } from '@/features/research/useResearchSession';

export function ResearchAssistantPage() {
  const s = useResearchSession();
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  const heroText = s.baseQuestion.trim() || s.question.trim();
  const heroSpans = s.plan?.plan.highlight_spans ?? [];
  const showExamples = s.phase === 'idle' && !s.plan;

  const busyPipeline = s.phase === 'planning' || s.phase === 'retrieving' || s.phase === 'summarizing';

  const clarification =
    s.phase === 'awaiting_clarification' && s.plan ? (
      <ClarificationPanel
        questions={s.plan.plan.clarifying_questions}
        reply={s.clarifyReply}
        busy={s.busyPlanning}
        onReplyChange={s.setClarifyReply}
        onSubmit={() => void s.continueAfterClarification()}
        onPickChip={(text) => s.setClarifyReply(text)}
        resolutionNotes={s.plan.resolution_notes}
      />
    ) : undefined;

  const resultsSlot =
    s.phase === 'done' && s.plan ? (
      <ResearchResultsDeck plan={s.plan} retrieval={s.retrieval} summary={s.summary} userQuestion={heroText} />
    ) : undefined;

  const idleLanding = s.phase === 'idle' && !s.plan;

  return (
    <div className="flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-3 md:gap-5">
      <header className="flex w-full min-w-0 flex-col gap-2 text-left sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
            Research
          </p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight md:text-2xl" style={{ color: 'var(--color-text-primary)' }}>
            Curiosity in analytics can drive research insights
          </h1>
          <button
            type="button"
            onClick={() => setHowItWorksOpen((o) => !o)}
            className="mt-2 flex items-center gap-1.5 text-left text-xs font-medium"
            style={{ color: 'var(--color-accent-cyan)' }}
          >
            {howItWorksOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            How it works
          </button>
          {howItWorksOpen ? (
            <p className="mt-2 max-w-2xl text-xs leading-relaxed md:text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              The assistant plans your question, pulls CMS quality series for the chosen scope, and writes a summary using only
              retrieved values.
            </p>
          ) : null}
        </div>
        {s.health && idleLanding ? (
          <div
            className="shrink-0 self-start rounded-full border px-3 py-1 text-[10px] font-medium"
            style={{
              borderColor: 'var(--color-border-strong)',
              background: 'var(--color-panel-alt)',
              color: s.health.ollama_configured ? 'var(--color-accent-success)' : 'var(--color-text-tertiary)',
            }}
          >
            {s.health.ollama_configured ? 'Narrative on' : 'Narrative off (stub)'}
          </div>
        ) : null}
      </header>

      <ResearchWorkspace
        phase={s.phase}
        stepLabel={s.stepLabel}
        health={s.health}
        busy={busyPipeline}
        error={s.err}
        onRetry={() => void s.runAnalysis()}
        onClear={s.clearAll}
        clarificationSlot={clarification}
        resultsSlot={resultsSlot}
        footer={
          <div className="flex w-full min-w-0 flex-col gap-4">
            <QueryHero
              heroText={heroText}
              draftQuestion={s.question}
              displayHighlights={heroSpans}
              disableRun={s.phase === 'awaiting_clarification'}
              busy={s.busyPipeline}
              onDraftChange={s.setQuestion}
              onRun={() => void s.runAnalysis()}
              onClear={s.clearAll}
              onPickExample={(ex) => s.setQuestion(ex)}
              showExamples={showExamples}
              variant={idleLanding ? 'glass' : 'compact'}
              showHeroEcho={s.phase !== 'done'}
            />
          </div>
        }
      />
    </div>
  );
}
