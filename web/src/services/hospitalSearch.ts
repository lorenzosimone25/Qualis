import { fetchJson, getApiBase, useMockDemo } from '@/services/api';
import type { LocationsSearchResponse, HospitalsByZipResponse, HospitalsByStateResponse } from '@/types/hospital';
import { mockLocationsSearch } from '@/services/mock/fixtures';

export async function searchHospitals(q: string, limit = 50): Promise<LocationsSearchResponse> {
  if (useMockDemo()) return mockLocationsSearch(q);
  const base = getApiBase();
  if (!base) return { query: q, options: [], count: 0 };
  const params = new URLSearchParams({ q, limit: String(limit) });
  return fetchJson<LocationsSearchResponse>(`/locations/search?${params}`);
}

export async function hospitalsByZip(zip: string): Promise<HospitalsByZipResponse> {
  if (useMockDemo()) {
    return { zip: zip.replace(/\D/g, '').slice(0, 5), ccns: ['070001'], count: 1 };
  }
  const base = getApiBase();
  if (!base) return { zip: zip.replace(/\D/g, '').slice(0, 5), ccns: [], count: 0 };
  const z = zip.replace(/\D/g, '').slice(0, 5);
  return fetchJson<HospitalsByZipResponse>(`/hospitals/by-zip/${encodeURIComponent(z)}`);
}

export async function hospitalsByState(state: string): Promise<HospitalsByStateResponse> {
  if (useMockDemo()) {
    return { state: state.slice(0, 2).toUpperCase(), ccns: ['070001', '070002'], count: 2 };
  }
  const base = getApiBase();
  if (!base) return { state: state.slice(0, 2).toUpperCase(), ccns: [], count: 0 };
  return fetchJson<HospitalsByStateResponse>(
    `/hospitals/by-state/${encodeURIComponent(state)}`,
  );
}
