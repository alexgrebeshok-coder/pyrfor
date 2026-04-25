/**
 * acp-trajectory-bridge.ts — Phase H1→G+1 bridge.
 *
 * Wires every supervised ACP coding session into a TrajectoryRecord so the
 * pattern miner and reflector can analyse real agent behaviour.
 *
 * Constraints: ESM, pure TS, no native deps beyond Node built-ins.
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
import { createHash } from 'node:crypto';
// ── Helpers ───────────────────────────────────────────────────────────────────
const MAX_CAP = 50;
const MAX_RESULT_BYTES = 1024;
function hashOf(event) {
    const str = `${event.type}:${event.ts}:${JSON.stringify(event.data)}`;
    return createHash('sha1').update(str).digest('hex').slice(0, 8);
}
function trimResult(value) {
    if (value === undefined || value === null)
        return '';
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return str.length > MAX_RESULT_BYTES ? str.slice(0, MAX_RESULT_BYTES) + '…' : str;
}
function asRecord(value) {
    return typeof value === 'object' && value !== null
        ? value
        : {};
}
// ── createAcpTrajectoryBridge ─────────────────────────────────────────────────
export function createAcpTrajectoryBridge(opts) {
    if (!opts.recorder)
        throw new Error('AcpTrajectoryBridge: recorder is required');
    const { recorder, sessionId, agentName, scope } = opts;
    const startedAt = Date.now();
    const toolCalls = [];
    const pendingCalls = new Map();
    const validationSidecar = new Map();
    const gateDecisions = [];
    const injections = [];
    let validatorEvents = 0;
    let corrections = 0;
    let blocks = 0;
    let lastAgentText = '';
    let plan = undefined;
    let finalised = false;
    // ── internal finalize ──────────────────────────────────────────────────────
    function doFinalize(stopReason, finalAnswer, finOpts) {
        if (finalised)
            return Promise.resolve();
        finalised = true;
        // Close any still-pending tool calls (agent crashed / abandoned).
        for (const [, pending] of pendingCalls) {
            toolCalls.push({
                name: pending.name,
                kind: pending.kind,
                args: pending.args,
                result: 'abandoned',
                success: false,
                latencyMs: Date.now() - pending.startTs,
                errorMessage: 'abandoned',
                timestamp: new Date().toISOString(),
            });
        }
        pendingCalls.clear();
        const answer = finalAnswer !== null && finalAnswer !== void 0 ? finalAnswer : lastAgentText;
        const meta = Object.assign(Object.assign({ agentName,
            scope }, opts.metadata), { validatorEvents,
            corrections,
            blocks, gateDecisions: [...gateDecisions], injections: [...injections], plan });
        if ((finOpts === null || finOpts === void 0 ? void 0 : finOpts.abortReason) !== undefined)
            meta['abortReason'] = finOpts.abortReason;
        return Promise.resolve(recorder.finish({
            sessionId,
            success: stopReason === 'end_turn',
            finalAnswer: answer,
            stopReason,
            tokensUsed: finOpts === null || finOpts === void 0 ? void 0 : finOpts.tokensUsed,
            costUsd: finOpts === null || finOpts === void 0 ? void 0 : finOpts.costUsd,
            toolCalls: [...toolCalls],
            metadata: meta,
        })).then(() => undefined);
    }
    // ── tracker implementation ─────────────────────────────────────────────────
    return {
        // ── recordEvent ──────────────────────────────────────────────────────────
        recordEvent(event) {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            if (finalised)
                return;
            const data = asRecord(event.data);
            switch (event.type) {
                case 'tool_call': {
                    const id = data['id'] || hashOf(event);
                    pendingCalls.set(id, {
                        id,
                        name: data['name'] || data['tool'] || 'unknown',
                        kind: data['kind'] || 'other',
                        args: asRecord((_a = data['args']) !== null && _a !== void 0 ? _a : data['input']),
                        startTs: event.ts,
                    });
                    break;
                }
                case 'tool_call_update': {
                    const id = data['id'];
                    if (!id)
                        break;
                    const pending = pendingCalls.get(id);
                    if (!pending)
                        break;
                    const status = data['status'];
                    const hasResult = data['result'] !== undefined;
                    const hasError = data['error'] !== undefined;
                    if (status === 'completed' || status === 'failed' || hasResult || hasError) {
                        pendingCalls.delete(id);
                        const success = status !== 'failed' && !hasError;
                        toolCalls.push({
                            name: pending.name,
                            kind: pending.kind,
                            args: pending.args,
                            result: trimResult(hasResult ? data['result'] : data['error']),
                            success,
                            latencyMs: event.ts - pending.startTs,
                            errorMessage: success ? undefined : trimResult((_b = data['error']) !== null && _b !== void 0 ? _b : 'failed'),
                            timestamp: new Date(event.ts).toISOString(),
                        });
                    }
                    break;
                }
                case 'diff': {
                    const additions = ((_d = (_c = data['additions']) !== null && _c !== void 0 ? _c : data['added']) !== null && _d !== void 0 ? _d : 0);
                    const deletions = ((_f = (_e = data['deletions']) !== null && _e !== void 0 ? _e : data['removed']) !== null && _f !== void 0 ? _f : 0);
                    toolCalls.push({
                        name: 'diff',
                        kind: 'edit',
                        args: { path: (_g = data['path']) !== null && _g !== void 0 ? _g : '' },
                        result: `+${additions}/-${deletions}`,
                        success: true,
                        latencyMs: 0,
                        timestamp: new Date(event.ts).toISOString(),
                    });
                    break;
                }
                case 'agent_message_chunk': {
                    lastAgentText +=
                        data['text'] ||
                            data['content'] ||
                            '';
                    break;
                }
                case 'terminal': {
                    const cmd = data['command'] ||
                        data['cmd'] ||
                        '';
                    const output = trimResult((_h = data['output']) !== null && _h !== void 0 ? _h : '');
                    const exitCode = data['exitCode'];
                    toolCalls.push({
                        name: 'terminal',
                        kind: 'execute',
                        args: { command: cmd },
                        result: output,
                        success: exitCode === undefined || exitCode === 0,
                        latencyMs: 0,
                        timestamp: new Date(event.ts).toISOString(),
                    });
                    break;
                }
                case 'plan': {
                    plan = event.data;
                    break;
                }
                default:
                    // Unknown event types — ignore; no throw.
                    break;
            }
        },
        // ── recordValidation ─────────────────────────────────────────────────────
        recordValidation(eventId, results) {
            var _a;
            validationSidecar.set(eventId, [
                ...((_a = validationSidecar.get(eventId)) !== null && _a !== void 0 ? _a : []),
                ...results,
            ]);
            validatorEvents++;
        },
        // ── recordGateDecision ───────────────────────────────────────────────────
        recordGateDecision(decision) {
            if (decision.action === 'inject_correction')
                corrections++;
            if (decision.action === 'block')
                blocks++;
            gateDecisions.push(decision);
            // Cap at 50; drop oldest entries.
            if (gateDecisions.length > MAX_CAP) {
                gateDecisions.splice(0, gateDecisions.length - MAX_CAP);
            }
        },
        // ── recordInjection ──────────────────────────────────────────────────────
        recordInjection(text, attempt) {
            injections.push({ text, attempt, ts: Date.now() });
            if (injections.length > MAX_CAP) {
                injections.splice(0, injections.length - MAX_CAP);
            }
        },
        // ── finalize ─────────────────────────────────────────────────────────────
        finalize(stopReason, finalAnswer, finOpts) {
            return doFinalize(stopReason, finalAnswer, finOpts);
        },
        // ── abort ────────────────────────────────────────────────────────────────
        abort(reason) {
            return doFinalize('cancelled', undefined, { abortReason: reason });
        },
        // ── state ────────────────────────────────────────────────────────────────
        state() {
            return {
                sessionId,
                toolCalls: [...toolCalls],
                validatorEvents,
                corrections,
                blocks,
                startedAt,
                finalised,
            };
        },
    };
}
// ── attachBridgeToSession ─────────────────────────────────────────────────────
/**
 * Wires a live AcpSession's event stream into the bridge.
 *
 * Starts an async consumer that calls bridge.recordEvent() for every event
 * yielded by session.events().  When the iterator terminates naturally the
 * bridge is auto-finalised with stopReason='end_turn' if it has not already
 * been finalised.
 *
 * Returns an async disposer.  Calling the disposer detaches and finalises
 * the bridge (stopReason='end_turn') if not already done.
 */
export function attachBridgeToSession(session, bridge) {
    let detached = false;
    const consume = () => __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        try {
            try {
                for (var _d = true, _e = __asyncValues(session.events()), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
                    _c = _f.value;
                    _d = false;
                    const event = _c;
                    if (detached)
                        break;
                    bridge.recordEvent(event);
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
                }
                finally { if (e_1) throw e_1.error; }
            }
        }
        catch (_g) {
            // Iterator threw (e.g. agent crash). Bridge will be finalised below.
        }
        // Auto-finalise when the stream ends naturally (not via disposer).
        if (!detached && !bridge.state().finalised) {
            yield bridge.finalize('end_turn');
        }
    });
    void consume();
    return () => __awaiter(this, void 0, void 0, function* () {
        detached = true;
        if (!bridge.state().finalised) {
            yield bridge.finalize('end_turn');
        }
    });
}
