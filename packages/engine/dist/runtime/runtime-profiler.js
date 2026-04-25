/**
 * runtime-profiler.ts — Pyrfor: lightweight per-stage latency + counter tracker.
 *
 * Pure TS, ESM only. No native dependencies.
 * Uses fs/promises (appendFile, mkdir) for optional JSONL trace output only.
 *
 * Design decisions:
 *  - quantile: nearest-rank via ceil(q * n) - 1, q clamped to [0,1]
 *  - ring trim: after push, splice oldest from head when length > ringSize
 *  - flush queue: linear append; _doFlush drains atomically via splice(0, n)
 *  - concurrent flush: _inflight var; second await reuses in-flight promise
 *  - negative duration: coerced to 0 (non-negative guarantee)
 *  - NaN / ±Infinity: logged as warn, sample skipped
 *  - end() called twice: records two samples (both durations captured)
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
import { appendFile, mkdir } from 'fs/promises';
import path from 'path';
// ── quantile ──────────────────────────────────────────────────────────────────
/**
 * Nearest-rank quantile. q is clamped to [0, 1].
 * Returns 0 for empty arrays.
 *
 * Formula: idx = ceil(q * n) - 1 (0-indexed, clamped to [0, n-1]).
 * Example: [10,20,30,40] q=0.5 → ceil(0.5*4)-1 = 1 → sorted[1] = 20.
 */
