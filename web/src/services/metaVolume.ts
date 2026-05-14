import { fetchJson, getApiBase, useMockDemo } from '@/services/api';

export type VolumeSiblingResponse = {
  measure_id: string;
  volume_measure_id: string | null;
  has_volume: boolean;
};

export async function fetchVolumeSibling(measureId: string): Promise<VolumeSiblingResponse> {
  if (useMockDemo() || !getApiBase()) {
    return { measure_id: measureId, volume_measure_id: null, has_volume: false };
  }
  return fetchJson<VolumeSiblingResponse>(
    `/meta/volume_sibling?measure_id=${encodeURIComponent(measureId)}`,
  );
}
