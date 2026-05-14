import type { ReactNode } from 'react';

type Props = {
  left: ReactNode;
  timeline: ReactNode;
  right: ReactNode;
};

/** Immersive split layout: session (~38%), thinking rail, analysis canvas. */
export function ResearchSessionLayout({ left, timeline, right }: Props) {
  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.22fr)_minmax(0,1.45fr)] lg:gap-5">
      <div className="min-h-0 min-w-0">{left}</div>
      <div className="hidden min-h-0 min-w-0 lg:block">{timeline}</div>
      <div
        className="flex min-h-0 min-w-0 flex-col gap-4 rounded-2xl border p-4 md:p-5"
        style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-panel-solid)' }}
      >
        {right}
      </div>
    </div>
  );
}
