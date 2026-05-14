/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        canvas: 'var(--color-bg-canvas)',
        shell: 'var(--color-app-shell)',
        'shell-2': 'var(--color-app-shell-2)',
        panel: 'var(--color-panel)',
        'panel-solid': 'var(--color-panel-solid)',
        'panel-alt': 'var(--color-panel-alt)',
        border: 'var(--color-border)',
        'border-strong': 'var(--color-border-strong)',
        ink: 'var(--color-text-primary)',
        'ink-secondary': 'var(--color-text-secondary)',
        'ink-tertiary': 'var(--color-text-tertiary)',
        brand: {
          blue: 'var(--color-accent-blue)',
          cyan: 'var(--color-accent-cyan)',
          violet: 'var(--color-accent-violet)',
          magenta: 'var(--color-accent-magenta)',
          success: 'var(--color-accent-success)',
          warning: 'var(--color-accent-warning)',
          danger: 'var(--color-accent-danger)',
        },
        map: {
          base: 'var(--color-map-base)',
          cell: 'var(--color-map-cell)',
          selected: 'var(--color-map-selected)',
        },
        navy: {
          950: '#050b14',
          900: '#0a192f',
          850: '#0d2138',
          800: '#112840',
        },
        accent: {
          cyan: '#22d3ee',
          teal: '#2dd4bf',
          muted: '#64748b',
        },
      },
      boxShadow: {
        glow: '0 0 24px rgba(34, 211, 238, 0.15)',
      },
    },
  },
  plugins: [],
};
