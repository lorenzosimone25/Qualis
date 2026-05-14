import { fetchJson, getApiBase, useMockDemo } from '@/services/api';
import type { MetricsSearchResponse } from '@/types/metric';
import { mockMetricsSearch } from '@/services/mock/fixtures';

export async function searchMetrics(q: string, limit = 20): Promise<MetricsSearchResponse> {
  if (useMockDemo()) return mockMetricsSearch(q);
  const base = getApiBase();
  if (!base) return { query: q, metrics: [], count: 0 };
  const params = new URLSearchParams({ q, limit: String(limit) });
  return fetchJson<MetricsSearchResponse>(`/metrics/search?${params}`);
}
