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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
import { FcEventReader } from './pyrfor-event-reader.js';
import { runFreeClaude } from './pyrfor-fc-adapter.js';
// ── runFreeClaudeWithGuardrails ───────────────────────────────────────────────
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
export function runFreeClaudeWithGuardrails(opts, gOpts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        var _d, _e, _f, _g, _h, _j, _k, _l;
        const log = (_d = gOpts.logger) !== null && _d !== void 0 ? _d : (() => { });
        const spawn = (_e = gOpts.runFn) !== null && _e !== void 0 ? _e : runFreeClaude;
        const makeReader = (_f = gOpts.eventReaderFactory) !== null && _f !== void 0 ? _f : (() => new FcEventReader());
        // ── Mode A: merge preflightDisallow ──────────────────────────────────────
        const mergedDisallowed = mergeDeduped((_g = opts.disallowedTools) !== null && _g !== void 0 ? _g : [], (_h = gOpts.preflightDisallow) !== null && _h !== void 0 ? _h : []);
        const mergedOpts = Object.assign(Object.assign({}, opts), { disallowedTools: mergedDisallowed.length > 0 ? mergedDisallowed : undefined });
        // ── Mode B: spawn + stream ────────────────────────────────────────────────
        const handle = spawn(mergedOpts);
        const reader = makeReader();
        const decisions = [];
        let blocked = false;
        let blockReason;
        // Prevent evaluating additional tool calls after a block
        let aborted = false;
        try {
            for (var _m = true, _o = __asyncValues(handle.events()), _p; _p = yield _o.next(), _a = _p.done, !_a; _m = true) {
                _c = _p.value;
                _m = false;
                const rawEvent = _c;
                try {
                    const workerResult = yield ((_j = gOpts.codingHost) === null || _j === void 0 ? void 0 : _j.handleFreeClaudeEvent(rawEvent));
                    if (workerResult && !workerResult.ok) {
                        blockReason = `worker-frame-rejected: ${workerResult.disposition}`;
                        blocked = true;
                        aborted = true;
                        handle.abort(blockReason);
                        log('warn', '[fc-guardrails] worker_frame rejected by orchestration host', {
                            disposition: workerResult.disposition,
                            errors: workerResult.errors,
                        });
                        break;
                    }
                }
                catch (err) {
                    blockReason = `worker-frame-host-error: ${err instanceof Error ? err.message : String(err)}`;
                    blocked = true;
                    aborted = true;
                    handle.abort(blockReason);
                    log('error', '[fc-guardrails] worker_frame host handling failed', {
                        err: err instanceof Error ? err.message : String(err),
                    });
                    break;
                }
                const fcEvents = reader.read(rawEvent);
                for (const fcEvent of fcEvents) {
                    if (aborted)
                        continue;
                    if (fcEvent.type !== 'ToolCallStart' && fcEvent.type !== 'BashCommand') {
                        continue;
                    }
                    // Build GuardrailContext
                    let toolName;
                    let args;
                    if (fcEvent.type === 'ToolCallStart') {
                        toolName = fcEvent.toolName;
                        args = typeof fcEvent.input === 'object' && fcEvent.input !== null
                            ? fcEvent.input
                            : { input: fcEvent.input };
                    }
                    else {
                        // BashCommand
                        toolName = 'Bash';
                        args = { command: fcEvent.command };
                    }
                    const ctx = {
                        agentId: (_k = opts.workdir) !== null && _k !== void 0 ? _k : 'freeclaude',
                        toolName,
                        args,
                        sessionId: undefined,
                        cwd: opts.workdir,
                    };
                    let decision;
                    try {
                        decision = yield gOpts.guardrails.evaluate(ctx);
                    }
                    catch (err) {
                        log('error', '[fc-guardrails] evaluate threw', { err, toolName });
                        continue;
                    }
                    decisions.push({ event: fcEvent, decision });
                    if (decision.kind === 'deny' || decision.kind === 'deny-once') {
                        const reason = decision.reason;
                        blockReason = `guardrail-block: ${reason}`;
                        log('warn', `[fc-guardrails] blocking tool "${toolName}"`, { reason, kind: decision.kind });
                        (_l = gOpts.onBlock) === null || _l === void 0 ? void 0 : _l.call(gOpts, fcEvent, decision);
                        blocked = true;
                        aborted = true;
                        handle.abort(blockReason);
                        break;
                    }
                    if (decision.kind === 'ask') {
                        // No human approver available mid-stream; treat as allow + warn.
                        log('warn', `[fc-guardrails] tool "${toolName}" requires approval (ask) — treating as allow in stream mode`, {
                            toolName,
                            reason: decision.reason,
                        });
                    }
                }
                if (aborted)
                    break;
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_m && !_a && (_b = _o.return)) yield _b.call(_o);
            }
            finally { if (e_1) throw e_1.error; }
        }
        // Drain remaining reader state
        reader.flush();
        const result = yield handle.complete();
        return {
            envelope: result.envelope,
            blocked,
            blockReason,
            decisions,
        };
    });
}
// ── derivePreflightDisallow ───────────────────────────────────────────────────
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
export function derivePreflightDisallow(guardrails) {
    const g = guardrails;
    let policies;
    // Prefer standard Guardrails.getPolicies()
    if (typeof g.getPolicies === 'function') {
        try {
            policies = g.getPolicies();
        }
        catch (_a) {
            // ignore
        }
    }
    // Fallback for alternative implementations
    if (!policies && typeof g.listPolicies === 'function') {
        try {
            policies = g.listPolicies();
        }
        catch (_b) {
            // ignore
        }
    }
    if (!policies)
        return [];
    const result = [];
    for (const policy of policies) {
        if (policy.tier !== 'forbidden')
            continue;
        if (policy.pattern) {
            // Convert RegExp source or plain string to FC pattern syntax
            const patternStr = policy.pattern instanceof RegExp ? policy.pattern.source : String(policy.pattern);
            result.push(`${policy.toolName}(${patternStr})`);
        }
        else {
            result.push(policy.toolName);
        }
    }
    return result;
}
// ── Private helpers ───────────────────────────────────────────────────────────
function mergeDeduped(base, extra) {
    const seen = new Set(base);
    const merged = [...base];
    for (const item of extra) {
        if (!seen.has(item)) {
            seen.add(item);
            merged.push(item);
        }
    }
    return merged;
}