export function quantile(values, q) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const clamped = Math.max(0, Math.min(1, q));
    const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(clamped * sorted.length) - 1));
    return sorted[idx];
}
// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_RING_SIZE = 500;
const DEFAULT_FLUSH_DEBOUNCE_MS = 500;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
// ── createRuntimeProfiler ─────────────────────────────────────────────────────
export function createRuntimeProfiler(opts) {
    var _a, _b, _c, _d;
    const ringSize = (_a = opts === null || opts === void 0 ? void 0 : opts.ringSize) !== null && _a !== void 0 ? _a : DEFAULT_RING_SIZE;
    const tracePath = opts === null || opts === void 0 ? void 0 : opts.tracePath;
    const flushDebounceMs = (_b = opts === null || opts === void 0 ? void 0 : opts.flushDebounceMs) !== null && _b !== void 0 ? _b : DEFAULT_FLUSH_DEBOUNCE_MS;
    const defaultWindowMs = (_c = opts === null || opts === void 0 ? void 0 : opts.windowMs) !== null && _c !== void 0 ? _c : DEFAULT_WINDOW_MS;
    const clock = (_d = opts === null || opts === void 0 ? void 0 : opts.clock) !== null && _d !== void 0 ? _d : (() => Date.now());
    const logger = opts === null || opts === void 0 ? void 0 : opts.logger;
    // ── Internal state ────────────────────────────────────────────────────────
    const _samples = new Map();
    const _counters = new Map();
    // Pending samples to be written to tracePath on next flush
    const _flushQueue = [];
    let _debounceTimer = null;
    let _inflight = null;
    // ── Private helpers ───────────────────────────────────────────────────────
    function getBucket(stage) {
        let bucket = _samples.get(stage);
        if (!bucket) {
            bucket = [];
            _samples.set(stage, bucket);
        }
        return bucket;
    }
    function _doFlush() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!tracePath || _flushQueue.length === 0)
                return;
            // Drain atomically (synchronous splice) so no concurrent writer sees same items
            const items = _flushQueue.splice(0, _flushQueue.length);
            if (items.length === 0)
                return;
            const lines = items.map((s) => JSON.stringify(s)).join('\n') + '\n';
            yield mkdir(path.dirname(tracePath), { recursive: true });
            yield appendFile(tracePath, lines, 'utf8');
        });
    }
    function flush() {
        if (!tracePath)
            return Promise.resolve();
        if (_inflight !== null)
            return _inflight;
        const p = _doFlush().finally(() => {
            if (_inflight === p)
                _inflight = null;
        });
        _inflight = p;
        return p;
    }
    function scheduleFlush() {
        if (!tracePath)
            return;
        if (_debounceTimer !== null)
            clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            _debounceTimer = null;
            flush().catch((err) => {
                logger === null || logger === void 0 ? void 0 : logger('error', 'runtime-profiler: flush error', { err });
            });
        }, flushDebounceMs);
    }
    // ── record ────────────────────────────────────────────────────────────────
    function record(stage, durationMs, meta) {
        const dur = Number(durationMs);
        if (!isFinite(dur)) {
            logger === null || logger === void 0 ? void 0 : logger('warn', `runtime-profiler: non-finite durationMs skipped for stage "${stage}"`, {
                durationMs,
            });
            return;
        }
        const coerced = Math.max(0, dur);
        const sample = Object.assign({ stage, durationMs: coerced, ts: new Date(clock()).toISOString() }, (meta !== undefined ? { meta } : {}));
        const bucket = getBucket(stage);
        bucket.push(sample);
        // Ring: trim oldest when over cap
        if (bucket.length > ringSize) {
            bucket.splice(0, bucket.length - ringSize);
        }
        if (tracePath) {
            _flushQueue.push(sample);
            scheduleFlush();
        }
    }
    // ── Public API ────────────────────────────────────────────────────────────
    return {
        start(stage, meta) {
            const t0 = clock();
            return {
                end(extraMeta) {
                    const dur = clock() - t0;
                    const merged = meta !== undefined || extraMeta !== undefined
                        ? Object.assign(Object.assign({}, meta), extraMeta) : undefined;
                    record(stage, dur, merged);
                    return dur;
                },
            };
        },
        record,
        count(name, delta = 1) {
            var _a;
            const next = ((_a = _counters.get(name)) !== null && _a !== void 0 ? _a : 0) + delta;
            _counters.set(name, next);
            return next;
        },
        getCount(name) {
            var _a;
            return (_a = _counters.get(name)) !== null && _a !== void 0 ? _a : 0;
        },
        resetCount(name) {
            if (name !== undefined) {
                _counters.delete(name);
            }
            else {
                _counters.clear();
            }
        },
        snapshot(opts) {
            var _a, _b;
            const winMs = (_a = opts === null || opts === void 0 ? void 0 : opts.windowMs) !== null && _a !== void 0 ? _a : defaultWindowMs;
            const now = clock();
            const windowStart = now - winMs;
            const countersObj = {};
            for (const [k, v] of _counters) {
                countersObj[k] = v;
            }
            const stagesData = [];
            const stagesToProcess = (opts === null || opts === void 0 ? void 0 : opts.stage)
                ? _samples.has(opts.stage) ? [opts.stage] : []
                : Array.from(_samples.keys());
            for (const stage of stagesToProcess) {
                const bucket = (_b = _samples.get(stage)) !== null && _b !== void 0 ? _b : [];
                const filtered = bucket.filter((s) => new Date(s.ts).getTime() >= windowStart);
                if (filtered.length === 0)
                    continue;
                const durations = filtered.map((s) => s.durationMs);
                const total = durations.reduce((a, b) => a + b, 0);
                const count = filtered.length;
                stagesData.push({
                    stage,
                    count,
                    totalMs: total,
                    meanMs: total / count,
                    p50: quantile(durations, 0.5),
                    p95: quantile(durations, 0.95),
                    p99: quantile(durations, 0.99),
                    maxMs: Math.max(...durations),
                    minMs: Math.min(...durations),
                });
            }
            return {
                generatedAt: new Date(now).toISOString(),
                windowMs: winMs,
                stages: stagesData,
                counters: countersObj,
            };
        },
        list(stage, opts) {
            var _a;
            let result;
            if (stage !== undefined) {
                result = ((_a = _samples.get(stage)) !== null && _a !== void 0 ? _a : []).slice();
            }
            else {
                result = [];
                for (const bucket of _samples.values()) {
                    result.push(...bucket);
                }
            }
            if ((opts === null || opts === void 0 ? void 0 : opts.sinceMs) !== undefined) {
                const since = opts.sinceMs;
                result = result.filter((s) => new Date(s.ts).getTime() >= since);
            }
            // Chronological ascending
            result.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
            if ((opts === null || opts === void 0 ? void 0 : opts.limit) !== undefined) {
                result = result.slice(-opts.limit);
            }
            return result;
        },
        clear(stage) {
            if (stage !== undefined) {
                _samples.delete(stage);
            }
            else {
                _samples.clear();
            }
        },
        flush,
    };
}
