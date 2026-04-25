/**
 * pyrfor-fc-control.ts
 *
 * Mid-task control for FreeClaude sessions: abort, resume, and prompt injection.
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
import { runFreeClaude } from './pyrfor-fc-adapter.js';
function extractSessionIdFromEvent(ev) {
    const raw = ev.raw;
    if (typeof (raw === null || raw === void 0 ? void 0 : raw.sessionId) === 'string' && raw.sessionId)
        return raw.sessionId;
    if (typeof (raw === null || raw === void 0 ? void 0 : raw.session_id) === 'string' && raw.session_id)
        return raw.session_id;
    if (ev.type === 'result') {
        const result = ev.result;
        if (typeof (result === null || result === void 0 ? void 0 : result.sessionId) === 'string' && result.sessionId)
            return result.sessionId;
        if (typeof (result === null || result === void 0 ? void 0 : result.session_id) === 'string' && result.session_id)
            return result.session_id;
    }
    return undefined;
}
export function createFcController(ctrlOpts) {
    var _a, _b, _c;
    const runFn = (_a = ctrlOpts === null || ctrlOpts === void 0 ? void 0 : ctrlOpts.runFn) !== null && _a !== void 0 ? _a : runFreeClaude;
    const nowFn = (_b = ctrlOpts === null || ctrlOpts === void 0 ? void 0 : ctrlOpts.now) !== null && _b !== void 0 ? _b : (() => Date.now());
    const log = (_c = ctrlOpts === null || ctrlOpts === void 0 ? void 0 : ctrlOpts.logger) !== null && _c !== void 0 ? _c : ((_level, _msg, _meta) => {
        /* no-op */
    });
    const _history = [];
    function start(opts, taskId) {
        const handle = runFn(opts);
        const running = {
            sessionId: undefined,
            taskId,
            baseOptions: opts,
            handle,
            startedAt: nowFn(),
            _readerDone: Promise.resolve(), // placeholder, replaced below
        };
        // Background events reader — non-blocking, captures sessionId
        running._readerDone = (() => __awaiter(this, void 0, void 0, function* () {
            var _a, e_1, _b, _c;
            try {
                try {
                    for (var _d = true, _e = __asyncValues(handle.events()), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
                        _c = _f.value;
                        _d = false;
                        const ev = _c;
                        if (!running.sessionId) {
                            const id = extractSessionIdFromEvent(ev);
                            if (id) {
                                running.sessionId = id;
                                log('info', 'sessionId captured', { sessionId: id });
                            }
                        }
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
            catch (err) {
                log('info', 'background events reader ended early', { err });
            }
        }))();
        return running;
    }
    function awaitSession(running) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const internal = running;
            const [result] = yield Promise.all([running.handle.complete(), internal._readerDone]);
            const { envelope } = result;
            _history.push({
                sessionId: (_b = (_a = running.sessionId) !== null && _a !== void 0 ? _a : envelope.sessionId) !== null && _b !== void 0 ? _b : '',
                taskId: running.taskId,
                endedAt: nowFn(),
                envelope,
            });
            return envelope;
        });
    }
    function abortSession(running, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const internal = running;
            running.handle.abort(reason);
            const [result] = yield Promise.all([running.handle.complete(), internal._readerDone]);
            const { envelope } = result;
            _history.push({
                sessionId: (_b = (_a = running.sessionId) !== null && _a !== void 0 ? _a : envelope.sessionId) !== null && _b !== void 0 ? _b : '',
                taskId: running.taskId,
                endedAt: nowFn(),
                envelope,
                abortReason: reason,
            });
            return envelope;
        });
    }
    function inject(running, plan, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const envelope = yield abortSession(running, plan.reason);
            const sessionId = (_a = envelope.sessionId) !== null && _a !== void 0 ? _a : running.sessionId;
            if (!sessionId) {
                throw new Error('cannot inject: no session id captured yet');
            }
            const baseAppend = (_b = running.baseOptions.appendSystemPrompt) !== null && _b !== void 0 ? _b : '';
            const correctionBlock = `[CORRECTION]\n${plan.correction}`;
            const newAppend = baseAppend ? `${baseAppend}\n\n${correctionBlock}` : correctionBlock;
            const newOpts = Object.assign(Object.assign(Object.assign(Object.assign({}, running.baseOptions), { resume: sessionId, appendSystemPrompt: newAppend, prompt: (_c = opts === null || opts === void 0 ? void 0 : opts.continuationPrompt) !== null && _c !== void 0 ? _c : 'Continue with the corrections above.' }), (plan.model !== undefined ? { model: plan.model } : {})), (plan.maxTurns !== undefined ? { maxTurns: plan.maxTurns } : {}));
            return start(newOpts, running.taskId);
        });
    }
    function resumeFromHistory(sessionId, prompt, overrides) {
        const newOpts = Object.assign(Object.assign({}, (overrides !== null && overrides !== void 0 ? overrides : {})), { resume: sessionId, prompt });
        return start(newOpts);
    }
    return {
        start,
        await: awaitSession,
        abort: abortSession,
        inject,
        resumeFromHistory,
        history: () => _history,
    };
}
