import { fetchJson, hasLiveApi, postJson, useMockDemo } from '@/services/api';
import type { SeriesResponse } from '@/types/metric';

export type HighlightSpan = { term: string; role: 'geography' | 'clinical' | 'comparison' | 'other' };

export type PlanningEvent = { id: string; label: string; detail: string };

export type HospitalSelectionMode = 'none' | 'search_hints' | 'top_ranked_in_state';

export type CompareFocus = 'metrics_first' | 'hospitals_first' | 'balanced';

export type ResearchHospitalPolicy = {
  mode: string;
  state?: string | null;
  sort: string;
  limit?: number;
  rationale?: string;
  ranked_measure_id?: string;
  states_ranked?: string[];
};

export type ResearchMetricCandidate = {
  measure_id?: string | null;
  search_query?: string | null;
  clinical_theme?: string | null;
  rationale?: string;
  priority?: number;
  hospital_policy?: ResearchHospitalPolicy | null;
};

export type ResearchPlanModel = {
  states: string[];
  hospital_tokens: string[];
  measure_ids: string[];
  intent: string;
  year_range?: unknown;
  needs_clarification: boolean;
  clarifying_questions: string[];
  highlight_spans: HighlightSpan[];
  clinical_themes: string[];
  metric_search_queries: string[];
  hospital_natural_hints: string[];
  explicit_hospital_hints?: string[];
  hospital_selection: HospitalSelectionMode;
  compare_focus: CompareFocus;
  retrieval_intent?: string;
  include_national?: boolean;
  metric_candidates?: ResearchMetricCandidate[];
  ranking_bias?: 'favorable' | 'neutral' | 'concerning' | null;
};

export type ResearchPlanResult = {
  trace_id: string;
  plan: ResearchPlanModel;
  clarifications: string[];
  planning_events: PlanningEvent[];
  resolution_notes: string[];
  resolved_retrieval?: Record<string, unknown> | null;
  plan_debug?: Record<string, unknown> | null;
};

export type RetrievalReadiness = {
  status: string;
  warnings: string[];
  coverage?: {
    num_measures?: number;
    num_measures_with_rows?: number;
    num_entities?: number;
    num_rows?: number;
    years?: number[];
    has_national_baseline?: boolean;
    missing_geography?: boolean;
  };
};

export type MetricEvidenceEntry = {
  measure_id: string;
  measure_name?: string;
  interpretation?: string;
  is_volume?: boolean;
  why_selected?: string;
  location_tokens?: string[];
  hospital_selection?: ResearchHospitalPolicy;
  row_count?: number;
};

export type ResearchRetrieveResult = {
  trace_id: string;
  series_by_measure: Record<string, SeriesResponse>;
  validation_warnings: string[];
  question?: string;
  readiness?: RetrievalReadiness;
  metric_evidence?: MetricEvidenceEntry[];
  evidence_digest?: Record<string, unknown> | null;
};

export type ResearchGeographySlots = {
  states: string[];
  source: 'user' | 'clarification' | 'none';
  confirmed: boolean;
};

export type ResearchSessionSlots = {
  geography?: ResearchGeographySlots | null;
};

export type ResearchSummaryEvidence = {
  title: string;
  abstract: string;
  key_findings: string[];
  retrieval_scope: string[];
  limitations: string[];
  markdown: string;
};

export type ResearchSummaryResult = {
  markdown: string;
  citations: string[];
  evidence?: ResearchSummaryEvidence | null;
};

export type ResearchHealthResult = {
  ollama_configured: boolean;
  model: string | null;
};

export type MetricSearchHit = {
  measure_id: string;
  label: string;
  snippet: string;
  interpretation: string;
  is_volume: boolean;
};

function mockPlan(question: string): ResearchPlanResult {
  const upper = question.toUpperCase();
  const states = ['NY', 'CT', 'CA'].filter((s) => upper.includes(s));
  const intent = question.toLowerCase().includes('hospital') ? 'compare_hospitals' : 'compare_geographies';
  const hsel =
    intent === 'compare_hospitals' && states.length > 0 ? 'top_ranked_in_state' : 'none';
  return {
    trace_id: 'mock-trace-research',
    plan: {
      states: states.length ? states : [],
      hospital_tokens: [],
      measure_ids: ['MORT_30_HF'],
      intent,
      year_range: null,
      needs_clarification: false,
      clarifying_questions: [],
      highlight_spans: [
        ...(states[0] ? [{ term: states[0], role: 'geography' as const }] : []),
        { term: 'heart', role: 'clinical' },
      ],
      clinical_themes: ['heart failure'],
      metric_search_queries: ['heart failure mortality', 'MORT_30_HF'],
      hospital_natural_hints: [],
      explicit_hospital_hints: [],
      hospital_selection: hsel,
      compare_focus: 'metrics_first',
      retrieval_intent: 'Mock retrieval intent.',
      include_national: true,
      metric_candidates: [],
      ranking_bias: 'neutral',
    },
    clarifications: [],
    planning_events: [
      { id: 'parse_intent', label: 'Parse intent', detail: 'Mock: interpreted question locally.' },
      { id: 'choose_measures', label: 'Choose measures', detail: 'Mock: full-glossary resolution skipped (no API).' },
      { id: 'validate_plan', label: 'Validate', detail: 'Mock: guardrails skipped (no API).' },
    ],
    resolution_notes: ['Mock mode: server-side resolution not executed.'],
    resolved_retrieval: null,
    plan_debug: {
      user_question: question,
      effective_queries: ['mock'],
      ranking_bias_effective: 'neutral',
      raw_planner: { mock: true },
    },
  };
}

