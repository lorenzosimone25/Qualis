import type { SeriesRow } from '@/types/metric';

/** Normalize hospital CCN from series row (API may use `H:CCN` or bare CCN). */
export function ccnFromSeriesRow(row: SeriesRow): string | null {
  if (row.type !== 'hospital') return null;
  const ev = String(row.entity_value ?? '');
  const raw = ev.startsWith('H:') ? ev.slice(2) : ev;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(6, '0');
}

/**
 * For line/volume charts: keep state + national rows; keep hospital rows whose CCN
 * appears in `rankedCcns` (API order — caller passes intersection with in-scope hospitals).
 */
export function filterSeriesRowsForRankingLens(rows: SeriesRow[], rankedCcns: string[]): SeriesRow[] {
  if (!rankedCcns.length) return rows;
  const norm = (c: string) => c.replace(/\D/g, '').padStart(6, '0');
  const allow = new Set(rankedCcns.map(norm));
  return rows.filter((r) => {
    if (r.type !== 'hospital') return true;
    const ccn = ccnFromSeriesRow(r);
    return ccn ? allow.has(norm(ccn)) : false;
  });
}
