/**
 * universal-planner.ts — M6 Universal Engine Planning Layer
 *
 * Provides `buildUniversalPlan`, the entry-point that converts a free-form
 * concept string + context into a typed `UniversalPlan`.
 *
 * Two execution paths:
 *   1. Heuristic (default / no adapter) — pure, synchronous, deterministic.
 *      Safe for tests and offline environments.
 *   2. LLM-assisted (adapter provided) — calls the configured model, parses
 *      the response, and falls back to heuristic on parse failure.
 *
 * Model cap (M6): GPT-5.4 / Claude Sonnet 4.6 maximum — any adapter whose
 * modelId is not in ALLOWED_MODELS throws `ModelCapViolationError` before
 * any network call is made.
 *
 * Design constraints:
 *   - No ToolForge — missingTools is always [] from this layer.
 *   - No gateway / orchestrator — callers wire their own lifecycle.
 *   - No side-effects in the heuristic path (zero I/O).
 */

import { createHash } from 'node:crypto';
import type { CollaborationPlan, CollaborationStep } from './planner';

// ─── Phase Enum ──────────────────────────────────────────────────────────────

export type EnginePhase = 'plan' | 'research' | 'execute' | 'critique' | 'postmortem' | 'memory_persist' | 'done';

// ─── Model Cap ───────────────────────────────────────────────────────────────

/**
 * Exhaustive allowlist of models permitted in M6.
 * Mirrors the set in `runtime/universal/critic.ts` MODEL_FAMILY_MAP.
 */
export const M6_ALLOWED_MODELS = new Set([
  'gpt-5.4',
  'gpt-5.2',
  'gpt-5.4-mini',
  'gpt-4.1',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'claude-sonnet-4.6',
  'claude-haiku-4.5',
]);

export class ModelCapViolationError extends Error {
  constructor(modelId: string) {
    super(
      `universal-planner: model "${modelId}" exceeds M6 cap. ` +
      `Allowed: ${[...M6_ALLOWED_MODELS].join(', ')}`,
    );
    this.name = 'ModelCapViolationError';
  }
}

export function assertM6ModelCap(modelId: string): void {
  if (!M6_ALLOWED_MODELS.has(modelId)) throw new ModelCapViolationError(modelId);
}

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface UniversalPlanContext {
  /** Optional workspace scope for multi-workspace runtimes. */
  workspaceId?: string;
  /**
   * Standing strategy instructions injected into the planning prompt.
   * Sorted before hashing to keep the idempotency key stable.
   */
  strategies?: string[];
  /** Names of tools already registered — used to skip re-forging. */
  existingTools?: string[];
  /** Cap on how many phases the engine may emit (default: unlimited). */
  maxPhases?: number;
  /** Deterministic bounded-lookahead guard for Planner/SelfHeal exploration. */
  lookahead?: BoundedLookaheadConfig;
  /**
   * Injectable clock for deterministic tests.
   * Excluded from idempotency-key computation so the key is time-invariant.
   */
  now?: () => string;
}

export interface BoundedLookaheadConfig {
  maxBranches: number;
  maxDepth: number;
  maxBacktracks: number;
  requiresNewEvidence?: boolean;
  evidenceSnapshotHash?: string;
  previousEvidenceSnapshotHash?: string;
}

export interface BoundedLookaheadUsage {
  branches: number;
  depth: number;
  backtracks: number;
}

export interface LookaheadDecision {
  allowed: boolean;
  reasonCodes: string[];
  effectiveLimits: {
    maxBranches: number;
    maxDepth: number;
    maxBacktracks: number;
  };
}

export class LookaheadBoundsViolationError extends Error {
  constructor(public readonly decision: LookaheadDecision) {
    super(`universal-planner: lookahead bounds violated [${decision.reasonCodes.join(', ')}]`);
    this.name = 'LookaheadBoundsViolationError';
  }
}

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  /** IDs of steps that must complete before this one starts. */
  dependsOn: string[];
  /** Soft token budget hint for downstream budget controllers. */
  estimatedTokensBudget?: number;
}

export interface PlanDocument {
  schemaVersion: 'pyrfor.plan.v1';
  /** sha256 of the canonical (concept, context) pair — time-invariant. */
  idempotencyKey: string;
  /** sha256 of the raw concept string only. */
  conceptHash: string;
  createdAt: string;
  concept: string;
  phases: EnginePhase[];
  steps: PlanStep[];
  researchRequired: boolean;
  researchTopics: string[];
  /**
   * Tools that would be needed but are not in existingTools.
   * Always [] in M6 (ToolForge is out of scope).
   */
  missingTools: string[];
  rationale: string;
}

