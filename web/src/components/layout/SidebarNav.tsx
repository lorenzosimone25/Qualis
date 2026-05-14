import { HeartPulse, LayoutDashboard, Moon, Sparkles, Sun, History, Map,  Hospital, } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { BRANDING } from '@/config/branding';
import { useDashboardUi } from '@/context/DashboardUiContext';

const PRIMARY = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/research', label: 'Research', icon: Sparkles, end: false },
] as const;

const SECONDARY = [
  { id: 'your-searches', label: 'Your searches', icon: History, disabled: true },
  { id: 'states', label: 'States', icon: Map, disabled: true },
  { id: 'hospitals', label: 'Hospitals', icon: Hospital, disabled: true },
] as const;

export function SidebarNav() {
  const { theme, toggleTheme } = useDashboardUi();

  return (
    <aside
      className="flex w-[220px] shrink-0 flex-col"
      style={{
        padding: '24px 18px',
        background: 'var(--color-app-shell-2)',
      }}
    >
      <div className="mb-8 flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: 'linear-gradient(135deg, var(--color-accent-violet), var(--color-accent-blue))',
            boxShadow: '0 0 20px var(--color-map-glow)',
          }}
        >
          <HeartPulse className="h-5 w-5 text-white" aria-hidden />
        </div>

        <div className="min-w-0 text-left">
          <p
            className="text-base font-bold leading-tight tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {BRANDING.appTitle}
          </p>
          <p
            className="mt-0.5 text-[11px] font-medium leading-snug"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            CORE Hospital Analytics
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <nav className="flex flex-col gap-0.5" aria-label="Primary">
          {PRIMARY.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors duration-[var(--motion-fast)]"
                style={({ isActive }) => ({
                  color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                  background: isActive ? 'var(--color-panel-alt)' : 'transparent',
                  border: isActive ? '1px solid var(--color-border-strong)' : '1px solid transparent',
                  boxShadow: isActive ? '0 0 24px var(--color-map-glow)' : undefined,
                })}
              >
                <Icon className="h-[18px] w-[18px] shrink-0 opacity-90" aria-hidden />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-5">
          <p
            className="mb-2 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Coming soon
          </p>

          <nav className="flex flex-col gap-0.5 opacity-50" aria-label="Secondary">
            {SECONDARY.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.disabled}
                  className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto shrink-0 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
          <p
            className="mb-2 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Appearance
          </p>

          <button
            type="button"
            onClick={toggleTheme}
            className="flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-opacity hover:opacity-90"
            style={{
              borderColor: 'var(--color-border-strong)',
              background: 'var(--color-panel-solid)',
              color: 'var(--color-text-primary)',
            }}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? (
              <Sun className="h-[18px] w-[18px] shrink-0" aria-hidden />
            ) : (
              <Moon className="h-[18px] w-[18px] shrink-0" aria-hidden />
            )}
            {theme === 'dark' ? 'Clinical daylight' : 'Aurora night'}
          </button>
        </div>
      </div>
    </aside>
  );
}