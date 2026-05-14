import type { LocationsSearchResponse } from '@/types/hospital';
import type { MetricSearchHit, MetricsSearchResponse, SeriesResponse } from '@/types/metric';
import { US_STATE_NAMES } from '@/lib/usStateNames';
import type { ResolveQueryResponse } from '@/types/resolve';

export const MOCK_METRICS: MetricSearchHit[] = [
  {
    measure_id: 'MORT_30_HF',
    label: '30-day risk-standardised mortality rate after heart failure admission',
    snippet: '30-day risk-standardised mortality rate after heart failure admission',
    interpretation: 'Lower is better',
    is_volume: false,
  },
  {
    measure_id: 'COMP_HIP_KNEE',
    label: 'Complications for hip/knee replacement patients',
    snippet: 'Complications for hip/knee replacement patients',
    interpretation: 'Lower is better',
    is_volume: false,
  },
  {
    measure_id: 'HAI_1',
    label: 'Central line-associated bloodstream infection (CLABSI)',
    snippet: 'Central line-associated bloodstream infection (CLABSI)',
    interpretation: 'Lower is better',
    is_volume: false,
  },
];

export const MOCK_LOCATIONS: LocationsSearchResponse['options'] = [
  {
    label: 'Sample Medical Center — New Haven, CT  ·  CCN 070001',
    value: 'H:070001',
    search: 'sample new haven ct 070001',
    type: 'hospital',
  },
  {
    label: 'River Valley Hospital — Hartford, CT  ·  CCN 070002',
    value: 'H:070002',
    search: 'river valley hartford ct 070002',
    type: 'hospital',
  },
  {
    label: 'Connecticut (CT)',
    value: 'S:CT',
    search: 'connecticut ct',
    type: 'state',
  },
];

export function mockLocationsSearch(q: string): LocationsSearchResponse {
  const ql = q.toLowerCase();
  const options = MOCK_LOCATIONS.filter((o) => o.search.includes(ql) || o.label.toLowerCase().includes(ql));
  return { query: q, options, count: options.length };
}

export function mockMetricsSearch(q: string): MetricsSearchResponse {
  const ql = q.toLowerCase();
  const metrics = MOCK_METRICS.filter(
    (m) =>
      m.measure_id.toLowerCase().includes(ql) ||
      m.label.toLowerCase().includes(ql) ||
      m.interpretation.toLowerCase().includes(ql),
  );
  return { query: q, metrics, count: metrics.length };
}

export function mockSeries(measureId: string, locations: string[], includeNational: boolean): SeriesResponse {
  const rows: SeriesResponse['rows'] = [];
  const years = [2019, 2020, 2021, 2022, 2023];
  const tokens = [...locations];
  if (includeNational) tokens.push('__NATIONAL__');

  let i = 0;
  for (const tok of tokens) {
    const base = 12 + (i % 5) * 0.8;
    const label =
      tok.startsWith('H:')
        ? MOCK_LOCATIONS.find((o) => o.value === tok)?.label.split('—')[0]?.trim() ?? tok
        : tok.startsWith('S:')
          ? (() => {
              const code = tok.slice(2).toUpperCase();
              const n = US_STATE_NAMES[code];
              return n ? `${n} (state)` : `State (${code})`;
            })()
          : 'National (USA)';
    const entityVal = tok.startsWith('H:') || tok.startsWith('S:') ? tok : '__NATIONAL__';
    const typ = tok.startsWith('H:') ? 'hospital' : tok.startsWith('S:') ? 'state' : 'national';

    for (const y of years) {
      const jitter = Math.sin(y * 0.7 + i) * 0.4;
      rows.push({
        entity_value: entityVal,
        label,
        type: typ,
        year: y,
        value: Math.max(0, base + jitter + (y - 2021) * 0.15),
      });
    }
    i += 1;
  }

  return {
    measure_id: measureId,
    locations,
    rows,
  };
}

export function mockResolveQuery(q: string): ResolveQueryResponse {
  const zips = Array.from(q.matchAll(/\b(\d{5})\b/g), (m) => m[1]!);
  const ql = q.trim().length >= 2 ? q.trim() : 'mort';
  const msearch = mockMetricsSearch(ql);
  const hsearch = mockLocationsSearch(ql);
  const suggestedH = MOCK_LOCATIONS.filter((o) => o.type === 'hospital').map((o) => o.value);
  const suggestedS: string[] = [];
  if (/\bCT\b/.test(q) || /connecticut/i.test(q)) suggestedS.push('S:CT');

  return {
    query: q,
    detected_zips: zips,
    detected_state_codes: suggestedS.length ? ['CT'] : [],
    residual_search_text: ql,
    metrics: msearch.metrics,
    hospital_options: hsearch.options,
    suggested_hospital_tokens: suggestedH,
    suggested_state_tokens: suggestedS,
    warnings: zips.length && zips[0] === '00000' ? ['Mock: ZIP has no real lookup.'] : [],
  };
}
