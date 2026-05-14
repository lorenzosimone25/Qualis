import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useState } from 'react';
import { hasLiveApi, useMockDemo } from '@/services/api';
import { fetchLocationsByState } from '@/services/locationsByState';
import type { LocationOption } from '@/types/hospital';

type Props = {
  stateCode: string;
  onPick: (opt: LocationOption) => void;
  disabled?: boolean;
};

const PAGE = 80;

export function StateHospitalBrowser({ stateCode, onPick, disabled }: Props) {
  const live = hasLiveApi();
  const mock = useMockDemo();
  const [draft, setDraft] = useState('');
  const deferredQ = useDeferredValue(draft.trim());
  const [offset, setOffset] = useState(0);
  const [merged, setMerged] = useState<LocationOption[]>([]);

  useEffect(() => {
    setOffset(0);
  }, [deferredQ, stateCode]);

  const enabled = Boolean(stateCode) && !disabled && live && !mock;

  const qy = useQuery({
    queryKey: ['locations-by-state', stateCode, deferredQ, offset],
    queryFn: () => fetchLocationsByState(stateCode, { q: deferredQ, offset, limit: PAGE, sort: 'name' }),
    enabled,
    staleTime: 120_000,
  });

  useEffect(() => {
    if (!qy.data) return;
    if (offset === 0) {
      setMerged(qy.data.options);
    } else {
      setMerged((prev) => {
        const seen = new Set(prev.map((x) => x.value));
        const add = qy.data!.options.filter((o: LocationOption) => !seen.has(o.value));
        return [...prev, ...add];
      });
    }
  }, [qy.data, offset]);

  if (!enabled) {
    return (
      <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        {mock || !live ? 'Hospital browser requires a live API.' : null}
      </p>
    );
  }

  const total = qy.data?.total ?? 0;
  const loaded = merged.length;
  const canMore = loaded < total;

  return (
    <div className="mt-3 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-solid)' }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
        Browse hospitals in {stateCode}
      </p>
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Filter by name, city, or CCN…"
        className="mt-2 w-full rounded-lg border px-2 py-1.5 text-xs outline-none"
        style={{
          borderColor: 'var(--color-border-strong)',
          background: 'var(--color-panel-alt)',
          color: 'var(--color-text-primary)',
        }}
      />
      <div
        className="mt-2 max-h-52 overflow-y-auto rounded-lg border"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-panel-alt)' }}
      >
        {qy.isLoading && offset === 0 ? (
          <p className="p-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Loading…
          </p>
        ) : qy.isError ? (
          <p className="p-3 text-xs" style={{ color: 'var(--color-accent-danger)' }}>
            {(qy.error as Error).message}
          </p>
        ) : merged.length === 0 ? (
          <p className="p-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {total === 0 ? 'No hospitals indexed for this state.' : 'No matches — try a shorter filter.'}
          </p>
        ) : (
          <ul className="divide-y text-left" style={{ borderColor: 'var(--color-border)' }}>
            {merged.map((o) => (
              <li key={o.value} className="border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
                <button
                  type="button"
                  className="w-full px-2 py-1.5 text-left text-xs transition-colors hover:bg-[rgba(34,211,238,0.08)]"
                  style={{ color: 'var(--color-text-secondary)' }}
                  onClick={() => onPick(o)}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {qy.isFetching && offset > 0 ? (
              <li className="p-2 text-center text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                Loading…
              </li>
            ) : null}
          </ul>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <span>
          Showing {loaded ? 1 : 0}–{loaded} of {total.toLocaleString()}
        </span>
        {canMore ? (
          <button
            type="button"
            disabled={qy.isFetching}
            className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ borderColor: 'var(--color-accent-cyan)', color: 'var(--color-accent-cyan)' }}
            onClick={() => setOffset((o) => o + PAGE)}
          >
            Load more
          </button>
        ) : null}
      </div>
    </div>
  );
}
