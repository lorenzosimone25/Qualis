import { getApiBase, hasLiveApi, postJson, useMockDemo } from '@/services/api';
import { mockResolveQuery } from '@/services/mock/fixtures';
import type { ResolveQueryResponse } from '@/types/resolve';

export async function postResolveQuery(payload: {
  q: string;
  metric_limit?: number;
  hospital_limit?: number;
}): Promise<ResolveQueryResponse> {
  if (useMockDemo()) return mockResolveQuery(payload.q);

  const base = getApiBase();
  if (!base) {
    return {
      query: payload.q,
      detected_zips: [],
      detected_state_codes: [],
      residual_search_text: '',
      metrics: [],
      hospital_options: [],
      suggested_hospital_tokens: [],
      suggested_state_tokens: [],
      warnings: [
        'Set VITE_API_BASE_URL (e.g. /api) and run FastAPI, or set VITE_USE_MOCK=true for local UI fixtures.',
      ],
    };
  }

  return postJson<ResolveQueryResponse>('/query/resolve', {
    q: payload.q,
    metric_limit: payload.metric_limit ?? 28,
    hospital_limit: payload.hospital_limit ?? 36,
  });
}

export function resolveQueryEnabled(): boolean {
  return useMockDemo() || hasLiveApi();
}
