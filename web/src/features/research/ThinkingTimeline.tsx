import { motion } from 'framer-motion';
import type { PlanningEvent } from '@/services/researchApi';

type Props = {
  events: PlanningEvent[];
};

export function ThinkingTimeline({ events }: Props) {
  if (!events.length) {
    return (
      <div className="hidden text-[10px] md:block" style={{ color: 'var(--color-text-tertiary)' }}>
        <p className="rotate-180 text-center [writing-mode:vertical-rl]">Timeline</p>
      </div>
    );
  }

  return (
    <aside className="hidden min-h-0 flex-col md:flex" aria-label="Planning timeline">
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
        Thinking
      </p>
      <ol className="relative flex flex-1 flex-col gap-3 pl-4">
        <span
          className="absolute bottom-1 left-[7px] top-1 w-px"
          style={{ background: 'var(--color-border-strong)' }}
          aria-hidden
        />
        {events.map((ev, i) => (
          <motion.li
            key={`${ev.id}-${i}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.25 }}
            className="relative text-left"
          >
            <span
              className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full border"
              style={{
                borderColor: 'var(--color-accent-blue)',
                background: 'var(--color-panel-solid)',
                boxShadow: '0 0 8px var(--color-map-glow)',
              }}
            />
            <p className="text-[11px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {ev.label}
            </p>
            <p className="mt-0.5 text-[10px] leading-snug" style={{ color: 'var(--color-text-tertiary)' }}>
              {ev.detail}
            </p>
          </motion.li>
        ))}
      </ol>
    </aside>
  );
}
