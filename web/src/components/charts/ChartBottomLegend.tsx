export type ChartLegendItem = { key: string; label: string; color: string };

function truncateLabel(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export type ChartBottomLegendProps = {
  items: ChartLegendItem[];
  /** When set, that row appears pressed and others remain clickable to refocus. */
  focusedKey?: string | null;
  /** Toggle focus: parent typically clears focus when the same key is clicked again. */
  onToggleFocus?: (key: string) => void;
  /** Max characters for legend label before ellipsis (default 36). */
  truncateAt?: number;
};

/** Scrollable swatch legend aligned with trend/volume charts — supports click-to-focus when handlers are passed. */
export function ChartBottomLegend({ items, focusedKey, onToggleFocus, truncateAt = 36 }: ChartBottomLegendProps) {
  const interactive = Boolean(onToggleFocus);

  return (
    <div
      className="mt-2 max-h-28 overflow-y-auto rounded-xl border px-2 py-2"
      style={{ borderColor: 'var(--color-border-strong)', background: 'var(--color-panel-alt)' }}
      role="list"
      aria-label="Series legend"
    >
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {items.map(({ key, label, color }) => {
          const pressed = focusedKey === key;
          const labelEl = (
            <>
              <span className="h-2 w-4 shrink-0 rounded-sm" style={{ background: color }} />
              <span className="min-w-0 truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {truncateLabel(label, truncateAt)}
              </span>
            </>
          );

          if (interactive) {
            return (
              <button
                key={key}
                type="button"
                role="listitem"
                title={label}
                aria-pressed={pressed}
                onClick={() => onToggleFocus!(key)}
                className="flex max-w-[14rem] min-w-0 cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-2 py-1 text-left text-[10px] outline-none transition-all duration-150 hover:-translate-y-px hover:border-[var(--color-border-strong)] hover:bg-[rgba(34,211,238,0.1)] hover:shadow-[0_2px_12px_rgba(34,211,238,0.2)] focus-visible:ring-2 focus-visible:ring-cyan-400/70 active:translate-y-0"
                style={{
                  outline: pressed ? '1px solid var(--color-accent-cyan)' : undefined,
                  background: pressed ? 'color-mix(in srgb, var(--color-accent-cyan) 14%, var(--color-panel-solid))' : undefined,
                  boxShadow: pressed ? '0 0 14px rgba(34, 211, 238, 0.22)' : undefined,
                }}
              >
                {labelEl}
              </button>
            );
          }

          return (
            <div key={key} className="flex max-w-[14rem] min-w-0 items-center gap-1.5 text-[10px]" role="listitem" title={label}>
              {labelEl}
            </div>
          );
        })}
      </div>
    </div>
  );
}
