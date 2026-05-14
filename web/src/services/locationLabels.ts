import { hasLiveApi, postJson, useMockDemo } from '@/services/api';
import { MOCK_LOCATIONS } from '@/services/mock/fixtures';
import { US_STATE_NAMES } from '@/lib/usStateNames';

export type LocationLabelsResponse = {
  labels: Record<string, string>;
};

function mockLabelsForTokens(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of tokens) {
    if (tok.startsWith('H:')) {
      const opt = MOCK_LOCATIONS.find((o) => o.value === tok);
      if (opt) {
        const short = opt.label.split('—')[0]?.trim() ?? opt.label;
        out[tok] = short;
      } else {
        out[tok] = `Hospital (CCN ${tok.slice(2)})`;
      }
    } else if (tok.startsWith('S:')) {
      const code = tok.slice(2).toUpperCase();
      const name = US_STATE_NAMES[code];
      out[tok] = name ? `${name} (state)` : `State (${code})`;
    } else if (tok === '__NATIONAL__') {
      out[tok] = 'National (USA)';
    } else {
      out[tok] = tok;
    }
  }
  return out;
}

/** Batch-resolve location picker tokens to display names (chips, legends). */
export async function fetchLocationLabels(tokens: string[]): Promise<LocationLabelsResponse> {
  const uniq = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
  if (!uniq.length) return { labels: {} };

  if (useMockDemo() || !hasLiveApi()) {
    return { labels: mockLabelsForTokens(uniq) };
  }

  return postJson<LocationLabelsResponse>('/locations/labels', { tokens: uniq.slice(0, 64) });
}
