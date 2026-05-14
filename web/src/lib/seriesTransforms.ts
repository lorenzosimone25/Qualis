import type { SeriesRow } from '@/types/metric';

export const MAX_CHART_SERIES = 8;

export function slugKey(label: string, entity: string): string {
  return `${entity}_${label}`.replace(/[^\w]+/g, '_').slice(0, 56) || 'series';
}

export function pivotForLine(rows: SeriesRow[]) {
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const pairs = new Map<string, { label: string; entity_value: string }>();
  for (const r of rows) {
    const k = `${r.entity_value}\u0000${r.label}`;
    if (!pairs.has(k)) pairs.set(k, { label: r.label, entity_value: r.entity_value });
  }
  const keys = [...pairs.values()].map(({ label, entity_value }) => ({
    label,
    entity_value,
    key: slugKey(label, entity_value),
  }));

  const data = years.map((year) => {
    const row: Record<string, number | string | null> = { yearLabel: String(year) };
    for (const { label, entity_value, key } of keys) {
      const pt = rows.find(
        (r) => r.year === year && r.label === label && r.entity_value === entity_value,
      );
      row[key] = pt?.value ?? null;
    }
    return row;
  });

  return { data, keys };
}

export function latestPerSeries(rows: SeriesRow[]): SeriesRow[] {
  const m = new Map<string, SeriesRow>();
  for (const r of rows) {
    const k = `${r.entity_value}\u0000${r.label}`;
    const cur = m.get(k);
    if (!cur || r.year > cur.year) m.set(k, r);
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function maxDistinctYearsPerSeries(rows: SeriesRow[]): number {
  const ys = new Map<string, Set<number>>();
  for (const r of rows) {
    const k = `${r.entity_value}\u0000${r.label}`;
    if (!ys.has(k)) ys.set(k, new Set());
    ys.get(k)!.add(r.year);
  }
  let max = 0;
  for (const s of ys.values()) max = Math.max(max, s.size);
  return max;
}

/** Keep only the first N series (stable order by label) for chart readability. */
export function capRowsForChart(rows: SeriesRow[], maxSeries: number): {
  rows: SeriesRow[];
  totalSeries: number;
  capped: boolean;
} {
  const latest = latestPerSeries(rows);
  const totalSeries = latest.length;
  if (totalSeries <= maxSeries) return { rows, totalSeries, capped: false };
  const keep = new Set(
    latest
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, maxSeries)
      .map((r) => `${r.entity_value}\u0000${r.label}`),
  );
  const filtered = rows.filter((r) => keep.has(`${r.entity_value}\u0000${r.label}`));
  return { rows: filtered, totalSeries, capped: true };
}
