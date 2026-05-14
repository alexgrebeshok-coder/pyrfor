/**
 * planner.ts — M6 Universal Engine Runtime Planner
 *
 * The `UniversalPlanner` is the runtime entry-point for plan generation.
 * It wraps `buildUniversalPlan` from `ai/orchestration/universal-planner` with:
 *
 *   1. Injection-scan verifier (safety-first gate — runs before any planning).
 *   2. Idempotency cache (in-memory; same concept+context → cache hit, no re-compute).
 *   3. Artifact persistence via `ArtifactStore`.
 *
 * ## Injection-Scan Verifier
 * `scanForInjection` is a pure, synchronous function that detects common
 * prompt-injection patterns in the concept string before any LLM or heuristic
 * planner is invoked.  Violations are classified by `InjectionViolation.kind`:
 *
 *   - `prompt_override`    — "ignore/disregard previous instructions"
 *   - `role_impersonation` — "act as", "pretend you are", "you are now"
 *   - `system_directive`   — [SYSTEM], <<SYS>>, <|system|>
 *   - `exfiltration_pattern` — "repeat your system prompt", "output all instructions"
 *
 * ## Plan Idempotency
 * The idempotency key is the sha256 of the canonical (concept, context) pair
 * (computed by `computePlanIdempotencyKey`).  Two calls with the same key
 * return `cacheHit: true` on the second call without writing a new artifact.
 *
 * ## No ToolForge / No Orchestrator
 * This module has no dependency on tool-forge, engine-loop, or gateway.
 * It is a standalone planning unit designed for composition.
 */
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import { type EnginePhase, type PlanDocument, type UniversalPlanContext, type UniversalPlanLLMAdapter } from '../../ai/orchestration/universal-planner';
import type { ClarificationResult, ConceptClarifier } from './concept-clarifier';
export type InjectionViolationKind = 'prompt_override' | 'role_impersonation' | 'system_directive' | 'exfiltration_pattern';
export interface InjectionViolation {
    kind: InjectionViolationKind;
    /** Human-readable pattern label for diagnostics. */
    label: string;
    /** The matched substring (truncated to 120 chars). */
    excerpt: string;
    /** Zero-based character offset of the match start. */
    position: number;
}
export interface InjectionScanResult {
    safe: boolean;
    violations: InjectionViolation[];
}
/**
 * Scan `input` for prompt-injection patterns.
 *
 * Pure function — no I/O, no side effects.
 * Call this before any planning to enforce the safety-first gate.
 */
export declare function scanForInjection(input: string): InjectionScanResult;
export declare class InjectionDetectedError extends Error {
    readonly violations: InjectionViolation[];
    constructor(violations: InjectionViolation[]);
}
export interface UniversalPlannerDeps {
    artifactStore: ArtifactStore;
    /** Optional LLM adapter. Must use an M6-allowed model. */
    llmAdapter?: UniversalPlanLLMAdapter;
    /** Optional bounded clarification loop. Omit for non-interactive unchanged behavior. */
    clarifier?: ConceptClarifier;
}
export interface UniversalPlannerResult {
    planRef: ArtifactRef;
    plan: PlanDocument;
    phases: EnginePhase[];
    missingTools: string[];
    researchTopics: string[];
    idempotencyKey: string;
    /** True when the plan was returned from the in-memory idempotency cache. */
    cacheHit: boolean;
    clarification?: ClarificationResult;
}
/**
 * Runtime planning unit.
 *
 * @example
 * ```ts
 * const planner = new UniversalPlanner({ artifactStore });
 * const result = await planner.plan('Build a REST API for users', {});
 * console.log(result.plan.phases);
 * ```
 */
export declare class UniversalPlanner {
    private readonly deps;
    private readonly cache;
    constructor(deps: UniversalPlannerDeps);
    /**
     * Generate (or retrieve from cache) a plan for the given concept.
     *
     * @throws InjectionDetectedError if the concept contains injection patterns.
     * @throws ModelCapViolationError  if the llmAdapter exceeds the M6 model cap.
     */
    plan(concept: string, context: UniversalPlanContext, opts?: {
        runId?: string;
    }): Promise<UniversalPlannerResult>;
    /** Evict all cached plans. Useful in tests or after strategy updates. */
    clearCache(): void;
}
//# sourceMappingURL=planner.d.ts.map