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
import type { CollaborationPlan } from './planner';
export type EnginePhase = 'plan' | 'research' | 'execute' | 'critique' | 'postmortem' | 'memory_persist' | 'done';
/**
 * Exhaustive allowlist of models permitted in M6.
 * Mirrors the set in `runtime/universal/critic.ts` MODEL_FAMILY_MAP.
 */
export declare const M6_ALLOWED_MODELS: Set<string>;
export declare class ModelCapViolationError extends Error {
    constructor(modelId: string);
}
export declare function assertM6ModelCap(modelId: string): void;
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
export declare class LookaheadBoundsViolationError extends Error {
    readonly decision: LookaheadDecision;
    constructor(decision: LookaheadDecision);
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
/**
 * Compute a stable sha256 over the (concept, context) pair.
 * `context.now` is excluded so the key is independent of wall-clock time.
 */
export declare function computePlanIdempotencyKey(concept: string, context: UniversalPlanContext): string;
export declare function evaluateLookaheadBounds(config: BoundedLookaheadConfig | undefined, usage: BoundedLookaheadUsage): LookaheadDecision;
/**
 * Build a `UniversalPlan` purely from heuristics — no LLM call, no I/O.
 * This is the deterministic fallback used by tests and offline environments.
 */
export declare function buildUniversalPlanHeuristic(concept: string, context: UniversalPlanContext): UniversalPlan;
/**
 * Build a `UniversalPlan` from a concept string.
 *
 * @param concept    Free-form task description.
 * @param context    Runtime context (workspace, strategies, existing tools).
 * @param llmAdapter Optional LLM adapter. Must use an M6-allowed model.
 *                   If omitted or if the LLM response cannot be parsed, falls
 *                   back to the deterministic heuristic plan.
 */
export declare function buildUniversalPlan(concept: string, context: UniversalPlanContext, llmAdapter?: UniversalPlanLLMAdapter): Promise<UniversalPlan>;
//# sourceMappingURL=universal-planner.d.ts.map