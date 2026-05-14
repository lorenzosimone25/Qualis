import { MAX_H_TOKENS } from '@/lib/dashboardConstants';
import { buildHospitalMetricRows, seriesCompositeKey, type HospitalMetricRow } from '@/lib/hospitalSeriesMetrics';
import { inferLowerIsBetter } from '@/lib/metricDirection';
import type { SeriesRow } from '@/types/metric';

/** National and state aggregate rows — kept on trend charts when `includeAggregates` is true. */
export function isChartAggregateRow(r: SeriesRow): boolean {
  if (r.entity_value === '__NATIONAL__') return true;
  if (r.type === 'state') return true;
  if (/^S:[A-Za-z]{2}$/i.test(String(r.entity_value ?? ''))) return true;
  return false;
}

export function isChartHospitalRow(r: SeriesRow): boolean {
  if (isChartAggregateRow(r)) return false;
  if (r.type === 'hospital') return true;
  return String(r.entity_value ?? '').startsWith('H:');
}

export type ChartSeriesSortColumn =
  | 'name'
  | 'nYears'
  | 'mean'
  | 'netChange'
  | 'upStepsLast5'
  | 'lastYear'
  | 'lastValue'
  | 'maxFluctAbs';

export type ChartSeriesSortOrder = 'best' | 'worst';

export type PickSeriesForChartOptions = {
  sortColumn: ChartSeriesSortColumn;
  order: ChartSeriesSortOrder;
  /** When `Infinity`, show up to `MAX_H_TOKENS` hospitals. */
  limit: number;
  interpretation: string;
  /** Volume counts: treat higher values and positive changes as better. */
  preferHigherLatest?: boolean;
  /** When true (default), national and state rows are always included on trend charts. */
  includeAggregates?: boolean;
};

export type PickSeriesForChartResult = {
  rows: SeriesRow[];
  totalHospitalSeries: number;
  capped: boolean;
  summary: string;
};

export const CHART_SORT_COLUMN_LABELS: Record<ChartSeriesSortColumn, string> = {
  name: 'Facility name',
  nYears: 'Years',
  mean: 'Mean',
  netChange: 'Net Δ',
  upStepsLast5: 'Up steps',
  lastYear: 'Latest yr',
  lastValue: 'Latest',
  maxFluctAbs: 'Max |YoY Δ|',
};

function cmpNullNum(
  a: number | null,
  b: number | null,
  body: (x: number, y: number) => number,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return body(a, b);
}

/**
 * Comparator: negative if `a` should appear before `b` when `order` is **best** first
 * (i.e. better hospitals sort earlier).
 */
function compareMetricsBestFirst(
  a: HospitalMetricRow,
  b: HospitalMetricRow,
  column: ChartSeriesSortColumn,
  lowerIsBetter: boolean,
  preferHigher: boolean,
): number {
  const tie = a.seriesKey.localeCompare(b.seriesKey);
  let c = 0;
  switch (column) {
    case 'name':
      c = a.name.localeCompare(b.name);
      break;
    case 'nYears':
      c = b.nYears - a.nYears;
      break;
    case 'mean':
      if (preferHigher) c = cmpNullNum(a.mean, b.mean, (x, y) => y - x);
      else if (lowerIsBetter) c = cmpNullNum(a.mean, b.mean, (x, y) => x - y);
      else c = cmpNullNum(a.mean, b.mean, (x, y) => x - y);
      break;
    case 'lastValue':
      if (preferHigher) c = cmpNullNum(a.lastValue, b.lastValue, (x, y) => y - x);
      else if (lowerIsBetter) c = cmpNullNum(a.lastValue, b.lastValue, (x, y) => x - y);
      else c = cmpNullNum(a.lastValue, b.lastValue, (x, y) => y - x);
      break;
    case 'netChange':
      if (preferHigher) c = cmpNullNum(a.netChange, b.netChange, (x, y) => y - x);
      else if (lowerIsBetter) c = cmpNullNum(a.netChange, b.netChange, (x, y) => x - y);
      else c = cmpNullNum(a.netChange, b.netChange, (x, y) => y - x);
      break;
    case 'upStepsLast5':
      c = a.upStepsLast5 - b.upStepsLast5;
      break;
    case 'lastYear':
      c = cmpNullNum(a.lastYear, b.lastYear, (x, y) => y - x);
      break;
    case 'maxFluctAbs': {
      const aa = a.maxFluctDelta == null ? null : Math.abs(a.maxFluctDelta);
      const bb = b.maxFluctDelta == null ? null : Math.abs(b.maxFluctDelta);
      c = cmpNullNum(aa, bb, (x, y) => x - y);
      break;
    }
    default:
      c = 0;
  }
  if (c !== 0) return c;
  return tie;
}

/**
 * Pick hospital series for line/volume charts using the same per-series metrics as the comparison table.
 * Aggregates (national/state) are preserved for trend charts when `includeAggregates` is true.
 */
export function pickSeriesRowsForChartSort(
  rows: SeriesRow[],
  options: PickSeriesForChartOptions,
): PickSeriesForChartResult {
  const {
    sortColumn,
    order,
    limit: rawLimit,
    interpretation,
    preferHigherLatest = false,
    includeAggregates = true,
  } = options;

  const inferred = inferLowerIsBetter(interpretation);
  const lowerIsBetter = preferHigherLatest ? false : inferred === null ? true : inferred;

  const aggRows = includeAggregates ? rows.filter((r) => isChartAggregateRow(r)) : [];
  const hospitalRows = rows.filter((r) => isChartHospitalRow(r));
  const metrics = buildHospitalMetricRows(hospitalRows);
  const totalHospitalSeries = metrics.length;

  const cap = !Number.isFinite(rawLimit) || rawLimit > MAX_H_TOKENS ? MAX_H_TOKENS : Math.max(1, Math.floor(rawLimit));

  const colLabel = CHART_SORT_COLUMN_LABELS[sortColumn];
  const ordLabel = order === 'best' ? 'best first' : 'worst first';

  if (totalHospitalSeries === 0) {
    return {
      rows: includeAggregates ? aggRows : [],
      totalHospitalSeries: 0,
      capped: false,
      summary: 'No hospital series in scope.',
    };
  }

  if (totalHospitalSeries <= cap) {
    const out = includeAggregates ? [...aggRows, ...hospitalRows] : [...hospitalRows];
    return {
      rows: out,
      totalHospitalSeries,
      capped: false,
      summary: `Showing all ${totalHospitalSeries} facilities (${colLabel}, ${ordLabel}).`,
    };
  }

  const sorted = [...metrics].sort((a, b) => compareMetricsBestFirst(a, b, sortColumn, lowerIsBetter, preferHigherLatest));
  if (order === 'worst') sorted.reverse();

  const chosenKeys = new Set(sorted.slice(0, cap).map((m) => m.seriesKey));
  const pickedHospitals = hospitalRows.filter((r) => chosenKeys.has(seriesCompositeKey(r)));

  const outRows = includeAggregates ? [...aggRows, ...pickedHospitals] : [...pickedHospitals];

  return {
    rows: outRows,
    totalHospitalSeries,
    capped: true,
    summary: `Showing ${cap} of ${totalHospitalSeries} by ${colLabel} (${ordLabel}, same logic as comparison table).`,
  };
}
