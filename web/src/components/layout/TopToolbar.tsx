import { Moon, Sun } from 'lucide-react';
import { useDashboardUi } from '@/context/DashboardUiContext';

type Props = {
  title: string;
  subtitle: string;
};

export function TopToolbar({ title, subtitle }: Props) {
  const { theme, toggleTheme } = useDashboardUi();

  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
      <div className="text-left">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          {title}
        </h1>
        <p className="mt-1 text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {subtitle}
        </p>
      </div>
      <button
        type="button"
        onClick={toggleTheme}
        className="flex h-10 w-10 items-center justify-center rounded-xl border transition-opacity hover:opacity-90"
        style={{
          borderColor: 'var(--color-border-strong)',
          background: 'var(--color-panel-solid)',
          color: 'var(--color-text-primary)',
        }}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </header>
  );
}
