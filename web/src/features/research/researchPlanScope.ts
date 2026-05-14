import { extractStateCodesFromText } from '@/lib/usStateCodes';
import type { ResearchSessionSlots } from '@/services/researchApi';

/** Question-level planning hints assembled in the web app (Stage 2) — sent as text + session_slots only. */
export type ResearchAnalysisFocus =
  | 'unspecified'
  | 'national_trends'
  | 'state_hospitals'
  | 'named_hospitals'
  | 'explore';

export type ResearchPlanScopeDraft = {
  /** Free text; two-letter codes and common state names are parsed where possible. */
  geographyText: string;
  analysisFocus: ResearchAnalysisFocus;
  rankingBias: 'neutral' | 'favorable' | 'concerning';
  /** Hint for the planner; server still decides include_national from model JSON. */
  includeNational: boolean;
};

const FOCUS_LABEL: Record<ResearchAnalysisFocus, string> = {
  unspecified: 'Let the planner infer from the question',
  national_trends: 'Emphasize national / population-level trends',
  state_hospitals: 'State-level series and ranked hospitals (needs states below or in question)',
  named_hospitals: 'Named hospitals or search hints (use question + hospital hints)',
  explore: 'Broad exploratory retrieval',
};

export function defaultResearchPlanScope(): ResearchPlanScopeDraft {
  return {
    geographyText: '',
    analysisFocus: 'unspecified',
    rankingBias: 'neutral',
    includeNational: true,
  };
}

/** States derived from the scope strip (for session_slots.geography). */
export function statesFromScopeGeography(scope: ResearchPlanScopeDraft): string[] {
  return extractStateCodesFromText(scope.geographyText);
}

export function buildSessionSlotsFromScope(scope: ResearchPlanScopeDraft): ResearchSessionSlots | null {
  const states = statesFromScopeGeography(scope);
  if (!states.length) return null;
  return {
    geography: { states, source: 'user', confirmed: true },
  };
}

export function mergeResearchSessionSlots(
  a: ResearchSessionSlots | null | undefined,
  b: ResearchSessionSlots | null | undefined,
): ResearchSessionSlots | null {
  const ga = a?.geography?.states ?? [];
  const gb = b?.geography?.states ?? [];
  const merged = [
    ...new Set([...ga, ...gb].map((s) => String(s).trim().toUpperCase().slice(0, 2)).filter(Boolean)),
  ];
  if (!merged.length) return null;
  const confirmed = Boolean(a?.geography?.confirmed || b?.geography?.confirmed);
  const source: 'user' | 'clarification' =
    b?.geography?.source === 'clarification' && gb.length ? 'clarification' : 'user';
  return { geography: { states: merged, source, confirmed } };
}

/**
 * Prefixes the user's natural-language question with a stable, planner-oriented scope block.
 * The backend planner sees this as part of USER_QUESTION only (no Python changes).
 */
export function buildAugmentedPlanQuestion(coreQuestion: string, scope: ResearchPlanScopeDraft): string {
  const q = (coreQuestion || '').trim();
  const states = statesFromScopeGeography(scope);
  const lines: string[] = [
    '[Client research scope — planning hints only; not numeric evidence.]',
    `Analysis focus: ${FOCUS_LABEL[scope.analysisFocus]}`,
    `Ranking bias hint for hospital retrieval: ${scope.rankingBias}`,
    `User preference — include national baseline in charts when the measure supports it: ${scope.includeNational ? 'yes' : 'no'}`,
  ];
  if (states.length) {
    lines.push(`US states confirmed from scope strip: ${states.join(', ')}`);
  } else {
    lines.push(
      'US states from scope strip: none — infer only from the question text below or ask for clarification if hospital ranking needs states.',
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(q || 'Research question');
  return lines.join('\n');
}
