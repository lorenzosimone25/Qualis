import { US_STATE_NAMES } from '@/lib/usStateNames';
import { fetchJson, hasLiveApi } from '@/services/api';

export type CountsByStateResponse = {
  counts: Record<string, number>;
};

export async function fetchHospitalCountsByState(): Promise<CountsByStateResponse> {
  if (!hasLiveApi()) return { counts: {} };
  return fetchJson<CountsByStateResponse>('/hospitals/counts-by-state');
}

/** Zero-fill every USPS key used in geography UI (mock / fallback). */
export function emptyCountsRecord(): Record<string, number> {
  return Object.fromEntries(Object.keys(US_STATE_NAMES).map((k) => [k, 0]));
}
