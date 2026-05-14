import { useCallback, useEffect, useState } from 'react';
import {
  getResearchHealth,
  postResearchPlan,
  postResearchRetrieve,
  postResearchSummary,
  type PlanningEvent,
  type ResearchHealthResult,
  type ResearchPlanResult,
  type ResearchRetrieveResult,
  type ResearchSessionSlots,
  type ResearchSummaryResult,
} from '@/services/researchApi';
import {
  buildAugmentedPlanQuestion,
  buildSessionSlotsFromScope,
  defaultResearchPlanScope,
  mergeResearchSessionSlots,
  type ResearchPlanScopeDraft,
} from '@/features/research/researchPlanScope';
import { extractStateCodesFromText } from '@/lib/usStateCodes';

export type ResearchPhase =
  | 'idle'
  | 'planning'
  | 'awaiting_clarification'
  | 'retrieving'
  | 'summarizing'
  | 'done'
  | 'error';

export function planToLocationTokens(plan: ResearchPlanResult['plan']): string[] {
  return [...plan.states.map((s) => `S:${String(s).trim().toUpperCase().slice(0, 2)}`), ...plan.hospital_tokens];
}

export function useResearchSession() {
  const [phase, setPhase] = useState<ResearchPhase>('idle');
  const [stepLabel, setStepLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [baseQuestion, setBaseQuestion] = useState('');
  const [conversationContext, setConversationContext] = useState('');
  const [clarifyReply, setClarifyReply] = useState('');
  const [planScope, setPlanScope] = useState<ResearchPlanScopeDraft>(() => defaultResearchPlanScope());
  const [plan, setPlan] = useState<ResearchPlanResult | null>(null);
  const [planningEvents, setPlanningEvents] = useState<PlanningEvent[]>([]);
  const [retrieval, setRetrieval] = useState<ResearchRetrieveResult | null>(null);
  const [summary, setSummary] = useState<ResearchSummaryResult | null>(null);
  const [health, setHealth] = useState<ResearchHealthResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getResearchHealth()
      .then((h) => {
        if (!cancelled) setHealth(h);
      })
      .catch(() => {
        if (!cancelled) setHealth({ ollama_configured: false, model: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runRetrieveAndSummary = useCallback(async (p: ResearchPlanResult) => {
    try {
      const locToks = planToLocationTokens(p.plan);
      setStepLabel('Fetching series…');
      setPhase('retrieving');
      const r = await postResearchRetrieve({
        trace_id: p.trace_id,
        measure_ids: p.plan.measure_ids,
        location_tokens: locToks,
        include_national: p.plan.include_national ?? true,
        resolved_retrieval: p.resolved_retrieval ?? null,
        planEcho: {
          intent: p.plan.intent,
          states: p.plan.states,
          measure_ids: p.plan.measure_ids,
          retrieval_intent: p.plan.retrieval_intent ?? '',
          include_national: p.plan.include_national ?? true,
        },
      });
      setRetrieval(r);
      setStepLabel('Drafting grounded summary…');
      setPhase('summarizing');
      const plan_echo = {
        intent: p.plan.intent,
        states: p.plan.states,
        retrieval_intent: p.plan.retrieval_intent ?? '',
        measure_ids: p.plan.measure_ids,
        include_national: p.plan.include_national ?? true,
      };
      const snap = {
        trace_id: r.trace_id,
        series_by_measure: r.series_by_measure,
        validation_warnings: r.validation_warnings,
        question: r.question ?? '',
        readiness: r.readiness,
        metric_evidence: r.metric_evidence,
        evidence_digest: r.evidence_digest ?? null,
        plan_echo,
        include_national: p.plan.include_national ?? true,
      };
      const sum = await postResearchSummary({ trace_id: r.trace_id, retrieval_snapshot: snap });
      setSummary(sum);
      setPhase('done');
      setStepLabel('');
    } catch (e) {
      setPhase('error');
      setStepLabel('');
      setErr(e instanceof Error ? e.message : 'Request failed');
    }
  }, []);

  const runPlan = useCallback(
    async (q: string, ctx: string, sessionSlots?: ResearchSessionSlots | null) => {
      setErr(null);
      setSummary(null);
      setRetrieval(null);
      setPhase('planning');
      setStepLabel('Planning with catalog guardrails…');
      const scopeSlots = buildSessionSlotsFromScope(planScope);
      const mergedSlots = mergeResearchSessionSlots(scopeSlots, sessionSlots ?? null);
      const p = await postResearchPlan({
        question: q,
        conversationContext: ctx.trim() || null,
        sessionSlots: mergedSlots,
      });
      setPlan(p);
      setPlanningEvents(p.planning_events ?? []);
      if (p.plan.needs_clarification) {
        setPhase('awaiting_clarification');
        setClarifyReply('');
        setStepLabel('');
        return;
      }
      await runRetrieveAndSummary(p);
    },
    [runRetrieveAndSummary, planScope],
  );

  const runAnalysis = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    try {
      setBaseQuestion(q);
      setConversationContext('');
      const augmented = buildAugmentedPlanQuestion(q, planScope);
      await runPlan(augmented, '', null);
    } catch (e) {
      setPhase('error');
      setStepLabel('');
      setErr(e instanceof Error ? e.message : 'Request failed');
    }
  }, [question, runPlan]);

  const continueAfterClarification = useCallback(async () => {
    const reply = clarifyReply.trim();
    if (!reply || !baseQuestion.trim()) return;
    try {
      const ctx = [conversationContext, `User: ${reply}`].filter(Boolean).join('\n\n');
      setConversationContext(ctx);
      const slotStates = extractStateCodesFromText(reply);
      const clarificationSlots: ResearchSessionSlots | null =
        slotStates.length > 0
          ? { geography: { states: slotStates, source: 'clarification', confirmed: true } }
          : null;
      setErr(null);
      setSummary(null);
      setRetrieval(null);
      const augmented = buildAugmentedPlanQuestion(baseQuestion.trim(), planScope);
      await runPlan(augmented, ctx, clarificationSlots);
    } catch (e) {
      setPhase('error');
      setStepLabel('');
      setErr(e instanceof Error ? e.message : 'Request failed');
    }
  }, [baseQuestion, clarifyReply, conversationContext, planScope, runPlan]);

  const clearAll = useCallback(() => {
    setQuestion('');
    setBaseQuestion('');
    setConversationContext('');
    setClarifyReply('');
    setPlanScope(defaultResearchPlanScope());
    setPlan(null);
    setPlanningEvents([]);
    setRetrieval(null);
    setSummary(null);
    setPhase('idle');
    setErr(null);
    setStepLabel('');
  }, []);

  const busyPlanning = phase === 'planning';
  const busyPipeline = phase === 'planning' || phase === 'retrieving' || phase === 'summarizing';

  return {
    phase,
    stepLabel,
    err,
    question,
    setQuestion,
    baseQuestion,
    conversationContext,
    clarifyReply,
    setClarifyReply,
    plan,
    planningEvents,
    retrieval,
    summary,
    health,
    runAnalysis,
    continueAfterClarification,
    clearAll,
    busyPlanning,
    busyPipeline,
  };
}
