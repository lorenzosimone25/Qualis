import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ResearchPhase } from '@/features/research/useResearchSession';

type Props = {
  phase: ResearchPhase;
  stepLabel: string;
};

function stepIndex(phase: ResearchPhase): number {
  if (phase === 'planning' || phase === 'awaiting_clarification') return 0;
  if (phase === 'retrieving') return 1;
  if (phase === 'summarizing') return 2;
  if (phase === 'done') return 3;
  return -1;
}

const STEPS = [
  { key: 'plan', label: 'Plan', sub: 'Scope & measures' },
  { key: 'data', label: 'Pull data', sub: 'CMS series' },
  { key: 'write', label: 'Write Insight', sub: 'Report Research-Level Insight' },
] as const;

export const ResearchProgressStrip = memo(function ResearchProgressStrip({ phase, stepLabel }: Props) {
  const reduceMotion = useReducedMotion();
  const idx = stepIndex(phase);
  const idle = phase === 'idle' && idx < 0;
  const done = phase === 'done';

  const statusLine =
    stepLabel ||
    (idle ? 'Run a query to start the pipeline.' : done ? 'Results ready below.' : phase === 'error' ? 'Something went wrong.' : '…');

  return (
    <div className="w-full max-w-full px-1">
      <div className="flex items-start justify-between gap-1 sm:gap-2">
        {STEPS.map((s, i) => {
          const active = idx === i;
          const stepDone = idx > i || idx === 3;
          const dim = idle && !stepDone;
          return (
            <div key={s.key} className="flex min-w-0 flex-1 flex-col items-center">
              <motion.div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold sm:h-10 sm:w-10"
                style={{
                  borderColor: active ? 'var(--color-accent-blue)' : stepDone ? 'var(--color-accent-cyan)' : 'var(--color-border-strong)',
                  background: active || stepDone ? 'var(--color-panel-alt)' : 'var(--color-panel-solid)',
                  color: active ? 'var(--color-accent-cyan)' : stepDone ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
                  boxShadow: active ? '0 0 20px var(--color-map-glow)' : undefined,
                }}
                animate={reduceMotion ? {} : active ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                transition={{ duration: 1.6, repeat: active ? Infinity : 0, ease: 'easeInOut' }}
              >
                {i + 1}
              </motion.div>
              <p
                className="mt-1.5 text-center text-[10px] font-semibold sm:text-xs"
                style={{ color: dim ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)' }}
              >
                {s.label}
              </p>
              <p className="mt-0.5 hidden text-center text-[9px] sm:block" style={{ color: 'var(--color-text-tertiary)' }}>
                {s.sub}
              </p>
            </div>
          );
        })}
      </div>
      <div className="relative mx-auto mt-2 h-0.5 w-full max-w-full rounded-full" style={{ background: 'var(--color-border)' }}>
        <motion.div
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ background: 'var(--color-accent-blue)' }}
          initial={false}
          animate={{
            width: idle ? '8%' : idx <= 0 ? '16%' : idx === 1 ? '50%' : idx === 2 ? '82%' : '100%',
          }}
          transition={{ duration: reduceMotion ? 0.05 : 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <p className="mt-2 text-center text-[11px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        {statusLine}
      </p>
    </div>
  );
});
