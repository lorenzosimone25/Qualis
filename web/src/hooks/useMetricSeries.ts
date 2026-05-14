import { useQuery } from '@tanstack/react-query';
import { fetchMetricSeries } from '@/services/metricSeries';

export function useMetricSeries(
  measureId: string | undefined,
  locations: string[],
  includeNational: boolean,
  options?: { enabled?: boolean },
) {
  const extra = options?.enabled !== false;
  return useQuery({
    queryKey: ['series', measureId, locations, includeNational],
    queryFn: () => fetchMetricSeries(measureId!, locations, includeNational),
    enabled: Boolean(measureId && measureId.length > 0) && extra,
    staleTime: 120_000,
  });
}
