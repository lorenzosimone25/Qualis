import { US_STATE_NAMES } from '@/lib/usStateNames';
import type { ResearchPlanModel } from '@/services/researchApi';

/** Two-letter state code → full name for display; fallback to code. */
export function displayStateName(code: string): string {
  const c = String(code).trim().toUpperCase().slice(0, 2);
  return US_STATE_NAMES[c] ?? c;
}

/** Tokens for location label API (S:XX + hospital tokens). */
export function planLocationTokens(plan: ResearchPlanModel): string[] {
  return [
    ...plan.states.map((s) => `S:${String(s).trim().toUpperCase().slice(0, 2)}`),
    ...plan.hospital_tokens,
  ];
}

/** Human-readable geography line using resolved labels (preferred) and state names. */
export function humanGeographySummary(
  plan: ResearchPlanModel,
  locationLabels: Record<string, string>,
): string {
  const stateParts = plan.states.map((s) => {
    const tok = `S:${String(s).trim().toUpperCase().slice(0, 2)}`;
    const fromApi = locationLabels[tok];
    if (fromApi) return fromApi.replace(/\s*\(state\)\s*$/i, '').trim() || displayStateName(s);
    return displayStateName(s);
  });
  const hospParts = plan.hospital_tokens.map((h) => locationLabels[h] ?? h);
  const parts = [...stateParts, ...hospParts].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'National / not specified';
}

/** Themes and highlighted terms from the plan for chart captions. */
export function promptLinkCaption(plan: ResearchPlanModel, userQuestion: string): string {
  const themes = plan.clinical_themes.length ? plan.clinical_themes.join(', ') : '';
  const geoSpans = plan.highlight_spans.filter((s) => s.role === 'geography').map((s) => s.term);
  const clinSpans = plan.highlight_spans.filter((s) => s.role === 'clinical').map((s) => s.term);
  const bits: string[] = [];
  if (themes) bits.push(`Themes: ${themes}`);
  if (geoSpans.length) bits.push(`Geography in your wording: ${[...new Set(geoSpans)].join(', ')}`);
  if (clinSpans.length) bits.push(`Clinical terms: ${[...new Set(clinSpans)].join(', ')}`);
  if (!bits.length && userQuestion.trim()) {
    bits.push(`Question: ${userQuestion.trim().slice(0, 160)}${userQuestion.length > 160 ? '…' : ''}`);
  }
  return bits.join(' · ') || 'Charts use only retrieved CMS series for the planned measures.';
}

/** Short subtitle for chart cards from intent + first search query. */
export function chartEvidenceSubtitle(plan: ResearchPlanModel): string {
  const q = plan.metric_search_queries[0];
  if (q) return `Evidence for “${q}” (${plan.intent.replace(/_/g, ' ')})`;
  return `Evidence for ${plan.intent.replace(/_/g, ' ')}`;
}

/** Order measure ids by first matching metric_search_queries substring (case-insensitive). */
export function orderMeasuresForTabs(measureIds: string[], plan: ResearchPlanModel, titleById: Record<string, string>): string[] {
  if (!measureIds.length) return measureIds;
  const queries = plan.metric_search_queries.map((q) => q.toLowerCase());
  const score = (id: string): number => {
    const title = (titleById[id] ?? id).toLowerCase();
    let s = 999;
    queries.forEach((q, i) => {
      if (!q) return;
      if (title.includes(q) || id.toLowerCase().includes(q)) s = Math.min(s, i);
    });
    return s;
  };
  return [...measureIds].sort((a, b) => score(a) - score(b) || a.localeCompare(b));
}

/** Tab label: catalog title if known, else measure id. */
export function measureTabLabel(measureId: string, titleById: Record<string, string>): string {
  const t = titleById[measureId];
  if (t && t !== measureId) {
    const short = t.length > 42 ? `${t.slice(0, 41)}…` : t;
    return short;
  }
  return measureId;
}
