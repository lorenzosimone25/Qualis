import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { HighlightedQuery } from '@/features/research/HighlightedQuery';
import type { HighlightSpan } from '@/services/researchApi';

const EXAMPLES = [
  'Compare NY and CT hospitals on heart failure mortality',
  'Which readmission measures matter for teaching hospitals in CA?',
  'Explain complications measures for hip and knee replacement',
];

type Props = {
  /** Shown in the hero card (typically the last submitted question). */
  heroText: string;
  /** Controlled draft in the textarea. */
  draftQuestion: string;
  displayHighlights: HighlightSpan[];
  /** When true, primary run is disabled (e.g. awaiting clarification — use Continue instead). */
  disableRun: boolean;
  busy: boolean;
  onDraftChange: (v: string) => void;
  onRun: () => void;
  onClear: () => void;
  onPickExample: (ex: string) => void;
  showExamples: boolean;
  /** Tighter strip when shown above results */
  variant?: 'default' | 'glass' | 'compact';
  /** When false, hide the read-only hero echo (e.g. after a completed run). */
  showHeroEcho?: boolean;
};

export function QueryHero({
  heroText,
  draftQuestion,
  displayHighlights,
  disableRun,
  busy,
  onDraftChange,
  onRun,
  onClear,
  onPickExample,
  showExamples,
  variant = 'default',
  showHeroEcho = true,
}: Props) {
  const glass = variant === 'glass' || variant === 'compact';
  const compact = variant === 'compact';
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {showHeroEcho ? (
        <div
          className={`rounded-2xl border ${compact ? 'p-3 md:p-4' : 'p-4 md:p-5'}`}
          style={{
            borderColor: 'var(--color-border-strong)',
            background: glass
              ? 'linear-gradient(165deg, var(--color-panel) 0%, var(--color-panel-solid) 100%)'
              : 'linear-gradient(165deg, var(--color-panel) 0%, var(--color-panel-solid) 100%)',
            backdropFilter: glass ? 'var(--glass-blur)' : undefined,
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
            Your question
          </p>
          {heroText.trim() ? (
            <div className="mt-3">
              <HighlightedQuery text={heroText.trim()} spans={displayHighlights} />
            </div>
          ) : (
            <p className="mt-3 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              Your question will appear here with highlighted geography and clinical terms.
            </p>
          )}
        </div>
      ) : null}

      <label
        className={`text-left text-xs font-medium ${showHeroEcho ? (compact ? 'mt-2' : 'mt-4') : 'mt-1'}`}
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        {compact ? 'New question' : 'Edit question'}
      </label>
      <textarea
        value={draftQuestion}
        onChange={(e) => onDraftChange(e.target.value)}
        rows={compact ? 3 : 4}
        placeholder="e.g. Compare hospitals in New York and Connecticut on heart failure mortality…"
        className="mt-2 w-full resize-y rounded-xl border px-3 py-2 text-sm outline-none"
        style={{
          borderColor: 'var(--color-border-strong)',
          background: 'var(--color-panel-solid)',
          color: 'var(--color-text-primary)',
        }}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disableRun || busy || !draftQuestion.trim()}
          onClick={onRun}
          className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: 'var(--color-border-strong)',
            background: 'linear-gradient(135deg, var(--color-accent-blue), var(--color-accent-violet))',
            color: '#fff',
          }}
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {busy ? 'Working…' : 'Run analysis'}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border px-4 py-2 text-sm font-medium"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
        >
          Clear
        </button>
      </div>

      <div
        className="mt-4 rounded-xl border px-3 py-2 text-[11px] leading-relaxed"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', background: 'var(--color-panel-alt)' }}
      >
        Only measures and values returned in the analysis canvas are cited. The summary is grounded on the retrieval
        snapshot only.
      </div>

      {showExamples && !compact ? (
        <div className="mt-6 text-left">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
            Try an example
          </p>
          <ul className="mt-2 space-y-2">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  className="text-left text-sm underline-offset-2 hover:underline"
                  style={{ color: 'var(--color-accent-cyan)' }}
                  onClick={() => onPickExample(ex)}
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
            See <Link to="/" className="underline">Dashboard</Link> for the classic measure-first workflow.
          </p>
        </div>
      ) : null}
    </div>
  );
}
