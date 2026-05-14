import { fetchJson, getApiBase, useMockDemo } from '@/services/api';
import { SERIES_HOSPITAL_CHUNK } from '@/lib/dashboardConstants';
import type { SeriesResponse, SeriesRow } from '@/types/metric';
import { mockSeries } from '@/services/mock/fixtures';

function dedupeSeriesRows(rows: SeriesRow[]): SeriesRow[] {
  const key = (r: SeriesRow) => `${r.entity_value}|${r.year}|${r.type}`;
  const m = new Map<string, SeriesRow>();
  for (const r of rows) {
    m.set(key(r), r);
  }
  return [...m.values()].sort((a, b) => {
    const t = a.type.localeCompare(b.type);
    if (t !== 0) return t;
    const ln = a.label.localeCompare(b.label);
    if (ln !== 0) return ln;
    return a.year - b.year;
  });
}

async function fetchMetricSeriesOnce(
  measureId: string,
  locations: string[],
  includeNational: boolean,
): Promise<SeriesResponse> {
  const params = new URLSearchParams({
    measure_id: measureId,
    include_national: String(includeNational),
  });
  if (locations.length) params.set('locations', locations.join(','));
  return fetchJson<SeriesResponse>(`/series?${params}`);
}

export async function fetchMetricSeries(
  measureId: string,
  locations: string[],
  includeNational: boolean,
): Promise<SeriesResponse> {
  if (useMockDemo()) return mockSeries(measureId, locations, includeNational);
  const base = getApiBase();
  if (!base) {
    return { measure_id: measureId, locations, rows: [] };
  }

  const stateToks = locations.filter((l) => /^S:[A-Za-z]{2}$/i.test(l));
  const hToks = locations.filter((l) => l.startsWith('H:'));
  const other = locations.filter((l) => !/^S:[A-Za-z]{2}$/i.test(l) && !l.startsWith('H:'));
  const rest = [...stateToks, ...other];

  if (hToks.length <= SERIES_HOSPITAL_CHUNK) {
    return fetchMetricSeriesOnce(measureId, locations, includeNational);
  }

  const merged: SeriesRow[] = [];
  for (let i = 0; i < hToks.length; i += SERIES_HOSPITAL_CHUNK) {
    const chunk = hToks.slice(i, i + SERIES_HOSPITAL_CHUNK);
    const locs = [...rest, ...chunk];
    const block = await fetchMetricSeriesOnce(measureId, locs, includeNational && i === 0);
    merged.push(...block.rows);
  }

  return {
    measure_id: measureId,
    locations,
    rows: dedupeSeriesRows(merged),
  };
}
