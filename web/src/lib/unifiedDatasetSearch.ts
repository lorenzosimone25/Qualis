import { US_STATE_NAMES } from '@/lib/usStateNames';
import type { LocationOption } from '@/types/hospital';
import type { MetricSearchHit } from '@/types/metric';

export type UnifiedStateHit = {
  kind: 'state';
  code: string;
  label: string;
  token: string;
};

const MAX_STATES = 10;

/** Local state name / code matches (no API). */
export function matchStatesForQuery(q: string, limit = MAX_STATES): UnifiedStateHit[] {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const out: UnifiedStateHit[] = [];
  const seen = new Set<string>();
  for (const code of Object.keys(US_STATE_NAMES).sort()) {
    if (out.length >= limit) break;
    const name = US_STATE_NAMES[code]!;
    const c = code.toUpperCase();
    const nl = name.toLowerCase();
    if (c.toLowerCase() === t || nl.includes(t) || nl.startsWith(t) || t === c.toLowerCase()) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push({
          kind: 'state',
          code: c,
          label: `${name} (${c})`,
          token: `S:${c}`,
        });
      }
    }
  }
  if (out.length < limit && t.length === 2) {
    const c2 = t.toUpperCase();
    if (c2 in US_STATE_NAMES && !seen.has(c2)) {
      out.push({
        kind: 'state',
        code: c2,
        label: `${US_STATE_NAMES[c2]} (${c2})`,
        token: `S:${c2}`,
      });
    }
  }
  return out.slice(0, limit);
}

export type UnifiedSearchBundle = {
  query: string;
  metrics: MetricSearchHit[];
  hospitals: LocationOption[];
  states: UnifiedStateHit[];
};