export interface UniversalPlan extends CollaborationPlan {
  planDocument: PlanDocument;
  phases: EnginePhase[];
  researchRequired: boolean;
  /** Always [] in M6. */
  missingTools: string[];
  idempotencyKey: string;
}

export interface UniversalPlanLLMAdapter {
  /** Must be in M6_ALLOWED_MODELS or buildUniversalPlan throws. */
  modelId: string;
  /**
   * Execute a single completion turn.
   * Expected to return a JSON string parseable into a PlanDocument subset.
   */
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

// ─── Idempotency Key ─────────────────────────────────────────────────────────

/**
 * Compute a stable sha256 over the (concept, context) pair.
 * `context.now` is excluded so the key is independent of wall-clock time.
 */
export function computePlanIdempotencyKey(
  concept: string,
  context: UniversalPlanContext,
): string {
  const stable = {
    concept,
    workspaceId: context.workspaceId ?? null,
    strategies: [...(context.strategies ?? [])].sort(),
    existingTools: [...(context.existingTools ?? [])].sort(),
    maxPhases: context.maxPhases ?? null,
    lookahead: context.lookahead ?? null,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

// ─── Heuristic Analysis ──────────────────────────────────────────────────────

const RESEARCH_RE =
  /\b(research|investigate|find\s+out|study|analyze|analyse|learn\s+about|discover|explore|survey)\b/i;

const COMPLEXITY_RE =
  /\b(integrate|build|implement|create|design|architect|develop|deploy|migrate|refactor|orchestrate)\b/i;

const RESEARCH_TOPIC_RE =
  /(?:research|investigate|find(?:\s+out)?|study|analyze|learn(?:\s+about)?)\s+(?:the\s+|a\s+)?([^,.;]{3,60})/i;

const LOOKAHEAD_HARD_CAPS = Object.freeze({
  maxBranches: 5,
  maxDepth: 8,
  maxBacktracks: 3,
});

export function evaluateLookaheadBounds(
  config: BoundedLookaheadConfig | undefined,
  usage: BoundedLookaheadUsage,
): LookaheadDecision {
  const effectiveLimits = {
    maxBranches: clampLimit(config?.maxBranches, LOOKAHEAD_HARD_CAPS.maxBranches),
    maxDepth: clampLimit(config?.maxDepth, LOOKAHEAD_HARD_CAPS.maxDepth),
    maxBacktracks: clampLimit(config?.maxBacktracks, LOOKAHEAD_HARD_CAPS.maxBacktracks),
  };
  const reasonCodes: string[] = [];

  if (usage.branches > effectiveLimits.maxBranches) reasonCodes.push('max_branches_exceeded');
  if (usage.depth > effectiveLimits.maxDepth) reasonCodes.push('max_depth_exceeded');
  if (usage.backtracks > effectiveLimits.maxBacktracks) reasonCodes.push('max_backtracks_exceeded');
  if (
    config?.requiresNewEvidence === true &&
    config.previousEvidenceSnapshotHash !== undefined &&
    config.evidenceSnapshotHash === config.previousEvidenceSnapshotHash
  ) {
    reasonCodes.push('new_evidence_required');
  }

  return {
    allowed: reasonCodes.length === 0,
    reasonCodes,
    effectiveLimits,
  };
}

function extractResearchTopics(concept: string): string[] {
  const topics: string[] = [];
  const m = RESEARCH_TOPIC_RE.exec(concept);
  if (m?.[1]) {
    topics.push(m[1].trim());
  } else {
    // Fall back: use the first 60 chars of the concept as the topic
    topics.push(concept.slice(0, 60).trim());
  }
  return topics;
}

function buildHeuristicSteps(concept: string, phases: EnginePhase[]): PlanStep[] {
  return phases
    .filter((p): p is Exclude<EnginePhase, 'done'> => p !== 'done')
    .map((phase, index) => ({
      id: `step-${index + 1}-${phase}`,
      title: phaseTitle(phase, concept),
      description: phaseDescription(phase, concept),
      acceptanceCriteria: phaseAcceptanceCriteria(phase),
      dependsOn: index === 0 ? [] : [`step-${index}-${phases[index - 1]}`],
      estimatedTokensBudget: phaseTokenBudget(phase),
    }));
}

function clampLimit(value: number | undefined, hardCap: number): number {
  if (value === undefined) return hardCap;
  return Math.max(0, Math.min(Math.floor(value), hardCap));
}

function phaseTitle(phase: Exclude<EnginePhase, 'done'>, concept: string): string {
  const short = concept.length > 60 ? `${concept.slice(0, 57)}…` : concept;
  const map: Record<Exclude<EnginePhase, 'done'>, string> = {
    plan: `Plan: ${short}`,
    research: `Research: ${short}`,
    execute: `Execute: ${short}`,
    critique: `Critique: ${short}`,
    postmortem: `Postmortem: ${short}`,
    memory_persist: `Memory persist: ${short}`,
  };
  return map[phase];
}

function phaseDescription(phase: Exclude<EnginePhase, 'done'>, _concept: string): string {
  const map: Record<Exclude<EnginePhase, 'done'>, string> = {
    plan: 'Decompose the concept into concrete, ordered steps with explicit acceptance criteria.',
    research: 'Gather evidence and facts required before execution can begin.',
    execute: 'Carry out the planned steps against the workspace.',
    critique: 'Verify all acceptance criteria are met; raise rework requests if not.',
    postmortem: 'Summarize the governed run outcome and capture reusable evidence-backed lessons.',
    memory_persist: 'Persist approved lessons to durable memory with provenance and auditability.',
  };
  return map[phase];
}

function phaseAcceptanceCriteria(phase: Exclude<EnginePhase, 'done'>): string[] {
  const map: Record<Exclude<EnginePhase, 'done'>, string[]> = {
    plan: ['PlanDocument artifact is written', 'All required phases are listed', 'At least one step defined'],
    research: ['ResearchResult artifact is written', 'At least one source captured or offline fallback recorded'],
    execute: ['All plan steps attempted', 'No unhandled exceptions'],
    critique: ['CriticReport artifact is written', 'aggregateVerdict is "pass" or "rework" recorded'],
    postmortem: ['PostMortem artifact is written', 'Terminal outcome is summarized with evidence refs'],
    memory_persist: ['Historian distillation runs', 'At least one durable lesson write or explicit failure is recorded'],
  };
  return map[phase];
}

function phaseTokenBudget(phase: Exclude<EnginePhase, 'done'>): number {
  const map: Record<Exclude<EnginePhase, 'done'>, number> = {
    plan: 2_000,
    research: 4_000,
    execute: 8_000,
    critique: 2_000,
    postmortem: 1_000,
    memory_persist: 1_000,
  };
  return map[phase];
}

// ─── Heuristic Plan Builder (pure, no I/O) ──────────────────────────────────

/**
 * Build a `UniversalPlan` purely from heuristics — no LLM call, no I/O.
 * This is the deterministic fallback used by tests and offline environments.
 */
export function buildUniversalPlanHeuristic(
  concept: string,
  context: UniversalPlanContext,
): UniversalPlan {
  if (!concept.trim()) throw new Error('universal-planner: concept must not be empty');

  const idempotencyKey = computePlanIdempotencyKey(concept, context);
  const conceptHash = createHash('sha256').update(concept).digest('hex');
  const createdAt = (context.now ?? (() => new Date().toISOString()))();
  const researchRequired = RESEARCH_RE.test(concept);
  const isComplex = concept.length > 150 || COMPLEXITY_RE.test(concept);

  const phases: EnginePhase[] = ['plan'];
  if (researchRequired) phases.push('research');
  phases.push('execute', 'critique', 'done');

  const researchTopics = researchRequired ? extractResearchTopics(concept) : [];
  const steps = buildHeuristicSteps(concept, phases);
  const lookaheadDecision = evaluateLookaheadBounds(context.lookahead, {
    branches: Math.max(1, phases.filter((phase) => phase !== 'done').length - 1),
    depth: steps.length,
    backtracks: 0,
  });
  if (!lookaheadDecision.allowed) throw new LookaheadBoundsViolationError(lookaheadDecision);

  const planDocument: PlanDocument = {
    schemaVersion: 'pyrfor.plan.v1',
    idempotencyKey,
    conceptHash,
    createdAt,
    concept,
    phases,
    steps,
    researchRequired,
    researchTopics,
    missingTools: [],
    rationale: researchRequired
      ? 'Concept requires evidence gathering before execution.'
      : isComplex
      ? 'Concept is complex enough to warrant a multi-phase approach.'
      : 'Straightforward execution plan.',
  };

  const collaborationSteps: CollaborationStep[] = isComplex
    ? [
        {
          agentId: 'quality-guardian',
          focus: 'Validate plan completeness, acceptance criteria, and likely failure modes.',
          role: 'reviewer',
        },
      ]
    : [];

  return {
    collaborative: isComplex,
    leaderAgentId: 'universal-engine',
    reason: planDocument.rationale,
    steps: collaborationSteps,
    planDocument,
    phases,
    researchRequired,
    missingTools: [],
    idempotencyKey,
  };
}

// ─── LLM-Assisted Plan Builder ───────────────────────────────────────────────

const PLAN_SYSTEM_PROMPT = `You are a planning assistant for the Pyrfor Universal Engine.
Given a concept, return a JSON object with these fields (and only these fields):
{
  "phases": ["plan", ...],        // subset of: plan, research, execute, critique, done
  "researchRequired": boolean,
  "researchTopics": string[],
  "rationale": string
}
Return only valid JSON. Do not include markdown code fences.`;

function buildPlanUserPrompt(concept: string, context: UniversalPlanContext): string {
  const strategyBlock = (context.strategies ?? []).length > 0
    ? `\nStanding strategies:\n${context.strategies!.map(s => `- ${s}`).join('\n')}`
    : '';
  return `Concept: ${concept}${strategyBlock}`;
}

interface LLMPlanResponse {
  phases?: string[];
  researchRequired?: boolean;
  researchTopics?: string[];
  rationale?: string;
}

function parseLLMPlanResponse(raw: string): LLMPlanResponse | null {
  try {
    return JSON.parse(raw) as LLMPlanResponse;
  } catch {
    return null;
  }
}

const VALID_PHASES = new Set<string>(['plan', 'research', 'execute', 'critique', 'done']);

function normalizeLLMPhases(phases: unknown): EnginePhase[] {
  if (!Array.isArray(phases)) return ['plan', 'execute', 'critique', 'done'];
  const normalized = phases.filter((p): p is EnginePhase =>
    typeof p === 'string' && VALID_PHASES.has(p),
  );
  if (!normalized.includes('plan')) normalized.unshift('plan');
  if (!normalized.includes('done')) normalized.push('done');
  return normalized;
}

/**
 * Build a `UniversalPlan` from a concept string.
 *
 * @param concept    Free-form task description.
 * @param context    Runtime context (workspace, strategies, existing tools).
 * @param llmAdapter Optional LLM adapter. Must use an M6-allowed model.
 *                   If omitted or if the LLM response cannot be parsed, falls
 *                   back to the deterministic heuristic plan.
 */
export async function buildUniversalPlan(
  concept: string,
  context: UniversalPlanContext,
  llmAdapter?: UniversalPlanLLMAdapter,
): Promise<UniversalPlan> {
  if (!concept.trim()) throw new Error('universal-planner: concept must not be empty');

  if (llmAdapter) assertM6ModelCap(llmAdapter.modelId);

  const heuristic = buildUniversalPlanHeuristic(concept, context);

  if (!llmAdapter) return heuristic;

  let raw: string;
  try {
    raw = await llmAdapter.complete(PLAN_SYSTEM_PROMPT, buildPlanUserPrompt(concept, context));
  } catch {
    // Network / quota failure — fall back silently
    return heuristic;
  }

  const parsed = parseLLMPlanResponse(raw);
  if (!parsed) return heuristic;

  const phases = normalizeLLMPhases(parsed.phases);
  const researchRequired = typeof parsed.researchRequired === 'boolean'
    ? parsed.researchRequired
    : heuristic.researchRequired;
  const researchTopics = Array.isArray(parsed.researchTopics) && parsed.researchTopics.length > 0
    ? parsed.researchTopics.map(String)
    : heuristic.planDocument.researchTopics;
  const rationale = typeof parsed.rationale === 'string' && parsed.rationale.trim()
    ? parsed.rationale.trim()
    : heuristic.planDocument.rationale;

  const idempotencyKey = heuristic.idempotencyKey;
  const conceptHash = heuristic.planDocument.conceptHash;
  const createdAt = heuristic.planDocument.createdAt;
  const steps = buildHeuristicSteps(concept, phases);
  const lookaheadDecision = evaluateLookaheadBounds(context.lookahead, {
    branches: Math.max(1, phases.filter((phase) => phase !== 'done').length - 1),
    depth: steps.length,
    backtracks: 0,
  });
  if (!lookaheadDecision.allowed) return heuristic;

  const planDocument: PlanDocument = {
    schemaVersion: 'pyrfor.plan.v1',
    idempotencyKey,
    conceptHash,
    createdAt,
    concept,
    phases,
    steps,
    researchRequired,
    researchTopics,
    missingTools: [],
    rationale,
  };

  return {
    ...heuristic,
    planDocument,
    phases,
    researchRequired,
    idempotencyKey,
  };
}
