/**
 * contracts-bridge.ts — Runtime-hardening integration bridge for Pyrfor.
 *
 * Wraps arbitrary tool-execution calls with the three canonical contracts:
 *   1. {@link PermissionEngine} — pre-invocation permission gating
 *   2. {@link EventLedger}      — append-only audit trail emission
 *   3. {@link RunLifecycle}     — optional run-state transition tracking
 *
 * The existing tool-loop is NOT modified. Any caller may opt in by
 * constructing a {@link ContractsBridge} and routing invocations through it.
 *
 * @module contracts-bridge
 */
import { RunLifecycle } from './run-lifecycle';
import type { PermissionEngine } from './permission-engine';
import type { EventLedger } from './event-ledger';
export interface ToolInvocation {
    /** Owning run identifier. */
    runId: string;
    /** Registered name of the tool to invoke. */
    toolName: string;
    /** Arguments forwarded to the tool executor. */
    args: Record<string, unknown>;
    /** Caller-provided id used for idempotency / dedupe. */
    invocationId?: string;
    /** Optional cost hint (tokens, dollars) — for ledger record only. */
    costHint?: number;
}
export interface ToolInvocationResult {
    ok: boolean;
    output?: unknown;
    error?: {
        message: string;
        code?: string;
    };
    durationMs: number;
    /** Final permission decision that determined the outcome. */
    decision: 'allow' | 'ask' | 'deny' | 'auto_allow' | 'denied_pre' | 'denied_user';
}
export type ToolExecutor = (inv: ToolInvocation, ctx: {
    signal: AbortSignal;
}) => Promise<unknown>;
export interface ContractsBridgeOptions {
    permissionEngine: PermissionEngine;
    ledger: EventLedger;
    /** Permission identity used by PermissionEngine.check(). */
    permissionContext?: {
        workspaceId: string;
        sessionId: string;
    };
    /**
     * Optional RunLifecycle instance.
     * When absent, all `markRun*` calls are no-ops and no run-state is tracked.
     */
    lifecycle?: RunLifecycle;
    /**
     * Called when permission engine resolves to 'ask'.
     * Caller decides allow/deny. Default: `() => Promise.resolve('deny')`.
     */
    onAskPermission?: (inv: ToolInvocation) => Promise<'allow' | 'deny'>;
    /** Default per-invocation timeout (ms). Default: 30 000. */
    defaultTimeoutMs?: number;
    /** Clock injection for deterministic tests. Default: `Date.now`. */
    clock?: () => number;
}
/**
 * Produce a deterministic invocation identifier composed of
 * `${runId}:${toolName}:${seq}`. Suitable for idempotency keys.
 */
export declare function makeInvocationId(runId: string, toolName: string, seq: number): string;
/**
 * JSON-stringify `args` and truncate to `maxLen` characters (default 200).
 * Appends "…" when truncated. Circular references are replaced with
 * the literal string `"[Circular]"`.
 */
export declare function summarizeArgs(args: Record<string, unknown>, maxLen?: number): string;
/**
 * Composable bridge that wraps any {@link ToolExecutor} with:
 *   1. Pre-invocation permission gating via {@link PermissionEngine}
 *   2. Ledger emission (tool.requested / tool.executed / tool.denied)
 *      via {@link EventLedger}
 *   3. Optional run-state tracking via {@link RunLifecycle}
 *
 * ### Permission flow
 * `PermissionEngine.check()` returns a `Decision`; the bridge normalises it to
 * a three-way gate (allow / ask / deny):
 *
 * - **allow / auto_allow** — executor is called immediately.
 * - **ask** — `onAskPermission(inv)` is awaited; user's 'allow' proceeds,
 *   'deny' short-circuits with `decision: 'denied_user'`.
 * - **deny** — short-circuits with `decision: 'denied_pre'`.
 *
 * ### Lifecycle transitions
 * When a `lifecycle` instance is present the bridge maintains a
 * `Map<runId, RunRecord>` and calls **`RunLifecycle.transition(record, next)`**
 * (static method on the imported `RunLifecycle` class) to advance run state.
 * No external I/O is performed.
 */
export declare class ContractsBridge {
    private readonly _engine;
    private readonly _ledger;
    private readonly _lifecycle;
    private readonly _permissionContext;
    private readonly _onAskPermission;
    private readonly _defaultTimeoutMs;
    private readonly _clock;
    /** Internal run-state registry; populated only when lifecycle is present. */
    private readonly _runs;
    constructor(opts: ContractsBridgeOptions);
    /**
     * Invoke `exec` with full contract enforcement.
     *
     * Steps:
     * 1. Pre-permission check via `PermissionEngine.check()`
     * 2. Emit `tool.requested` ledger event (if proceeding)
     * 3. Call `exec` with a timeout-capable `AbortSignal`
     * 4. Emit `tool.executed` (success/error) or `tool.denied` ledger event
     * 5. Return a {@link ToolInvocationResult} — **never throws**
     *
     * @param inv      - Tool invocation descriptor
     * @param exec     - The executor to call if permission is granted
     * @param opts     - Per-call overrides (timeoutMs, caller AbortSignal)
     */
    invoke(inv: ToolInvocation, exec: ToolExecutor, opts?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<ToolInvocationResult>;
    /**
     * Execute an already-approved invocation.
     *
     * This intentionally skips PermissionEngine.check() and is meant for
     * two-phase effect flows after a separate policy verdict / human approval.
     */
    invokeApproved(inv: ToolInvocation, exec: ToolExecutor, opts?: {
        timeoutMs?: number;
        signal?: AbortSignal;
        decision?: ToolInvocationResult['decision'];
    }): Promise<ToolInvocationResult>;
    /**
     * Mark a run as started (draft → planned → running).
     *
     * Calls `RunLifecycle.transition(record, next)` (static method) on an
     * internally managed `RunRecord`. No-op when `lifecycle` is absent.
     *
     * @throws {@link InvalidTransitionError} on illegal transition.
     */
    markRunStarted(runId: string, meta?: Record<string, unknown>): Promise<void>;
    /**
     * Mark a run as completed (running → completed).
     *
     * No-op when `lifecycle` is absent.
     *
     * @throws {@link InvalidTransitionError} on illegal transition.
     */
    markRunCompleted(runId: string, summary?: Record<string, unknown>): Promise<void>;
    /**
     * Mark a run as failed (running → failed) with a structured error.
     *
     * No-op when `lifecycle` is absent.
     *
     * @throws {@link InvalidTransitionError} on illegal transition.
     */
    markRunFailed(runId: string, error: {
        message: string;
        code?: string;
    }): Promise<void>;
}
//# sourceMappingURL=contracts-bridge.d.ts.map