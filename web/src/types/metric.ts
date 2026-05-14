/** Matches `/series` row records from `fetch_series`. */
export type SeriesRow = {
  entity_value: string;
  label: string;
  type: string;
  year: number;
  value: number;
};

export type SeriesResponse = {
  measure_id: string;
  locations: string[];
  rows: SeriesRow[];
};

export type MetricSearchHit = {
  measure_id: string;
  label: string;
  snippet: string;
  interpretation: string;
  is_volume: boolean;
};

export type MetricsSearchResponse = {
  query: string;
  metrics: MetricSearchHit[];
  count: number;
};

export type MetricSummary = {
  measureId: string;
  title: string;
  interpretation: string;
  hasNational?: boolean;
};
