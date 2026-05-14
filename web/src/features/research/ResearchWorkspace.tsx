import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ResearchHealthResult } from '@/services/researchApi';
import type { ResearchPhase } from '@/features/research/useResearchSession';
import { ResearchProgressStrip } from '@/features/research/ResearchProgressStrip';
import { ResearchShaderOrb } from '@/features/research/ResearchShaderOrb';
import { useAppShellHex } from '@/lib/useAppShellHex';

type Props = {
  phase: ResearchPhase;
  stepLabel: string;
  health: ResearchHealthResult | null;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onClear: () => void;
  clarificationSlot?: ReactNode;
  resultsSlot?: ReactNode;
  footer: ReactNode;
};

export function ResearchWorkspace({
  phase,
  stepLabel,
  health,
  busy,
  error,
  onRetry,
  onClear,
  clarificationSlot,
  resultsSlot,
  footer,
}: Props) {
  const reduceMotion = useReducedMotion();
  const orbBg = useAppShellHex();
  const dimOrb = Boolean(clarificationSlot) || phase === 'awaiting_clarification';
  const complete = phase === 'done';
  const thinking = busy && !dimOrb;

  return (
    <motion.div
      layout
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`relative flex w-full max-w-full min-w-0 flex-col overflow-hidden rounded-[var(--radius-frame)] border ${
        complete ? 'min-h-0' : 'min-h-[min(72vh,560px)]'
      }`}
      style={{
        borderColor: 'var(--color-border-strong)',
        background: 'var(--color-panel-solid)',
        boxShadow: 'var(--shadow-lifted, 0 16px 50px rgba(5, 12, 28, 0.22))',
      }}
    >
        <div className="relative z-10 flex min-h-0 w-full min-w-0 flex-1 flex-col px-4 pb-4 pt-5 md:px-6 md:pt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {health ? (
            <p className="text-[10px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
              {health.ollama_configured ? 'CORE - Qualis v1.0 · available' : 'Grounded narrative · offline (stub)'}
            </p>
          ) : (
            <span />
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center gap-5">
          <div className={`relative mx-auto aspect-square w-full max-w-[min(100%,220px)] ${complete ? 'max-w-[160px]' : ''}`}>
            <ResearchShaderOrb
              thinking={thinking}
              dimmed={dimOrb}
              reduceMotion={Boolean(reduceMotion)}
              backgroundColor={orbBg}
              rotateOnHover={false}
              className="rounded-full"
            />
          </div>

          <ResearchProgressStrip phase={phase} stepLabel={stepLabel} />

          {resultsSlot ? (
            <motion.div
              layout
              initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="w-full space-y-3"
            >
              <div className="h-px w-full" style={{ background: 'var(--color-border)' }} />
              {resultsSlot}
            </motion.div>
          ) : null}
        </div>

        {error ? (
          <div
            className="relative z-10 mt-4 w-full min-w-0 max-w-full rounded-xl border px-4 py-3 text-left text-sm shadow-sm"
            style={{
              borderColor: 'var(--color-accent-danger)',
              background: 'var(--color-panel-alt)',
              color: 'var(--color-text-primary)',
            }}
          >
            <p style={{ color: 'var(--color-accent-danger)' }}>{error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onRetry}
                className="rounded-full border px-4 py-2 text-xs font-semibold"
                style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-accent-blue)', color: '#fff' }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={onClear}
                className="rounded-full border px-4 py-2 text-xs font-medium"
                style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
              >
                Clear
              </button>
            </div>
          </div>
        ) : null}

        {clarificationSlot ? (
          <div className="relative z-10 mt-4 w-full min-w-0 max-w-full">{clarificationSlot}</div>
        ) : null}

        <div className="relative z-10 mt-5 w-full min-w-0 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          {footer}
        </div>
      </div>
    </motion.div>
  );
}
