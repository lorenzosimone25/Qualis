import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { matchStatesForQuery } from '@/lib/unifiedDatasetSearch';
import { hasLiveApi, useMockDemo } from '@/services/api';
import { searchHospitals } from '@/services/hospitalSearch';
import { searchMetrics } from '@/services/metricSearch';

const DEBOUNCE_MS = 260;
const METRIC_LIMIT = 12;
const HOSPITAL_LIMIT = 12;

export function useUnifiedDatasetSearch(draft: string) {
  const [debounced, setDebounced] = useState('');
  const live = hasLiveApi();
  const mock = useMockDemo();

  useEffect(() => {
    const t = draft.trim();
    if (t.length < 2) {
      setDebounced('');
      return;
    }
    const id = window.setTimeout(() => setDebounced(t), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [draft]);

  const enabled = (mock || live) && debounced.length >= 2;

  return useQuery({
    queryKey: ['unified-dataset-search', debounced],
    queryFn: async () => {
      const [metricsRes, hospitalsRes] = await Promise.all([
        searchMetrics(debounced, METRIC_LIMIT),
        searchHospitals(debounced, HOSPITAL_LIMIT),
      ]);
      const states = matchStatesForQuery(debounced, 10);
      return {
        query: debounced,
        metrics: metricsRes.metrics,
        hospitals: hospitalsRes.options,
        states,
      };
    },
    enabled,
    staleTime: 60_000,
  });
}
