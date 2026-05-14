/** Shared series colors for measure trend lines and grouped volume bars (theme tokens). Order tuned for max separation across 8+ series. */
export const CHART_SERIES_PALETTE = [
  'var(--color-accent-cyan)',
  'var(--color-accent-magenta)',
  'var(--color-chart-series-amber)',
  'var(--color-accent-blue)',
  'var(--color-chart-series-teal)',
  'var(--color-accent-violet)',
  'var(--color-accent-warning)',
  'var(--color-chart-series-coral)',
  'var(--color-accent-success)',
  'var(--color-accent-danger)',
  'var(--color-chart-series-lime)',
] as const;

const N = CHART_SERIES_PALETTE.length;

export function seriesPaletteColor(index: number): string {
  return CHART_SERIES_PALETTE[((index % N) + N) % N]!;
}

export type PivotKeyMeta = { key: string; label: string; entity_value: string };

export type SeriesSwatch = { key: string; label: string; color: string };

/** Aligns with TrendLineCard: national uses chart national stroke; hospitals cycle the extended palette. */
export function buildSeriesSwatchesForPivotKeys(keys: PivotKeyMeta[]): {
  colorByKey: Record<string, string>;
  legendItems: SeriesSwatch[];
} {
  const colorByKey: Record<string, string> = {};
  const legendItems: SeriesSwatch[] = [];
  let pal = 0;
  for (const k of keys) {
    const isNat = k.entity_value === '__NATIONAL__';
    const color = isNat ? 'var(--color-chart-national-stroke)' : seriesPaletteColor(pal++);
    colorByKey[k.key] = color;
    legendItems.push({ key: k.key, label: k.label, color });
  }
  return { colorByKey, legendItems };
}
