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

// ===== Imports ===============================================================

import { RunLifecycle } from './run-lifecycle';
import type { RunRecord } from './run-lifecycle';
import type { PermissionEngine } from './permission-engine';
import type { EventLedger, LedgerEventType } from './event-ledger';

// ===== Public types ==========================================================

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
  error?: { message: string; code?: string };
  durationMs: number;
  /** Final permission decision that determined the outcome. */
  decision: 'allow' | 'ask' | 'deny' | 'auto_allow' | 'denied_pre' | 'denied_user';
}

export type ToolExecutor = (
  inv: ToolInvocation,
  ctx: { signal: AbortSignal },
) => Promise<unknown>;

export interface ContractsBridgeOptions {
  permissionEngine: PermissionEngine;
  ledger: EventLedger;
  /** Permission identity used by PermissionEngine.check(). */
  permissionContext?: { workspaceId: string; sessionId: string };
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

// ===== Pure helpers ==========================================================

/**
 * Produce a deterministic invocation identifier composed of
 * `${runId}:${toolName}:${seq}`. Suitable for idempotency keys.
 */
export function makeInvocationId(runId: string, toolName: string, seq: number): string {
  return `${runId}:${toolName}:${seq}`;
}

/**
 * JSON-stringify `args` and truncate to `maxLen` characters (default 200).
 * Appends "…" when truncated. Circular references are replaced with
 * the literal string `"[Circular]"`.
 */
export function summarizeArgs(args: Record<string, unknown>, maxLen = 200): string {
  const seen = new WeakSet<object>();

  const replacer = (_key: string, value: unknown): unknown => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value as object)) return '[Circular]';
      seen.add(value as object);
    }
    return value;
  };

  let result: string;
  try {
    result = JSON.stringify(args, replacer);
  } catch {
    result = '[unserializable]';
  }

  return result.length > maxLen ? result.slice(0, maxLen) + '\u2026' : result;
}

// ===== Internal helpers ======================================================

/** Three-way decision gate used internally by the bridge. */
type FlowGate = 'allow' | 'ask' | 'deny';

/**
 * Map a raw `Decision` from `PermissionEngine.check()` to a simplified gate.
 *
 * - `allow: true`                        → 'allow'
 * - `allow: false && promptUser: true`   → 'ask'
 * - `allow: false && promptUser: false`  → 'deny'
 */
function normalizePermissionDecision(d: {
  allow: boolean;
  promptUser: boolean;
}): FlowGate {
  if (d.allow) return 'allow';
  if (d.promptUser) return 'ask';
  return 'deny';
}

/**
 * Append to the ledger, swallowing errors and logging a warning.
 * Ledger failures must never interrupt the tool-execution flow.
 *
 * Uses `[key: string]: unknown` so per-event optional fields (tool, reason,
 * ms, etc.) can be included without fighting TypeScript's `Omit<LedgerEvent,…>`
 * distribution semantics.
 */
