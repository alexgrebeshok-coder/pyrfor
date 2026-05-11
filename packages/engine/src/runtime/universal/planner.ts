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
import {
  buildUniversalPlan,
  computePlanIdempotencyKey,
  type EnginePhase,
  type PlanDocument,
  type UniversalPlanContext,
  type UniversalPlanLLMAdapter,
} from '../../ai/orchestration/universal-planner';

// ─── Injection-Scan Verifier ─────────────────────────────────────────────────

export type InjectionViolationKind =
  | 'prompt_override'
  | 'role_impersonation'
  | 'system_directive'
  | 'exfiltration_pattern';

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

interface InjectionPattern {
  kind: InjectionViolationKind;
  label: string;
  re: RegExp;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // Prompt override
  {
    kind: 'prompt_override',
    label: 'override-previous-instructions',
    re: /\b(ignore|disregard|forget|override|bypass|skip)\s+(all\s+)?(previous|prior|above|earlier|original)\s+(instructions?|rules?|constraints?|guidelines?|prompts?)/i,
  },
  {
    kind: 'prompt_override',
    label: 'negate-do-not-follow',
    re: /\b(do not follow|don'?t follow|don'?t adhere to|ignore all)\b/i,
  },
  // Role impersonation
  {
    kind: 'role_impersonation',
    label: 'role-impersonation',
    re: /\b(you are now|you will now be|from now on you are|henceforth you are|act as|pretend(?:\s+to be|\s+you are)|roleplay\s+as|speak\s+as)\b/i,
  },
  // System directives
  {
    kind: 'system_directive',
    label: 'system-marker',
    re: /\[SYSTEM\]|\[SYS\]|<<SYS>>|<\|system\|>|SYSTEM\s+OVERRIDE|SYSTEM\s+PROMPT/i,
  },
  // Exfiltration
  {
    kind: 'exfiltration_pattern',
    label: 'exfiltration-output-instructions',
    re: /\b(send|output|print|reveal|expose|leak|transmit)\s+(all|everything|entire|your|the\s+full)\s+(instructions?|prompt|context|system|secret|key|token|password)/i,
  },
  {
    kind: 'exfiltration_pattern',
    label: 'exfiltration-repeat-above',
    re: /\brepeat\s+(everything|the\s+above|your\s+instructions?|your\s+system\s+prompt|all\s+instructions?)\b/i,
  },
];

/**
 * Scan `input` for prompt-injection patterns.
 *
 * Pure function — no I/O, no side effects.
 * Call this before any planning to enforce the safety-first gate.
 */
export function scanForInjection(input: string): InjectionScanResult {
  const violations: InjectionViolation[] = [];
  for (const { kind, label, re } of INJECTION_PATTERNS) {
    const m = re.exec(input);
    if (m) {
      violations.push({
        kind,
        label,
        excerpt: input.slice(m.index, m.index + 120),
        position: m.index,
      });
    }
  }
  return { safe: violations.length === 0, violations };
}

// ─── InjectionDetectedError ──────────────────────────────────────────────────

export class InjectionDetectedError extends Error {
  constructor(public readonly violations: InjectionViolation[]) {
    const kinds = [...new Set(violations.map((v) => v.kind))].join(', ');
    super(`universal-planner: injection detected in concept [${kinds}]`);
    this.name = 'InjectionDetectedError';
  }
}

// ─── UniversalPlanner ────────────────────────────────────────────────────────

export interface UniversalPlannerDeps {
  artifactStore: ArtifactStore;
  /** Optional LLM adapter. Must use an M6-allowed model. */
  llmAdapter?: UniversalPlanLLMAdapter;
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
export class UniversalPlanner {
  private readonly deps: UniversalPlannerDeps;
  private readonly cache = new Map<string, Omit<UniversalPlannerResult, 'cacheHit'>>();

  constructor(deps: UniversalPlannerDeps) {
    this.deps = deps;
  }

  /**
   * Generate (or retrieve from cache) a plan for the given concept.
   *
   * @throws InjectionDetectedError if the concept contains injection patterns.
   * @throws ModelCapViolationError  if the llmAdapter exceeds the M6 model cap.
   */
  async plan(
    concept: string,
    context: UniversalPlanContext,
    opts?: { runId?: string },
  ): Promise<UniversalPlannerResult> {
    // ── Safety gate ────────────────────────────────────────────────────────
    const scanResult = scanForInjection(concept);
    if (!scanResult.safe) throw new InjectionDetectedError(scanResult.violations);

    // ── Idempotency check ─────────────────────────────────────────────────
    const idempotencyKey = computePlanIdempotencyKey(concept, context);
    const cached = this.cache.get(idempotencyKey);
    if (cached) return { ...cached, cacheHit: true };

    // ── Build plan ────────────────────────────────────────────────────────
    const universalPlan = await buildUniversalPlan(concept, context, this.deps.llmAdapter);

    const planRef = await this.deps.artifactStore.writeJSON('plan', universalPlan.planDocument, {
      runId: opts?.runId,
      meta: { idempotencyKey },
    });

    const result: Omit<UniversalPlannerResult, 'cacheHit'> = {
      planRef,
      plan: universalPlan.planDocument,
      phases: universalPlan.phases,
      missingTools: universalPlan.missingTools,
      researchTopics: universalPlan.planDocument.researchTopics,
      idempotencyKey,
    };

    this.cache.set(idempotencyKey, result);
    return { ...result, cacheHit: false };
  }

  /** Evict all cached plans. Useful in tests or after strategy updates. */
  clearCache(): void {
    this.cache.clear();
  }
}
