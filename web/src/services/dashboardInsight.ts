import { postJson } from '@/services/api';
import type { SeriesRow } from '@/types/metric';

export type DashboardInsightPayload = {
  measure_id: string;
  measure_title: string;
  interpretation: string;
  has_national: boolean;
  location_tokens: string[];
  series_rows: SeriesRow[];
};

function rowsSignature(rows: SeriesRow[]): string {
  return rows.map((r) => `${r.year}:${r.entity_value}:${r.label}:${r.value}`).join('|');
}

/** TanStack Query key shared with `DataSummary` insight fetch. */
export function dashboardInsightQueryKey(parts: {
  measureId: string;
  locationTokens: string[];
  rows: SeriesRow[];
}): readonly unknown[] {
  const loc = [...parts.locationTokens].sort().join(',');
  return ['dashboard-insight', parts.measureId, loc, rowsSignature(parts.rows)] as const;
}

export async function fetchDashboardInsight(payload: DashboardInsightPayload): Promise<{ markdown: string }> {
  return postJson<{ markdown: string }>('/dashboard/insight_summary', payload);
}
