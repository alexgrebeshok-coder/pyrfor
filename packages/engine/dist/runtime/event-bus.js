/**
 * Pyrfor — centralised pub-sub event bus
 *
 * Features
 * --------
 * - Strongly-typed EventMap generics
 * - Wildcard patterns:  auth.*  *.completed  **
 * - Async handlers with full await + error isolation
 * - emitSync fire-and-forget variant
 * - waitFor promise with optional timeout + predicate
 * - History ring buffer (default 200 events)
 * - listenerCount / removeAll helpers
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
import { randomUUID } from 'node:crypto';
// ── Glob → RegExp ────────────────────────────────────────────────────────────
function globToRegExp(glob) {
    // Escape all regex metacharacters except * which we handle explicitly.
    // We handle `**` first, then `*` so they don't conflict.
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials (not *)
        .replace(/\*\*/g, '\x00') // placeholder for **
        .replace(/\*/g, '[^.]+') // * → one segment (no dot)
        .replace(/\x00/g, '.+'); // ** → one or more chars (any)
    return new RegExp(`^${escaped}$`);
}
// ── Factory ──────────────────────────────────────────────────────────────────
export function createEventBus(opts = {}) {
    var _a, _b, _c;
    const historySize = (_a = opts.historySize) !== null && _a !== void 0 ? _a : 200;
    const clock = (_b = opts.clock) !== null && _b !== void 0 ? _b : (() => Date.now());
    const log = (_c = opts.logger) !== null && _c !== void 0 ? _c : (() => undefined);
    // All subscriptions stored in one flat array for simplicity.
    // matcher === string  → exact type match
    // matcher === null    → onAny
    // matcher instanceof RegExp → pattern
    const entries = [];
    // Ring buffer for history
    const ring = [];
    // ── helpers ────────────────────────────────────────────────────────────────
    function pushHistory(rec) {
        ring.push(rec);
        if (ring.length > historySize)
            ring.splice(0, ring.length - historySize);
    }
    function matchingHandlers(type) {
        const out = [];
        for (const e of entries) {
            if (e.matcher === null) {
                out.push(e.handler);
            }
            else if (e.matcher instanceof RegExp) {
                if (e.matcher.test(type))
                    out.push(e.handler);
            }
            else {
                if (e.matcher === type)
                    out.push(e.handler);
            }
        }
        return out;
    }
    function dispatchRecord(rec) {
        return __awaiter(this, void 0, void 0, function* () {
            const handlers = matchingHandlers(rec.type);
            yield Promise.all(handlers.map((h) => __awaiter(this, void 0, void 0, function* () {
                try {
                    yield h(rec);
                }
                catch (err) {
                    log('event-bus: handler error', { type: rec.type, id: rec.id, err });
                }
            })));
        });
    }
    function buildRecord(type, payload) {
        return { type, payload, ts: clock(), id: randomUUID() };
    }
    // ── API ────────────────────────────────────────────────────────────────────
    function on(type, handler) {
        const entry = { handler, matcher: type };
        entries.push(entry);
        return () => { const i = entries.indexOf(entry); if (i !== -1)
            entries.splice(i, 1); };
    }
    function onAny(handler) {
        const entry = { handler, matcher: null };
        entries.push(entry);
        return () => { const i = entries.indexOf(entry); if (i !== -1)
            entries.splice(i, 1); };
    }
    function onPattern(glob, handler) {
        const re = globToRegExp(glob);
        const entry = { handler, matcher: re };
        entries.push(entry);
        return () => { const i = entries.indexOf(entry); if (i !== -1)
            entries.splice(i, 1); };
    }
    function off(handler) {
        let removed = false;
        for (let i = entries.length - 1; i >= 0; i--) {
            if (entries[i].handler === handler) {
                entries.splice(i, 1);
                removed = true;
            }
        }
        return removed;
    }
    function emit(type, payload) {
        return __awaiter(this, void 0, void 0, function* () {
            const rec = buildRecord(type, payload);
            pushHistory(rec);
            yield dispatchRecord(rec);
        });
    }
    function emitSync(type, payload) {
        const rec = buildRecord(type, payload);
        pushHistory(rec);
        const handlers = matchingHandlers(rec.type);
        for (const h of handlers) {
            try {
                // intentionally ignoring any returned promise
                void h(rec);
            }
            catch (err) {
                log('event-bus: sync handler error', { type: rec.type, id: rec.id, err });
            }
        }
    }
    function waitFor(type, opts = {}) {
        return new Promise((resolve, reject) => {
            let timer;
            const unsub = on(type, (rec) => {
                if (opts.predicate && !opts.predicate(rec.payload))
                    return;
                if (timer !== undefined)
                    clearTimeout(timer);
                unsub();
                resolve(rec.payload);
            });
            if (opts.timeoutMs !== undefined) {
                timer = setTimeout(() => {
                    unsub();
                    reject(new Error(`waitFor('${type}') timed out after ${opts.timeoutMs}ms`));
                }, opts.timeoutMs);
            }
        });
    }
    function history(filter = {}) {
        let result = ring.slice();
        if (filter.type !== undefined)
            result = result.filter((r) => r.type === filter.type);
        if (filter.sinceTs !== undefined)
            result = result.filter((r) => r.ts >= filter.sinceTs);
        if (filter.limit !== undefined)
            result = result.slice(-filter.limit);
        return result;
    }
    function clearHistory() {
        ring.splice(0, ring.length);
    }
    function listenerCount(type) {
        if (type === undefined)
            return entries.length;
        return entries.filter((e) => {
            if (e.matcher === null)
                return false; // onAny — not counted per type
            if (e.matcher instanceof RegExp)
                return e.matcher.test(type);
            return e.matcher === type;
        }).length;
    }
    function removeAll(type) {
        if (type === undefined) {
            entries.splice(0, entries.length);
            return;
        }
        for (let i = entries.length - 1; i >= 0; i--) {
            const m = entries[i].matcher;
            if (m === null)
                continue; // onAny stays
            if (m instanceof RegExp ? m.test(type) : m === type) {
                entries.splice(i, 1);
            }
        }
    }
    return { on, onAny, onPattern, off, emit, emitSync, waitFor, history, clearHistory, listenerCount, removeAll };
}
