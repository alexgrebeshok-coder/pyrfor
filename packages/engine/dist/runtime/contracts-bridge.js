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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ===== Imports ===============================================================
import { RunLifecycle } from './run-lifecycle.js';
// ===== Pure helpers ==========================================================
/**
 * Produce a deterministic invocation identifier composed of
 * `${runId}:${toolName}:${seq}`. Suitable for idempotency keys.
 */
export function makeInvocationId(runId, toolName, seq) {
    return `${runId}:${toolName}:${seq}`;
}
/**
 * JSON-stringify `args` and truncate to `maxLen` characters (default 200).
 * Appends "…" when truncated. Circular references are replaced with
 * the literal string `"[Circular]"`.
 */
export function summarizeArgs(args, maxLen = 200) {
    const seen = new WeakSet();
    const replacer = (_key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value))
                return '[Circular]';
            seen.add(value);
        }
        return value;
    };
    let result;
    try {
        result = JSON.stringify(args, replacer);
    }
    catch (_a) {
        result = '[unserializable]';
    }
    return result.length > maxLen ? result.slice(0, maxLen) + '\u2026' : result;
}
/**
 * Map a raw `Decision` from `PermissionEngine.check()` to a simplified gate.
 *
 * - `allow: true`                        → 'allow'
 * - `allow: false && promptUser: true`   → 'ask'
 * - `allow: false && promptUser: false`  → 'deny'
 */
