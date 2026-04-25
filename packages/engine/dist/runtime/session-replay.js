/**
 * session-replay.ts — Pyrfor session replay recorder & replayer.
 *
 * Records every agent event (prompts, tool calls, outputs, timings) as
 * append-only JSONL lines.  Replays expose iterators for visualizers /
 * test runners.
 *
 * Design decisions:
 * - Append-only JSONL: one JSON object per line, atomic via appendFile.
 * - In-memory buffer drained by flushEveryNEvents threshold or debounce timer.
 * - writeChain serialises concurrent writes so lines never interleave.
 * - Replayer uses synchronous readFileSync / readdirSync so callers do not
 *   need to await simple queries.
 * - iterate() yields events with wall-clock-proportional delays (speed=1.0)
 *   or as-fast-as-possible (speed=0); honours AbortSignal for cancellation.
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
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
import { promises as fs } from 'node:fs';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
// ── Recorder ───────────────────────────────────────────────────────────────
export function createSessionRecorder(opts) {
    const { storeDir, sessionId, clock = () => Date.now(), flushEveryNEvents = 50, flushDebounceMs = 200, logger, } = opts;
    const filePath = path.join(storeDir, `${sessionId}.jsonl`);
    let buffer = [];
    let totalFlushed = 0;
    let debounceTimer = null;
    let closed = false;
    let dirEnsured = false;
    // Serialise concurrent appendFile calls so lines never interleave.
    let writeChain = Promise.resolve();
    function ensureDir() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!dirEnsured) {
                yield fs.mkdir(storeDir, { recursive: true });
                dirEnsured = true;
            }
        });
    }
    function clearDebounce() {
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
    }
    function scheduleDebounce() {
        if (debounceTimer !== null)
            return;
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            flush().catch((err) => logger === null || logger === void 0 ? void 0 : logger('session-replay: flush error', err));
        }, flushDebounceMs);
    }
    function doWrite(events) {
        return __awaiter(this, void 0, void 0, function* () {
            yield ensureDir();
            const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
            yield fs.appendFile(filePath, lines, 'utf8');
        });
    }
    function flush() {
        return __awaiter(this, void 0, void 0, function* () {
            // If nothing buffered, still await any in-flight write so callers that
            // do `await flush()` after an auto-flush get a true "written" guarantee.
            if (buffer.length === 0)
                return writeChain;
            const toWrite = buffer.splice(0);
            totalFlushed += toWrite.length;
            clearDebounce();
            writeChain = writeChain.then(() => doWrite(toWrite));
            return writeChain;
        });
    }
    function record(kind, payload) {
        if (closed)
            return;
        const event = {
            ts: clock(),
            sessionId,
            kind,
            payload: payload !== null && payload !== void 0 ? payload : {},
        };
        buffer.push(event);
        if (buffer.length >= flushEveryNEvents) {
            clearDebounce();
            flush().catch((err) => logger === null || logger === void 0 ? void 0 : logger('session-replay: flush error', err));
        }
        else {
            scheduleDebounce();
        }
    }
    function close() {
        return __awaiter(this, void 0, void 0, function* () {
            if (closed)
                return;
            closed = true;
            // Always append a sessionEnd marker.
            buffer.push({ ts: clock(), sessionId, kind: 'sessionEnd', payload: {} });
            yield flush();
        });
    }
    return {
        record,
        meta(payload) { record('meta', payload); },
        sessionStart(payload) { record('sessionStart', payload !== null && payload !== void 0 ? payload : {}); },
        sessionEnd(payload) { record('sessionEnd', payload !== null && payload !== void 0 ? payload : {}); },
        flush,
        close,
        count() { return totalFlushed + buffer.length; },
    };
}
// ── Replayer helpers ───────────────────────────────────────────────────────
function parseJsonlLines(content, onCorrupt) {
    const events = [];
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            events.push(JSON.parse(trimmed));
        }
        catch (_a) {
            onCorrupt === null || onCorrupt === void 0 ? void 0 : onCorrupt(trimmed);
        }
    }
    return events;
}
function readEventsSync(filePath) {
    let content;
    try {
        content = readFileSync(filePath, 'utf8');
    }
    catch (_a) {
        return [];
    }
    return parseJsonlLines(content, (line) => console.warn(`session-replay: skipping corrupt JSONL line: ${line.slice(0, 120)}`));
}
function sleep(ms, signal) {
    return new Promise((resolve) => {
        if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
            resolve();
            return;
        }
        const id = setTimeout(resolve, ms);
        signal === null || signal === void 0 ? void 0 : signal.addEventListener('abort', () => { clearTimeout(id); resolve(); }, { once: true });
    });
}
// ── Replayer ───────────────────────────────────────────────────────────────
export function createSessionReplayer(opts) {
    const { storeDir } = opts;
    function loadSession(sessionId) {
        return readEventsSync(path.join(storeDir, `${sessionId}.jsonl`));
    }
    function listSessions() {
        let files;
        try {
            files = readdirSync(storeDir);
        }
        catch (_a) {
            return [];
        }
        const results = [];
        for (const f of files) {
            if (!f.endsWith('.jsonl'))
                continue;
            const sessionId = f.slice(0, -6);
            const events = readEventsSync(path.join(storeDir, f));
            if (events.length === 0)
                continue;
            results.push({
                sessionId,
                eventCount: events.length,
                firstTs: events[0].ts,
                lastTs: events[events.length - 1].ts,
            });
        }
        return results;
    }
    function iterate(sessionId, iterOpts) {
        return __asyncGenerator(this, arguments, function* iterate_1() {
            var _a;
            const speed = (_a = iterOpts === null || iterOpts === void 0 ? void 0 : iterOpts.speed) !== null && _a !== void 0 ? _a : 1.0;
            const signal = iterOpts === null || iterOpts === void 0 ? void 0 : iterOpts.signal;
            const events = loadSession(sessionId);
            for (let i = 0; i < events.length; i++) {
                if (signal === null || signal === void 0 ? void 0 : signal.aborted)
                    return yield __await(void 0);
                yield yield __await(events[i]);
                if (speed > 0 && i < events.length - 1) {
                    const gapMs = Math.max(0, events[i + 1].ts - events[i].ts);
                    if (gapMs > 0) {
                        yield __await(sleep(gapMs / speed, signal));
                    }
                }
            }
        });
    }
    function filter(events, pred) {
        return events.filter(pred);
    }
    function tail(sessionId, n) {
        const events = loadSession(sessionId);
        return events.slice(Math.max(0, events.length - n));
    }
    function exportJson(sessionId) {
        return JSON.stringify(loadSession(sessionId));
    }
    return { listSessions, loadSession, iterate, filter, tail, exportJson };
}
