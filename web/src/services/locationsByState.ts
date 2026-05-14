import { fetchJson, getApiBase, useMockDemo } from '@/services/api';
import type { LocationsByStateResponse } from '@/types/hospital';

export async function fetchLocationsByState(
  stateCode: string,
  params: { q: string; offset: number; limit: number; sort: 'name' | 'ccn' },
): Promise<LocationsByStateResponse> {
  const st = stateCode.trim().toUpperCase().slice(0, 2);
  if (useMockDemo()) {
    return {
      state: st,
      query: params.q,
      options: [
        {
          label: 'Demo Medical Center',
          value: 'H:070001',
          search: 'demo 070001',
          type: 'hospital',
        },
      ],
      total: 1,
      offset: params.offset,
      limit: params.limit,
    };
  }
  const base = getApiBase();
  if (!base) {
    return {
      state: st,
      query: params.q,
      options: [],
      total: 0,
      offset: params.offset,
      limit: params.limit,
    };
  }
  const sp = new URLSearchParams({
    state: st,
    q: params.q,
    offset: String(params.offset),
    limit: String(params.limit),
    sort: params.sort,
  });
  return fetchJson<LocationsByStateResponse>(`/locations/by-state?${sp}`);
}
