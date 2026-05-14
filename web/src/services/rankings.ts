import { fetchJson, getApiBase, useMockDemo } from '@/services/api';

export type HospitalRankingSort =
  | 'best'
  | 'worst'
  | 'volume_high'
  | 'volume_low'
  | 'improved'
  | 'worsened';

export type HospitalRankingRow = {
  ccn: string;
  label: string;
  year: number;
  value: number;
};

export type HospitalRankingsResponse = {
  measure_id: string;
  state: string;
  sort: string;
  eligible: number;
  /** Hospitals passing strict sign filter for improved/worsened (API may omit). */
  matched_criteria?: number;
  /** Hospitals with usable YoY pair for improved/worsened (API may omit). */
  eligible_with_yoy?: number;
  results: HospitalRankingRow[];
};

export async function fetchHospitalRankings(
  measureId: string,
  state: string,
  options?: { limit?: number; sort?: HospitalRankingSort },
): Promise<HospitalRankingsResponse> {
  if (useMockDemo() || !getApiBase()) {
    return {
      measure_id: measureId,
      state: state.toUpperCase().slice(0, 2),
      sort: options?.sort ?? 'worst',
      eligible: 0,
      results: [],
    };
  }
  const params = new URLSearchParams({
    measure_id: measureId,
    state: state.toUpperCase().slice(0, 2),
    limit: String(options?.limit ?? 32),
    sort: options?.sort ?? 'worst',
  });
  return fetchJson<HospitalRankingsResponse>(`/rankings/hospitals?${params}`);
}