function mockRetrieve(traceId: string, measureIds: string[], locationTokens: string[]): ResearchRetrieveResult {
  return {
    trace_id: traceId,
    series_by_measure: Object.fromEntries(
      measureIds.map((id) => [
        id,
        {
          measure_id: id,
          locations: locationTokens,
          rows: [],
        } satisfies SeriesResponse,
      ]),
    ),
    validation_warnings: ['Mock mode: empty series fixtures. Run API for real retrieval.'],
    question: '',
    readiness: {
      status: 'thin',
      warnings: ['Mock mode: no rows.'],
      coverage: { num_measures: measureIds.length, num_rows: 0, years: [] },
    },
    metric_evidence: [],
    evidence_digest: null,
  };
}

function mockSummary(): ResearchSummaryResult {
  return {
    markdown: [
      '## What you asked',
      '',
      'Mock mode preview — connect the API for live retrieval and LLM narrative.',
      '',
      '## What we pulled (scope)',
      '',
      '- See **Plan details** for resolved measures and geography.',
      '',
      '## Findings',
      '',
      '- Open **Charts** after a live run to read values from the snapshot only.',
      '',
      '## Limitations and data gaps',
      '',
      '- Stub retrieval may return empty series; grounded narrative off in demo.',
    ].join('\n'),
    citations: [],
    evidence: {
      title: 'Mock research preview',
      abstract: 'Demo mode uses empty fixtures; connect the API for structured evidence from real retrieval.',
      key_findings: ['Mock readiness is thin by design.'],
      retrieval_scope: ['Measures: see plan', 'Locations: see plan'],
      limitations: ['No live CMS rows in mock mode.'],
      markdown: '',
    },
  };
}

export async function getResearchHealth(): Promise<ResearchHealthResult> {
  if (useMockDemo() || !hasLiveApi()) {
    return { ollama_configured: false, model: null };
  }
  return fetchJson<ResearchHealthResult>('/research/health');
}

export async function postResearchPlan(body: {
  question: string;
  conversationContext?: string | null;
  sessionSlots?: ResearchSessionSlots | null;
}): Promise<ResearchPlanResult> {
  if (useMockDemo() || !hasLiveApi()) {
    return mockPlan(body.question);
  }
  return postJson<ResearchPlanResult>('/research/plan', {
    question: body.question,
    conversation_context: body.conversationContext ?? null,
    session_slots: body.sessionSlots ?? null,
  });
}

export async function postResearchRetrieve(body: {
  trace_id: string;
  measure_ids: string[];
  location_tokens: string[];
  include_national: boolean;
  resolved_retrieval?: Record<string, unknown> | null;
  planEcho?: Record<string, unknown> | null;
}): Promise<ResearchRetrieveResult> {
  if (useMockDemo() || !hasLiveApi()) {
    return mockRetrieve(body.trace_id, body.measure_ids, body.location_tokens);
  }
  return postJson<ResearchRetrieveResult>('/research/retrieve', {
    trace_id: body.trace_id,
    measure_ids: body.measure_ids,
    location_tokens: body.location_tokens,
    include_national: body.include_national,
    resolved_retrieval: body.resolved_retrieval ?? null,
    plan_echo: body.planEcho ?? null,
  });
}

export async function postResearchSummary(body: {
  trace_id: string;
  retrieval_snapshot: Record<string, unknown>;
}): Promise<ResearchSummaryResult> {
  if (useMockDemo() || !hasLiveApi()) {
    return mockSummary();
  }
  return postJson<ResearchSummaryResult>('/research/summary', body);
}

export async function postResearchMetricsSearch(body: { q: string; limit?: number }): Promise<{
  query: string;
  metrics: MetricSearchHit[];
  count: number;
}> {
  if (useMockDemo() || !hasLiveApi()) {
    return { query: body.q, metrics: [], count: 0 };
  }
  return postJson('/research/metrics/search', { q: body.q, limit: body.limit ?? 40 });
}

export async function postResearchHospitalsSearch(body: {
  q: string;
  state?: string | null;
  limit?: number;
}): Promise<{ query: string; state: string | null; options: { label: string; value: string }[]; count: number }> {
  if (useMockDemo() || !hasLiveApi()) {
    return { query: body.q, state: body.state ?? null, options: [], count: 0 };
  }
  return postJson('/research/hospitals/search', {
    q: body.q,
    state: body.state ?? null,
    limit: body.limit ?? 30,
  });
}

export async function getResearchMetricCatalog(params?: { limit?: number; cursor?: string | null }): Promise<{
  items: { measure_id: string; title: string; interpretation: string; is_volume: boolean; tags: string[] }[];
  next_cursor: string | null;
}> {
  if (useMockDemo() || !hasLiveApi()) {
    return {
      items: [
        {
          measure_id: 'MORT_30_HF',
          title: 'Death rate for heart failure patients',
          interpretation: 'Heart failure mortality (30-day)',
          is_volume: false,
          tags: ['outcome', 'cardiac'],
        },
      ],
      next_cursor: null,
    };
  }
  const sp = new URLSearchParams();
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.cursor) sp.set('cursor', params.cursor);
  const q = sp.toString();
  const path = `/research/metrics/catalog${q ? `?${q}` : ''}`;
  return fetchJson(path);
}
