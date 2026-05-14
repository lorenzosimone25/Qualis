/** Helpers for year-window slicing on pivoted chart rows (same order as pivot). */

export type PivotRow = Record<string, number | string | null>;

export function slicePivotByIndex<T extends PivotRow>(rows: T[], startIndex: number, endIndex: number): T[] {
  const lo = Math.max(0, Math.min(startIndex, endIndex, rows.length - 1));
  const hi = Math.max(lo, Math.min(Math.max(startIndex, endIndex), rows.length - 1));
  return rows.slice(lo, hi + 1);
}

/** One value per year for the brush navigator (mean of plotted series at that year). */
export function navigatorSeriesFromPivot(
  rows: PivotRow[],
  valueKeys: string[],
): { yearLabel: string; __nav: number | null }[] {
  return rows.map((row) => {
    let sum = 0;
    let n = 0;
    for (const k of valueKeys) {
      const v = row[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        sum += v;
        n += 1;
      }
    }
    return {
      yearLabel: String(row.yearLabel ?? ''),
      __nav: n ? sum / n : null,
    };
  });
}
