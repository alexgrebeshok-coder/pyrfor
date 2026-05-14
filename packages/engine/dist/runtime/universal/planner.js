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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { buildUniversalPlan, computePlanIdempotencyKey, } from '../../ai/orchestration/universal-planner.js';
const INJECTION_PATTERNS = [
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
export function scanForInjection(input) {
    const violations = [];
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
    constructor(violations) {
        const kinds = [...new Set(violations.map((v) => v.kind))].join(', ');
        super(`universal-planner: injection detected in concept [${kinds}]`);
        this.violations = violations;
        this.name = 'InjectionDetectedError';
    }
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
    constructor(deps) {
        this.cache = new Map();
        this.deps = deps;
    }
    /**
     * Generate (or retrieve from cache) a plan for the given concept.
     *
     * @throws InjectionDetectedError if the concept contains injection patterns.
     * @throws ModelCapViolationError  if the llmAdapter exceeds the M6 model cap.
     */
    plan(concept, context, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            // ── Safety gate ────────────────────────────────────────────────────────
            const scanResult = scanForInjection(concept);
            if (!scanResult.safe)
                throw new InjectionDetectedError(scanResult.violations);
            const clarification = yield ((_a = this.deps.clarifier) === null || _a === void 0 ? void 0 : _a.clarify(concept));
            const effectiveConcept = clarification && clarification.stoppedAt !== 'trivially_clear'
                ? clarification.refinedConcept
                : concept;
            if (effectiveConcept !== concept) {
                const refinedScan = scanForInjection(effectiveConcept);
                if (!refinedScan.safe)
                    throw new InjectionDetectedError(refinedScan.violations);
            }
            // ── Idempotency check ─────────────────────────────────────────────────
            const idempotencyKey = computePlanIdempotencyKey(effectiveConcept, context);
            const cached = this.cache.get(idempotencyKey);
            if (cached)
                return Object.assign(Object.assign({}, cached), { cacheHit: true });
            // ── Build plan ────────────────────────────────────────────────────────
            const universalPlan = yield buildUniversalPlan(effectiveConcept, context, this.deps.llmAdapter);
            const planRef = yield this.deps.artifactStore.writeJSON('plan', universalPlan.planDocument, {
                runId: opts === null || opts === void 0 ? void 0 : opts.runId,
                meta: { idempotencyKey },
            });
            const result = Object.assign({ planRef, plan: universalPlan.planDocument, phases: universalPlan.phases, missingTools: universalPlan.missingTools, researchTopics: universalPlan.planDocument.researchTopics, idempotencyKey }, (clarification && clarification.stoppedAt !== 'trivially_clear' ? { clarification } : {}));
            this.cache.set(idempotencyKey, result);
            return Object.assign(Object.assign({}, result), { cacheHit: false });
        });
    }
    /** Evict all cached plans. Useful in tests or after strategy updates. */
    clearCache() {
        this.cache.clear();
    }
}
