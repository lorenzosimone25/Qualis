import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useMemo, useState } from 'react';
import { searchHospitals } from '@/services/hospitalSearch';

export function useHospitalSearch() {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);

  const q = useMemo(() => deferred.trim(), [deferred]);

  const search = useQuery({
    queryKey: ['hospitals', 'search', q],
    queryFn: () => searchHospitals(q),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });

  return {
    query,
    setQuery,
    deferredQuery: q,
    ...search,
  };
}
