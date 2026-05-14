import type { ReactNode } from 'react';
import { SidebarNav } from '@/components/layout/SidebarNav';

type Props = {
  children: ReactNode;
};

export function AppShell({ children }: Props) {
  return (
    <div
      className="min-h-svh px-4 py-6 md:px-7 md:py-7"
      style={{
        background: 'var(--color-bg-canvas)',
        color: 'var(--color-text-primary)',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <div
        className="mx-auto flex min-h-[min(920px,calc(100svh-48px))] max-w-[1440px] overflow-hidden rounded-[var(--radius-frame)] border transition-shadow duration-[var(--motion-normal)] ease-[var(--ease-standard)]"
        style={{
          background: 'var(--color-app-shell)',
          borderColor: 'var(--color-border)',
          boxShadow: 'var(--shadow-lifted)',
        }}
      >
        <SidebarNav />
        <div
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
          style={{
            borderLeft: '1px solid var(--color-border)',
            padding: '18px 20px 20px 20px',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
