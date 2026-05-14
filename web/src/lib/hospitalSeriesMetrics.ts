import type { SeriesRow } from '@/types/metric';

export const SERIES_GROUP_SEP = '\u0000';

export type TrendKind = 'up' | 'down' | 'flat';

const EPS = 1e-6;

/** Stable key for grouping series rows (entity + label). */
export function seriesCompositeKey(row: Pick<SeriesRow, 'entity_value' | 'label'>): string {
  return `${row.entity_value}${SERIES_GROUP_SEP}${row.label}`;
}

export function trendFromDelta(delta: number | null): TrendKind {
  if (delta == null || Number.isNaN(delta)) return 'flat';
  if (delta > EPS) return 'up';
  if (delta < -EPS) return 'down';
  return 'flat';
}

export function countUpStepsInWindow(sortedAsc: SeriesRow[], maxWindow: number): { count: number; windowLen: number } {
  if (sortedAsc.length < 2) return { count: 0, windowLen: sortedAsc.length };
  const w = sortedAsc.slice(-Math.min(maxWindow, sortedAsc.length));
  let count = 0;
  for (let i = 1; i < w.length; i++) {
    const a = w[i - 1]!.value;
    const b = w[i]!.value;
    if (a != null && b != null && b > a + EPS) count += 1;
  }
  return { count, windowLen: w.length };
}

/** Largest absolute year-over-year change between consecutive reporting years; tie → more recent end year */
export function maxYearOverYearFluctuation(sortedAsc: SeriesRow[]): {
  delta: number | null;
  endYear: number | null;
  trend: TrendKind;
} {
  let bestAbs = -1;
  let delta: number | null = null;
  let endYear: number | null = null;
  for (let i = 1; i < sortedAsc.length; i++) {
    const prevRow = sortedAsc[i - 1]!;
    const cur = sortedAsc[i]!;
    const a = prevRow.value;
    const b = cur.value;
    if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) continue;
    const d = b - a;
    const ad = Math.abs(d);
    const y = cur.year;
    if (ad > bestAbs + EPS || (Math.abs(ad - bestAbs) <= EPS && (endYear == null || y > endYear))) {
      bestAbs = ad;
      delta = d;
      endYear = y;
    }
  }
  if (bestAbs < 0 || delta == null) return { delta: null, endYear: null, trend: 'flat' };
  return { delta, endYear, trend: trendFromDelta(delta) };
}

export type HospitalMetricRow = {
  seriesKey: string;
  entity_value: string;
  name: string;
  nYears: number;
  mean: number | null;
  netChange: number | null;
  upStepsLast5: number;
  windowLen: number;
  lastYear: number | null;
  lastValue: number | null;
  maxFluctDelta: number | null;
  maxFluctEndYear: number | null;
  maxFluctTrend: TrendKind;
};

/**
 * One row per distinct (entity_value, label), same logic as the comparison table aggregates.
 */
export function buildHospitalMetricRows(rows: SeriesRow[]): HospitalMetricRow[] {
  const byKey = new Map<string, SeriesRow[]>();
  for (const r of rows) {
    const k = seriesCompositeKey(r);
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  const out: HospitalMetricRow[] = [];
  for (const [seriesKey, series] of byKey) {
    const asc = [...series].sort((a, b) => a.year - b.year);
    const sortedDesc = [...asc].reverse();
    const latest = sortedDesc[0];
    const lastVal = latest?.value ?? null;
    const entity_value = latest?.entity_value ?? '';

    const vals = asc.map((r) => r.value).filter((v): v is number => v != null && !Number.isNaN(v));
    const nYears = vals.length;
    const mean = nYears ? vals.reduce((a, b) => a + b, 0) / nYears : null;
    const netChange = nYears >= 2 ? vals[vals.length - 1]! - vals[0]! : null;
    const { count: upStepsLast5, windowLen } = countUpStepsInWindow(asc, 5);
    const { delta: maxFluctDelta, endYear: maxFluctEndYear, trend: maxFluctTrend } = maxYearOverYearFluctuation(asc);

    out.push({
      seriesKey,
      entity_value,
      name: latest?.label ?? '',
      nYears,
      mean,
      netChange,
      upStepsLast5,
      windowLen,
      lastYear: latest?.year ?? null,
      lastValue: lastVal,
      maxFluctDelta,
      maxFluctEndYear,
      maxFluctTrend,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
