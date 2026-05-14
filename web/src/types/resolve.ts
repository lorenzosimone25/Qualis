import type { LocationOption } from '@/types/hospital';
import type { MetricSearchHit } from '@/types/metric';

/** Response from `POST /query/resolve` (snake_case matches FastAPI JSON). */
export type ResolveQueryResponse = {
  query: string;
  detected_zips: string[];
  detected_state_codes: string[];
  residual_search_text: string;
  metrics: MetricSearchHit[];
  hospital_options: LocationOption[];
  suggested_hospital_tokens: string[];
  suggested_state_tokens: string[];
  warnings: string[];
};
