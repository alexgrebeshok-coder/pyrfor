var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
// ─── Helpers ───────────────────────────────────────────────────────────────────
function newId() {
    return randomBytes(8).toString('hex');
}
// ─── Factory ───────────────────────────────────────────────────────────────────
export function createTracer(opts = {}) {
    var _a, _b;
    const nowFn = (_a = opts.now) !== null && _a !== void 0 ? _a : (() => Date.now());
    const emitFn = opts.emit;
    const bufferSize = (_b = opts.bufferSize) !== null && _b !== void 0 ? _b : 200;
    const storage = new AsyncLocalStorage();
    const buffer = [];
    function addToBuffer(record) {
        if (buffer.length >= bufferSize)
            buffer.shift();
        buffer.push(record);
    }
    function startSpan(name, attrs) {
        const parent = storage.getStore();
        const id = newId();
        const traceId = parent ? parent.traceId : newId();
        const parentId = parent === null || parent === void 0 ? void 0 : parent.id;
        const startMs = nowFn();
        const spanAttrs = Object.assign({}, (attrs !== null && attrs !== void 0 ? attrs : {}));
        const events = [];
        let status = 'ok';
        let errorMsg;
        let ended = false;
        const span = {
            get id() { return id; },
            get traceId() { return traceId; },
            get parentId() { return parentId; },
            get name() { return name; },
            get attrs() { return spanAttrs; },
            addEvent(eventName, eventAttrs) {
                events.push(eventAttrs !== undefined
                    ? { name: eventName, timeMs: nowFn(), attrs: eventAttrs }
                    : { name: eventName, timeMs: nowFn() });
            },
            setAttr(key, value) {
                spanAttrs[key] = value;
            },
            setStatus(s, msg) {
                status = s;
                if (msg !== undefined)
                    errorMsg = msg;
            },
            end() {
                if (ended)
                    return;
                ended = true;
                const endMs = nowFn();
                const record = Object.assign(Object.assign(Object.assign({ id,
                    traceId }, (parentId !== undefined ? { parentId } : {})), { name,
                    startMs,
                    endMs, durationMs: endMs - startMs, attrs: Object.assign({}, spanAttrs), events: [...events], status }), (errorMsg !== undefined ? { error: errorMsg } : {}));
                addToBuffer(record);
                // Bug fix: swallow emit errors so a misbehaving callback cannot crash the caller.
                try {
                    emitFn === null || emitFn === void 0 ? void 0 : emitFn(record);
                }
                catch ( /* intentionally swallowed */_a) { /* intentionally swallowed */ }
            },
        };
        return span;
    }
    function withSpan(name, fn, attrs) {
        return __awaiter(this, void 0, void 0, function* () {
            const span = startSpan(name, attrs);
            return storage.run(span, () => __awaiter(this, void 0, void 0, function* () {
                try {
                    const result = yield fn(span);
                    span.end();
                    return result;
                }
                catch (err) {
                    span.setStatus('error', err instanceof Error ? err.message : String(err));
                    span.end();
                    throw err;
                }
            }));
        });
    }
    return {
        startSpan,
        withSpan,
        getActiveSpan() {
            return storage.getStore();
        },
        recent(limit) {
            const n = limit !== null && limit !== void 0 ? limit : bufferSize;
            return buffer.slice(-n);
        },
    };
}