function normalizePermissionDecision(d) {
    if (d.allow)
        return 'allow';
    if (d.promptUser)
        return 'ask';
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
function safeAppend(ledger, event) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // The cast is required because `Omit<LedgerEvent, 'ts'|'seq'|'id'>` resolves
            // to only the common fields {type, run_id}; the extra per-event fields are
            // preserved at runtime by EventLedger.append's spread.
            yield ledger.append(event);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[ContractsBridge] ledger.append failed: ${msg}`);
        }
    });
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
    // ── Constructor ────────────────────────────────────────────────────────────
    constructor(opts) {
        var _a, _b, _c, _d;
        /** Internal run-state registry; populated only when lifecycle is present. */
        this._runs = new Map();
        this._engine = opts.permissionEngine;
        this._ledger = opts.ledger;
        this._lifecycle = opts.lifecycle;
        this._permissionContext = (_a = opts.permissionContext) !== null && _a !== void 0 ? _a : { workspaceId: 'default', sessionId: 'default' };
        this._onAskPermission = (_b = opts.onAskPermission) !== null && _b !== void 0 ? _b : (() => Promise.resolve('deny'));
        this._defaultTimeoutMs = (_c = opts.defaultTimeoutMs) !== null && _c !== void 0 ? _c : 30000;
        this._clock = (_d = opts.clock) !== null && _d !== void 0 ? _d : (() => Date.now());
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
    invoke(inv, exec, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const startMs = this._clock();
            const timeoutMs = (_a = opts === null || opts === void 0 ? void 0 : opts.timeoutMs) !== null && _a !== void 0 ? _a : this._defaultTimeoutMs;
            const callerSignal = opts === null || opts === void 0 ? void 0 : opts.signal;
            // ── 1. Permission check ──────────────────────────────────────────────────
            let rawDecision;
            try {
                rawDecision = yield this._engine.check(inv.toolName, Object.assign(Object.assign({}, this._permissionContext), { runId: inv.runId }), inv.args);
            }
            catch (err) {
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
                yield safeAppend(this._ledger, {
                    type: 'tool.denied',
                    run_id: inv.runId,
                    tool: inv.toolName,
                    reason: 'policy',
                });
                return { ok: false, decision: 'denied_pre', durationMs: 0 };
            }
            // ── 3. User-prompted decision ('ask') ────────────────────────────────────
            if (gate === 'ask') {
                let userAnswer;
                try {
                    userAnswer = yield this._onAskPermission(inv);
                }
                catch (_b) {
                    userAnswer = 'deny';
                }
                if (userAnswer === 'deny') {
                    yield safeAppend(this._ledger, {
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
            yield safeAppend(this._ledger, {
                type: 'tool.requested',
                run_id: inv.runId,
                tool: inv.toolName,
                args: inv.args,
            });
            // ── 5. Build AbortController (timeout + caller propagation) ─────────────
            const ac = new AbortController();
            if (callerSignal === null || callerSignal === void 0 ? void 0 : callerSignal.aborted) {
                ac.abort(callerSignal.reason);
            }
            else if (callerSignal) {
                callerSignal.addEventListener('abort', () => ac.abort(callerSignal.reason), { once: true });
            }
            // ── 6. Execute with timeout ──────────────────────────────────────────────
            const resolvedDecision = isAutoAllow
                ? 'auto_allow'
                : 'allow';
            let output;
            let execError;
            let timeoutHandle;
            try {
                const timeoutRace = new Promise((_, reject) => {
                    timeoutHandle = setTimeout(() => {
                        // Reject the race BEFORE aborting so the timeout error wins even when
                        // the executor's abort listener also calls reject() synchronously.
                        const err = new Error('timeout');
                        err.code = 'timeout';
                        reject(err);
                        ac.abort('timeout');
                    }, timeoutMs);
                });
                output = yield Promise.race([exec(inv, { signal: ac.signal }), timeoutRace]);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const code = err.code;
                execError = Object.assign({ message: msg }, (code !== undefined ? { code } : {}));
            }
            finally {
                if (timeoutHandle !== undefined)
                    clearTimeout(timeoutHandle);
            }
            const durationMs = this._clock() - startMs;
            // ── 7. Emit tool.executed ────────────────────────────────────────────────
            if (execError) {
                yield safeAppend(this._ledger, {
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
            yield safeAppend(this._ledger, {
                type: 'tool.executed',
                run_id: inv.runId,
                tool: inv.toolName,
                ms: durationMs,
                status: 'ok',
            });
            return { ok: true, output, durationMs, decision: resolvedDecision };
        });
    }
    /**
     * Execute an already-approved invocation.
     *
     * This intentionally skips PermissionEngine.check() and is meant for
     * two-phase effect flows after a separate policy verdict / human approval.
     */
    invokeApproved(inv, exec, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const startMs = this._clock();
            const timeoutMs = (_a = opts === null || opts === void 0 ? void 0 : opts.timeoutMs) !== null && _a !== void 0 ? _a : this._defaultTimeoutMs;
            const callerSignal = opts === null || opts === void 0 ? void 0 : opts.signal;
            const resolvedDecision = (_b = opts === null || opts === void 0 ? void 0 : opts.decision) !== null && _b !== void 0 ? _b : 'allow';
            yield safeAppend(this._ledger, {
                type: 'tool.requested',
                run_id: inv.runId,
                tool: inv.toolName,
                args: inv.args,
            });
            const ac = new AbortController();
            if (callerSignal === null || callerSignal === void 0 ? void 0 : callerSignal.aborted) {
                ac.abort(callerSignal.reason);
            }
            else if (callerSignal) {
                callerSignal.addEventListener('abort', () => ac.abort(callerSignal.reason), { once: true });
            }
            let output;
            let execError;
            let timeoutHandle;
            try {
                const timeoutRace = new Promise((_, reject) => {
                    timeoutHandle = setTimeout(() => {
                        const err = new Error('timeout');
                        err.code = 'timeout';
                        reject(err);
                        ac.abort('timeout');
                    }, timeoutMs);
                });
                output = yield Promise.race([exec(inv, { signal: ac.signal }), timeoutRace]);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const code = err.code;
                execError = Object.assign({ message: msg }, (code !== undefined ? { code } : {}));
            }
            finally {
                if (timeoutHandle !== undefined)
                    clearTimeout(timeoutHandle);
            }
            const durationMs = this._clock() - startMs;
            if (execError) {
                yield safeAppend(this._ledger, {
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
            yield safeAppend(this._ledger, {
                type: 'tool.executed',
                run_id: inv.runId,
                tool: inv.toolName,
                ms: durationMs,
                status: 'ok',
            });
            return { ok: true, output, durationMs, decision: resolvedDecision };
        });
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
    markRunStarted(runId, meta) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._lifecycle)
                return;
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
        });
    }
    /**
     * Mark a run as completed (running → completed).
     *
     * No-op when `lifecycle` is absent.
     *
     * @throws {@link InvalidTransitionError} on illegal transition.
     */
    markRunCompleted(runId, summary) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._lifecycle)
                return;
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
        });
    }
    /**
     * Mark a run as failed (running → failed) with a structured error.
     *
     * No-op when `lifecycle` is absent.
     *
     * @throws {@link InvalidTransitionError} on illegal transition.
     */
    markRunFailed(runId, error) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this._lifecycle)
                return;
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
            record = RunLifecycle.withError(record, (_a = error.code) !== null && _a !== void 0 ? _a : 'error', error.message);
            this._runs.set(runId, record);
        });
    }
}
