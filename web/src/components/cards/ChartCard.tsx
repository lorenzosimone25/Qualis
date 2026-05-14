import type { ReactNode } from 'react';

type Props = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Stretch to parent height (use inside a grid/flex row with explicit min-height). */
  fillHeight?: boolean;
};

export function ChartCard({ title, subtitle, action, children, footer, className = '', fillHeight = false }: Props) {
  return (
    <section
      className={`flex flex-col rounded-2xl border p-4 ${fillHeight ? 'h-full min-h-0' : ''} ${className}`}
      style={{
        borderColor: 'var(--color-border-strong)',
        background: 'var(--color-panel)',
        boxShadow: 'var(--shadow-panel)',
        backdropFilter: 'var(--glass-blur)',
      }}
    >
      <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-2">
        <div className="text-left">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        {action}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer ? (
        <div className="mt-3 shrink-0 border-t pt-3 text-left text-xs" style={{ borderColor: 'var(--color-border)' }}>
          {footer}
        </div>
      ) : null}
    </section>
  );
}
