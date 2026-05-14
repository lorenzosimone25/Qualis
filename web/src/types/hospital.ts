/** Matches `/locations/search` option rows and dropdown entries from the Python API. */
export type LocationOption = {
  label: string;
  value: string;
  search: string;
  type: 'hospital' | 'state';
};

export type LocationsSearchResponse = {
  query: string;
  options: LocationOption[];
  count: number;
};

export type HospitalsByZipResponse = {
  zip: string;
  ccns: string[];
  count: number;
};

export type HospitalsByStateResponse = {
  state: string;
  ccns: string[];
  count: number;
};

export type LocationsByStateResponse = {
  state: string;
  query: string;
  options: LocationOption[];
  total: number;
  offset: number;
  limit: number;
};

export type HospitalDetailResponse = {
  ccn: string;
  fields: Record<string, string | null>;
};