async function safeAppend(
  ledger: EventLedger,
  event: { type: LedgerEventType; run_id: string; [key: string]: unknown },
): Promise<void> {
  try {
    // The cast is required because `Omit<LedgerEvent, 'ts'|'seq'|'id'>` resolves
    // to only the common fields {type, run_id}; the extra per-event fields are
    // preserved at runtime by EventLedger.append's spread.
    await ledger.append(
      event as unknown as Parameters<EventLedger['append']>[0],
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ContractsBridge] ledger.append failed: ${msg}`);
  }
}

// ===== ContractsBridge =======================================================

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
export class ContractsBridge {
  // ── Private fields ─────────────────────────────────────────────────────────

  private readonly _engine: PermissionEngine;
  private readonly _ledger: EventLedger;
  private readonly _lifecycle: RunLifecycle | undefined;
  private readonly _permissionContext: { workspaceId: string; sessionId: string };
  private readonly _onAskPermission: (inv: ToolInvocation) => Promise<'allow' | 'deny'>;
  private readonly _defaultTimeoutMs: number;
  private readonly _clock: () => number;

  /** Internal run-state registry; populated only when lifecycle is present. */
  private readonly _runs = new Map<string, RunRecord>();

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(opts: ContractsBridgeOptions) {
    this._engine = opts.permissionEngine;
    this._ledger = opts.ledger;
    this._lifecycle = opts.lifecycle;
    this._permissionContext = opts.permissionContext ?? { workspaceId: 'default', sessionId: 'default' };
    this._onAskPermission = opts.onAskPermission ?? (() => Promise.resolve('deny'));
    this._defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
    this._clock = opts.clock ?? (() => Date.now());
  }

  // ── Public API ─────────────────────────────────────────────────────────────

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
  async invoke(
    inv: ToolInvocation,
    exec: ToolExecutor,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ToolInvocationResult> {
    const startMs = this._clock();
    const timeoutMs = opts?.timeoutMs ?? this._defaultTimeoutMs;
    const callerSignal = opts?.signal;

    // ── 1. Permission check ──────────────────────────────────────────────────

    let rawDecision: { allow: boolean; promptUser: boolean; permissionClass: string };
    try {
      rawDecision = await this._engine.check(
        inv.toolName,
        { ...this._permissionContext, runId: inv.runId },
        inv.args,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: { message: msg, code: 'permission_check_error' },
        durationMs: this._clock() - startMs,
        decision: 'deny',
      };
    }

    const gate = normalizePermissionDecision(rawDecision);
    const isAutoAllow = rawDecision.permissionClass === 'auto_allow';

    // ── 2. Denial by policy ──────────────────────────────────────────────────

    if (gate === 'deny') {
      await safeAppend(this._ledger, {
        type: 'tool.denied',
        run_id: inv.runId,
        tool: inv.toolName,
        reason: 'policy',
      });
      return { ok: false, decision: 'denied_pre', durationMs: 0 };
    }

    // ── 3. User-prompted decision ('ask') ────────────────────────────────────

    if (gate === 'ask') {
      let userAnswer: 'allow' | 'deny';
      try {
        userAnswer = await this._onAskPermission(inv);
      } catch {
        userAnswer = 'deny';
      }

      if (userAnswer === 'deny') {
        await safeAppend(this._ledger, {
          type: 'tool.denied',
          run_id: inv.runId,
          tool: inv.toolName,
          reason: 'user_denied',
        });
        return { ok: false, decision: 'denied_user', durationMs: 0 };
      }
      // User approved — fall through to execution
    }

    // ── 4. Emit tool.requested ───────────────────────────────────────────────

    await safeAppend(this._ledger, {
      type: 'tool.requested',
      run_id: inv.runId,
      tool: inv.toolName,
      args: inv.args,
    });

    // ── 5. Build AbortController (timeout + caller propagation) ─────────────

    const ac = new AbortController();

    if (callerSignal?.aborted) {
      ac.abort(callerSignal.reason);
    } else if (callerSignal) {
      callerSignal.addEventListener(
        'abort',
        () => ac.abort(callerSignal.reason),
        { once: true },
      );
    }

    // ── 6. Execute with timeout ──────────────────────────────────────────────

    const resolvedDecision: ToolInvocationResult['decision'] = isAutoAllow
      ? 'auto_allow'
      : 'allow';

    let output: unknown;
    let execError: { message: string; code?: string } | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutRace = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          // Reject the race BEFORE aborting so the timeout error wins even when
          // the executor's abort listener also calls reject() synchronously.
          const err = new Error('timeout') as Error & { code: string };
          err.code = 'timeout';
          reject(err);
          ac.abort('timeout');
        }, timeoutMs);
      });

      output = await Promise.race([exec(inv, { signal: ac.signal }), timeoutRace]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code;
      execError = { message: msg, ...(code !== undefined ? { code } : {}) };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }

    const durationMs = this._clock() - startMs;

    // ── 7. Emit tool.executed ────────────────────────────────────────────────

    if (execError) {
      await safeAppend(this._ledger, {
        type: 'tool.executed',
        run_id: inv.runId,
        tool: inv.toolName,
        ms: durationMs,
        status: 'error',
        error: execError.code
          ? `${execError.message} [${execError.code}]`
          : execError.message,
      });
      return { ok: false, error: execError, durationMs, decision: resolvedDecision };
    }

    await safeAppend(this._ledger, {
      type: 'tool.executed',
      run_id: inv.runId,
      tool: inv.toolName,
      ms: durationMs,
      status: 'ok',
    });

    return { ok: true, output, durationMs, decision: resolvedDecision };
  }

  /**
   * Execute an already-approved invocation.
   *
   * This intentionally skips PermissionEngine.check() and is meant for
   * two-phase effect flows after a separate policy verdict / human approval.
   */
  async invokeApproved(
    inv: ToolInvocation,
    exec: ToolExecutor,
    opts?: { timeoutMs?: number; signal?: AbortSignal; decision?: ToolInvocationResult['decision'] },
  ): Promise<ToolInvocationResult> {
    const startMs = this._clock();
    const timeoutMs = opts?.timeoutMs ?? this._defaultTimeoutMs;
    const callerSignal = opts?.signal;
    const resolvedDecision = opts?.decision ?? 'allow';

    await safeAppend(this._ledger, {
      type: 'tool.requested',
      run_id: inv.runId,
      tool: inv.toolName,
      args: inv.args,
    });

    const ac = new AbortController();
    if (callerSignal?.aborted) {
      ac.abort(callerSignal.reason);
    } else if (callerSignal) {
      callerSignal.addEventListener(
        'abort',
        () => ac.abort(callerSignal.reason),
        { once: true },
      );
    }

    let output: unknown;
    let execError: { message: string; code?: string } | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutRace = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const err = new Error('timeout') as Error & { code: string };
          err.code = 'timeout';
          reject(err);
          ac.abort('timeout');
        }, timeoutMs);
      });

      output = await Promise.race([exec(inv, { signal: ac.signal }), timeoutRace]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = (err as { code?: string }).code;
      execError = { message: msg, ...(code !== undefined ? { code } : {}) };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }

    const durationMs = this._clock() - startMs;

    if (execError) {
      await safeAppend(this._ledger, {
        type: 'tool.executed',
        run_id: inv.runId,
        tool: inv.toolName,
        ms: durationMs,
        status: 'error',
        error: execError.code
          ? `${execError.message} [${execError.code}]`
          : execError.message,
      });
      return { ok: false, error: execError, durationMs, decision: resolvedDecision };
    }

    await safeAppend(this._ledger, {
      type: 'tool.executed',
      run_id: inv.runId,
      tool: inv.toolName,
      ms: durationMs,
      status: 'ok',
    });

    return { ok: true, output, durationMs, decision: resolvedDecision };
  }

  // ── Lifecycle markers ───────────────────────────────────────────────────────

  /**
   * Mark a run as started (draft → planned → running).
   *
   * Calls `RunLifecycle.transition(record, next)` (static method) on an
   * internally managed `RunRecord`. No-op when `lifecycle` is absent.
   *
   * @throws {@link InvalidTransitionError} on illegal transition.
   */
  async markRunStarted(runId: string, meta?: Record<string, unknown>): Promise<void> {
    if (!this._lifecycle) return;
    void meta; // reserved for future metadata embedding

    let record = this._runs.get(runId);
    if (!record) {
      record = RunLifecycle.create({
        workspace_id: 'bridge',
        repo_id: 'bridge',
        mode: 'autonomous',
        run_id: runId,
      });
    }

    if (record.status === 'draft') {
      record = RunLifecycle.transition(record, 'planned');
    }
    if (record.status === 'planned') {
      record = RunLifecycle.transition(record, 'running');
    }

    this._runs.set(runId, record);
  }

  /**
   * Mark a run as completed (running → completed).
   *
   * No-op when `lifecycle` is absent.
   *
   * @throws {@link InvalidTransitionError} on illegal transition.
   */
  async markRunCompleted(runId: string, summary?: Record<string, unknown>): Promise<void> {
    if (!this._lifecycle) return;
    void summary;

    let record = this._runs.get(runId);
    if (!record) {
      // Bootstrap minimal running state when markRunStarted was not called.
      record = RunLifecycle.create({
        workspace_id: 'bridge',
        repo_id: 'bridge',
        mode: 'autonomous',
        run_id: runId,
      });
      record = RunLifecycle.transition(record, 'planned');
      record = RunLifecycle.transition(record, 'running');
    }

    record = RunLifecycle.transition(record, 'completed');
    this._runs.set(runId, record);
  }

  /**
   * Mark a run as failed (running → failed) with a structured error.
   *
   * No-op when `lifecycle` is absent.
   *
   * @throws {@link InvalidTransitionError} on illegal transition.
   */
  async markRunFailed(runId: string, error: { message: string; code?: string }): Promise<void> {
    if (!this._lifecycle) return;

    let record = this._runs.get(runId);
    if (!record) {
      record = RunLifecycle.create({
        workspace_id: 'bridge',
        repo_id: 'bridge',
        mode: 'autonomous',
        run_id: runId,
      });
      record = RunLifecycle.transition(record, 'planned');
      record = RunLifecycle.transition(record, 'running');
    }

    record = RunLifecycle.withError(record, error.code ?? 'error', error.message);
    this._runs.set(runId, record);
  }
}
