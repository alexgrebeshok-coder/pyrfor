/**
 * pyrfor-fc-guardrails.ts
 *
 * Pre-validation layer that wires Pyrfor's Guardrails over FreeClaude's tool calls.
 *
 * Two modes:
 *   Mode A (pre-flight): populate FC --disallowed-tools from a hard-deny list before
 *     spawning, giving the FC process zero chance to even start a forbidden tool.
 *   Mode B (post-detect + abort): monitor the FC event stream; on each ToolCallStart /
 *     BashCommand, run guardrails.evaluate(); if the decision is deny/deny-once → abort
 *     the handle immediately.
 *
 * Note: FC executes tools without an ACP control hook in v1, so Mode B is reactive —
 * the guardrail can abort the run but cannot prevent a tool that has already started.
 */
import { FcEventReader } from './pyrfor-event-reader';
import type { FCRunOptions, FCEnvelope, FCHandle } from './pyrfor-fc-adapter';
import type { FcEvent } from './pyrfor-event-reader';
import type { Guardrails, GuardrailDecision } from './guardrails';
export interface FcGuardrailsOptions {
    guardrails: Guardrails;
    /**
     * Hard deny patterns to add to FC --disallowed-tools (Mode A pre-flight).
     * These are appended (deduped) to any existing opts.disallowedTools.
     */
    preflightDisallow?: string[];
    /** Adapter spawner. Default: runFreeClaude. */
    runFn?: (opts: FCRunOptions) => FCHandle;
    /** Structured logger. */
    logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
    /** Called when guardrails block a tool mid-run (Mode B). */
    onBlock?: (event: FcEvent, decision: GuardrailDecision) => void;
    /**
     * Optional FcEventReader factory, primarily for tests.
     * Default: () => new FcEventReader()
     */
    eventReaderFactory?: () => FcEventReader;
}
export interface GuardrailedResult {
    envelope: FCEnvelope;
    /** true if the run was aborted by a guardrail deny. */
    blocked: boolean;
    /** Human-readable reason for the block, if blocked=true. */
    blockReason?: string;
    /** All guardrail decisions recorded during the run (allow and deny alike). */
    decisions: Array<{
        event: FcEvent;
        decision: GuardrailDecision;
    }>;
}
/**
 * Run FreeClaude with guardrails active.
 *
 * 1. Mode A: merge preflightDisallow into opts.disallowedTools (deduped).
 * 2. Mode B: spawn FC; for each FcEvent of type ToolCallStart or BashCommand:
 *    - Build a GuardrailContext from the event.
 *    - Call guardrails.evaluate(ctx).
 *    - If decision.kind in {deny, deny-once} → handle.abort('guardrail-block: '+reason); set blocked=true.
 *    - For decision.kind 'ask' → treated as allow with a warn log (no human approver available in stream).
 *    - Record every decision regardless.
 * 3. Return GuardrailedResult.
 */
export declare function runFreeClaudeWithGuardrails(opts: FCRunOptions, gOpts: FcGuardrailsOptions): Promise<GuardrailedResult>;
/**
 * Best-effort: derive a list of FC --disallowed-tools strings from the
 * guardrails policies.
 *
 * Uses `guardrails.getPolicies()` (the standard method on the Guardrails
 * interface) to find policies with tier 'forbidden', and converts them to FC
 * disallow syntax: `${toolName}(${pattern})` when a pattern exists, or just
 * `${toolName}` when it doesn't.
 *
 * Also falls back to the optional `listPolicies?.()` method for compatibility
 * with alternative Guardrails implementations.
 *
 * Returns [] if neither method is available or no forbidden policies exist.
 */
export declare function derivePreflightDisallow(guardrails: Guardrails): string[];
//# sourceMappingURL=pyrfor-fc-guardrails.d.ts.map