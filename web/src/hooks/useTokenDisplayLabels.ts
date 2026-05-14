import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchLocationLabels } from '@/services/locationLabels';

/** Stable sorted key for react-query */
function tokensKey(tokens: string[]) {
  return [...new Set(tokens.map((t) => t.trim()).filter(Boolean))].sort().join('\u0001');
}

export function useTokenDisplayLabels(tokens: string[]) {
  const key = useMemo(() => tokensKey(tokens), [tokens]);

  return useQuery({
    queryKey: ['location-labels', key],
    queryFn: () => fetchLocationLabels(key ? key.split('\u0001') : []),
    enabled: Boolean(key),
    staleTime: 300_000,
    select: (d) => d.labels,
  });
}
