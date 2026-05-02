/**
 * event-ledger.ts — Append-only JSONL event ledger for Pyrfor run auditing.
 *
 * Features:
 * - Discriminated-union LedgerEvent covering the full run lifecycle
 * - Atomic appends (open 'a', write line, optional fsync)
 * - Crash-safe: never overwrites existing lines; corrupt lines skipped with warn
 * - Line-by-line streaming via readline for memory-efficient reads
 * - Monotonic seq counter seeded from on-disk line count at first open
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
import { open, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import * as nodeCrypto from 'node:crypto';
import path from 'node:path';
import logger from '../observability/logger.js';
// ====== Pure functional helpers =============================================
/**
 * Parse a single JSONL line. Returns null (and warns) on corrupt input.
 */
export function parseLine(line) {
    const trimmed = line.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch (_a) {
        logger.warn(`[EventLedger] Skipping corrupt JSONL line: ${trimmed.slice(0, 120)}`);
        return null;
    }
}
/**
 * Construct a LedgerEvent with auto-generated id and ts; seq defaults to 0.
 * Useful for testing or pre-building events before appending.
 */
export function makeEvent(partial) {
    var _a;
    return Object.assign({ id: nodeCrypto.randomUUID(), ts: new Date().toISOString(), seq: (_a = partial.seq) !== null && _a !== void 0 ? _a : 0 }, partial);
}
export class EventLedger {
    constructor(filePath, opts = {}) {
        /** Monotonic counter — seeded from line count on first append/read. */
        this.seq = -1;
        /** Whether seq has been initialised from disk. */
        this.seqReady = false;
        this.filePath = filePath;
        this.opts = Object.assign({ fsync: false }, opts);
    }
    // ─── Private helpers ──────────────────────────────────────────────────────
    /** Ensure parent directory exists. */
    ensureDir() {
        return __awaiter(this, void 0, void 0, function* () {
            yield mkdir(path.dirname(this.filePath), { recursive: true });
        });
    }
    /** Count existing lines to seed the seq counter (called once). */
    initSeq() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, e_1, _b, _c;
            if (this.seqReady)
                return;
            let count = 0;
            try {
                try {
                    for (var _d = true, _e = __asyncValues(this.readStream()), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
                        _c = _f.value;
                        _d = false;
                        const _event = _c;
                        count++;
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
                // File doesn't exist yet — count stays 0
            }
            this.seq = count;
            this.seqReady = true;
        });
    }
    // ─── Public API ───────────────────────────────────────────────────────────
    /**
     * Append a new event. Auto-fills `id`, `ts`, and `seq`.
     * Uses 'a' flag so existing data is never overwritten.
     */
    append(event) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.ensureDir();
            yield this.initSeq();
            const full = Object.assign(Object.assign({}, event), { id: nodeCrypto.randomUUID(), ts: new Date().toISOString(), seq: this.seq++ });
            const line = JSON.stringify(full) + '\n';
            const fh = yield open(this.filePath, 'a');
            try {
                yield fh.write(line);
                if (this.opts.fsync)
                    yield fh.datasync();
            }
            finally {
                yield fh.close();
            }
            return full;
        });
    }
    /**
     * Read all events from the ledger file.
     * Corrupt lines are skipped (logged as warn).
     */
    readAll() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, e_2, _b, _c;
            const events = [];
            try {
                try {
                    for (var _d = true, _e = __asyncValues(this.readStream()), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
                        _c = _f.value;
                        _d = false;
                        const event = _c;
                        events.push(event);
                    }
                }
                catch (e_2_1) { e_2 = { error: e_2_1 }; }
                finally {
                    try {
                        if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
                    }
                    finally { if (e_2) throw e_2.error; }
                }
            }
            catch (err) {
                const code = err.code;
                if (code !== 'ENOENT')
                    throw err;
            }
            return events;
        });
    }
    /**
     * Stream events line-by-line. Tolerant of a partial last line.
     * Corrupt lines are skipped.
     */
    readStream() {
        return __asyncGenerator(this, arguments, function* readStream_1() {
            var _a, e_3, _b, _c;
            // createReadStream emits errors asynchronously, so we must handle them via
            // the stream's error event before attaching readline.
            const stream = createReadStream(this.filePath, { encoding: 'utf8' });
            // Wrap stream in a promise that resolves once the stream is open (or rejects
            // on ENOENT / other open errors), so we can bail early without leaving
            // dangling handles.
            yield __await(new Promise((resolve, reject) => {
                stream.once('ready', () => resolve());
                stream.once('error', (err) => reject(err));
            }).catch((err) => {
                stream.destroy();
                if (err.code === 'ENOENT')
                    return; // file doesn't exist yet — yield nothing
                throw err;
            }));
            if (stream.destroyed)
                return yield __await(void 0);
            const rl = createInterface({ input: stream, crlfDelay: Infinity });
            try {
                try {
                    for (var _d = true, rl_1 = __asyncValues(rl), rl_1_1; rl_1_1 = yield __await(rl_1.next()), _a = rl_1_1.done, !_a; _d = true) {
                        _c = rl_1_1.value;
                        _d = false;
                        const line = _c;
                        if (!line.trim())
                            continue;
                        const event = parseLine(line);
                        if (event)
                            yield yield __await(event);
                    }
                }
                catch (e_3_1) { e_3 = { error: e_3_1 }; }
                finally {
                    try {
                        if (!_d && !_a && (_b = rl_1.return)) yield __await(_b.call(rl_1));
                    }
                    finally { if (e_3) throw e_3.error; }
                }
            }
            finally {
                rl.close();
                stream.destroy();
            }
        });
    }
    /**
     * Return all events matching `predicate`.
     */
    filter(predicate) {
        return __awaiter(this, void 0, void 0, function* () {
            const all = yield this.readAll();
            return all.filter(predicate);
        });
    }
    /**
     * Return all events for a given run_id in append order.
     */
    byRun(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.filter((e) => e.run_id === runId);
        });
    }
    /**
     * Return the most-recently appended event for a given run_id.
     */
    lastEventForRun(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            const events = yield this.byRun(runId);
            return events.length > 0 ? events[events.length - 1] : undefined;
        });
    }
    /**
     * No-op for API symmetry; individual appends use short-lived file handles.
     */
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            // Nothing to flush — each append opens/closes its own handle.
        });
    }
}
