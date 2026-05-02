/**
 * ceoclaw-client.ts — Pyrfor-side HTTP integration client for CEOClaw.
 *
 * Pushes run events (heartbeats) to CEOClaw and pulls tasks/goals from it.
 * Subscribes to the engine's EventLedger so every meaningful run.* event
 * becomes a heartbeat ping sent to CEOClaw.
 *
 * Ledger read API used: EventLedger.readAll() — no watch/tail API exists;
 * the client polls every `flushEveryMs` ms (default 2 000 ms) and tracks the
 * last seen `seq` so already-processed events are never resent.
 *
 * Sprint 3 #1 + #7 of UNIFIED_PLAN_FINAL.md.
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
import logger from '../observability/logger.js';
// ====== Pure helpers =========================================================
/**
 * Build standard request headers, optionally including a Bearer token.
 */
export function buildHeaders(apiKey) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }
    return headers;
}
// ====== Error types ==========================================================
/**
 * Wraps a non-2xx HTTP response so callers can inspect the status code.
 */
export class HttpError extends Error {
    constructor(status, statusText, body) {
        super(`HTTP ${status} ${statusText}`);
        this.status = status;
        this.statusText = statusText;
        this.body = body;
        this.name = 'HttpError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
/**
 * Thrown when the per-request AbortController fires due to timeoutMs expiry.
 * Distinct from a user-initiated AbortError so the retry loop can treat it as
 * a transient failure rather than a cancellation.
 */
export class TimeoutError extends Error {
    constructor(ms) {
        super(`Request timed out after ${ms} ms`);
        this.name = 'TimeoutError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
/**
 * Classify an error thrown by fetch (or our helpers) into one of three
 * categories that drive the retry/bail decision.
 *
 *   'cancelled'  — user-initiated abort; never retry
 *   'transient'  — timeout / network error / 5xx; safe to retry
 *   'permanent'  — 4xx (client error); retrying will not help
 */
export function classifyHttpError(e) {
    if (e instanceof Error) {
        // User-initiated abort (not our internal timeout).
        if (e.name === 'AbortError')
            return 'cancelled';
        // Our internal timeout wrapper.
        if (e.name === 'TimeoutError')
            return 'transient';
        // Raw network failures from undici / node-fetch / native fetch.
        const msg = e.message.toLowerCase();
        if (msg.includes('fetch failed') ||
            msg.includes('econnreset') ||
            msg.includes('econnrefused') ||
            msg.includes('network error') ||
            msg.includes('failed to fetch')) {
            return 'transient';
        }
        // HTTP-level errors: 5xx → transient, 4xx → permanent.
        if (e instanceof HttpError) {
            return e.status >= 500 ? 'transient' : 'permanent';
        }
    }
    return 'transient';
}
// ====== Ledger mapping =======================================================
/**
 * Default strategy for converting a LedgerEvent into a CeoclawHeartbeat.
 * Returns null for event types that should not produce a heartbeat.
 *
 * Covered mappings:
 *   run.created            → started
 *   run.completed          → completed  (progress: 1)
 *   run.failed             → failed
 *   run.cancelled          → cancelled
 *   run.blocked            → blocked
 *   approval.requested /
 *   approval.granted   /
 *   approval.denied        → progress
 *   tool.executed          → progress
 *   everything else        → null
 */
export function defaultLedgerMapping(event, ctx) {
    var _a;
    const base = {
        runId: event.run_id,
        workspaceId: ctx.workspaceId,
        occurredAt: event.ts,
    };
    switch (event.type) {
        case 'run.created':
            return Object.assign(Object.assign({}, base), { status: 'started', summary: event.goal });
        case 'run.completed':
            return Object.assign(Object.assign({}, base), { status: 'completed', progress: 1, summary: event.status });
        case 'run.failed':
            return Object.assign(Object.assign({}, base), { status: 'failed', summary: event.error });
        case 'run.cancelled':
            return Object.assign(Object.assign({}, base), { status: 'cancelled', summary: event.reason });
        case 'run.blocked':
            return Object.assign(Object.assign({}, base), { status: 'blocked', summary: event.reason });
        case 'approval.requested':
        case 'approval.granted':
        case 'approval.denied':
            return Object.assign(Object.assign({}, base), { status: 'progress', summary: event.type, metadata: { tool: event.tool } });
        case 'tool.executed':
            return Object.assign(Object.assign({}, base), { status: 'progress', summary: `tool:${(_a = event.tool) !== null && _a !== void 0 ? _a : 'unknown'}`, metadata: { tool: event.tool, ms: event.ms, toolStatus: event.status } });
        default:
            return null;
    }
}
// ====== Internal constants ===================================================
const BASE_PATH = '/api/integrations/pyrfor';
const MAX_QUEUE = 1000;
/**
 * HTTP client for the CEOClaw integration API.
 *
 * All network methods retry on transient (5xx / timeout / network) errors
 * up to `retry.attempts` times with linear back-off.
 */
export class CeoclawClient {
    constructor(opts) {
        var _a, _b, _c, _d, _e, _f;
        this._stats = { sent: 0, failed: 0, queued: 0 };
        this.baseUrl = opts.baseUrl.replace(/\/$/, '');
        this.apiKey = opts.apiKey;
        this.workspaceId = opts.workspaceId;
        this.timeoutMs = (_a = opts.timeoutMs) !== null && _a !== void 0 ? _a : 8000;
        this.retry = {
            attempts: (_c = (_b = opts.retry) === null || _b === void 0 ? void 0 : _b.attempts) !== null && _c !== void 0 ? _c : 2,
            backoffMs: (_e = (_d = opts.retry) === null || _d === void 0 ? void 0 : _d.backoffMs) !== null && _e !== void 0 ? _e : 250,
        };
        this.fetchImpl = opts.fetchImpl;
        this.clockFn = (_f = opts.clock) !== null && _f !== void 0 ? _f : (() => Date.now());
    }
    // ─── Private helpers ───────────────────────────────────────────────────────
    get fetch() {
        var _a;
        return (_a = this.fetchImpl) !== null && _a !== void 0 ? _a : globalThis.fetch;
    }
    /**
     * Execute a single fetch call guarded by an AbortController-based timeout.
     * On timeout, throws TimeoutError (which classifyHttpError maps to 'transient').
     */
    _fetchOnce(url, init) {
        return __awaiter(this, void 0, void 0, function* () {
            const controller = new AbortController();
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, this.timeoutMs);
            try {
                return yield this.fetch(url, Object.assign(Object.assign({}, init), { signal: controller.signal }));
            }
            catch (e) {
                if (timedOut)
                    throw new TimeoutError(this.timeoutMs);
                throw e;
            }
            finally {
                clearTimeout(timer);
            }
        });
    }
    /**
     * Execute a request with automatic retry on transient errors.
     * Returns the Response on 2xx; throws HttpError on non-2xx (after retries).
     */
    _request(url_1) {
        return __awaiter(this, arguments, void 0, function* (url, init = {}) {
            const { attempts, backoffMs } = this.retry;
            let lastErr;
            for (let attempt = 0; attempt <= attempts; attempt++) {
                if (attempt > 0) {
                    yield new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
                }
                try {
                    const res = yield this._fetchOnce(url, init);
                    if (!res.ok) {
                        const body = yield res.text().catch(() => '');
                        throw new HttpError(res.status, res.statusText, body);
                    }
                    return res;
                }
                catch (e) {
                    const kind = classifyHttpError(e);
                    if (kind === 'cancelled')
                        throw e;
                    if (kind === 'transient' && attempt < attempts) {
                        lastErr = e;
                        continue;
                    }
                    throw e;
                }
            }
            // Safety net — reached only when all retry iterations used `continue`.
            throw lastErr;
        });
    }
    /** Build an absolute URL with optional query parameters. */
    buildUrl(subPath, params) {
        const url = new URL(`${this.baseUrl}${BASE_PATH}${subPath}`);
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined)
                    url.searchParams.set(k, String(v));
            }
        }
        return url.toString();
    }
    // ─── Public API ─────────────────────────────────────────────────────────────
    /** Ping the CEOClaw health endpoint. Measures round-trip latency. */
    health() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const t0 = this.clockFn();
            const res = yield this._request(this.buildUrl('/health'), {
                method: 'GET',
                headers: buildHeaders(this.apiKey),
            });
            const body = (yield res.json());
            return {
                ok: (_a = body.ok) !== null && _a !== void 0 ? _a : true,
                version: body.version,
                latencyMs: this.clockFn() - t0,
            };
        });
    }
    /** List tasks, optionally filtered by status / goal / assignee. */
    listTasks(filter) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield this._request(this.buildUrl('/tasks', {
                status: filter === null || filter === void 0 ? void 0 : filter.status,
                goalId: filter === null || filter === void 0 ? void 0 : filter.goalId,
                assigneeId: filter === null || filter === void 0 ? void 0 : filter.assigneeId,
                limit: filter === null || filter === void 0 ? void 0 : filter.limit,
            }), { method: 'GET', headers: buildHeaders(this.apiKey) });
            return (yield res.json());
        });
    }
    /** Fetch a single task by ID; returns null if the server responds 404. */
    getTask(id) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const res = yield this._request(this.buildUrl(`/tasks/${encodeURIComponent(id)}`), { method: 'GET', headers: buildHeaders(this.apiKey) });
                return (yield res.json());
            }
            catch (e) {
                if (e instanceof HttpError && e.status === 404)
                    return null;
                throw e;
            }
        });
    }
    /**
     * Create-or-update a task. The server performs an upsert keyed on `task.id`
     * when present, or creates a new task when `id` is absent.
     */
    upsertTask(task) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield this._request(this.buildUrl('/tasks'), {
                method: 'PUT',
                headers: buildHeaders(this.apiKey),
                body: JSON.stringify(task),
            });
            return (yield res.json());
        });
    }
    /**
     * Delete a task by ID.
     * Returns true if the server deleted it (2xx), false if it was not found (404).
     */
    deleteTask(id) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this._request(this.buildUrl(`/tasks/${encodeURIComponent(id)}`), { method: 'DELETE', headers: buildHeaders(this.apiKey) });
                return true;
            }
            catch (e) {
                if (e instanceof HttpError && e.status === 404)
                    return false;
                throw e;
            }
        });
    }
    /** List goals, optionally filtered by status. */
    listGoals(filter) {
        return __awaiter(this, void 0, void 0, function* () {
            const res = yield this._request(this.buildUrl('/goals', {
                status: filter === null || filter === void 0 ? void 0 : filter.status,
                limit: filter === null || filter === void 0 ? void 0 : filter.limit,
            }), { method: 'GET', headers: buildHeaders(this.apiKey) });
            return (yield res.json());
        });
    }
    /** Send a single heartbeat event. */
    sendHeartbeat(hb) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const res = yield this._request(this.buildUrl('/heartbeat'), {
                method: 'POST',
                headers: buildHeaders(this.apiKey),
                body: JSON.stringify(hb),
            });
            const body = (yield res.json());
            this._stats.sent++;
            return { accepted: (_a = body.accepted) !== null && _a !== void 0 ? _a : true, serverId: body.serverId };
        });
    }
    /**
     * Send a batch of heartbeat events in one HTTP call.
     * Returns server-confirmed accepted / rejected counts.
     */
    sendBatch(hbs) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const res = yield this._request(this.buildUrl('/heartbeat/batch'), {
                method: 'POST',
                headers: buildHeaders(this.apiKey),
                body: JSON.stringify(hbs),
            });
            const body = (yield res.json());
            const accepted = (_a = body.accepted) !== null && _a !== void 0 ? _a : hbs.length;
            const rejected = (_b = body.rejected) !== null && _b !== void 0 ? _b : 0;
            this._stats.sent += accepted;
            this._stats.failed += rejected;
            return { accepted, rejected };
        });
    }
    // ─── Ledger subscription ────────────────────────────────────────────────────
    /**
     * Subscribe to an EventLedger, polling for new events and forwarding them
     * to CEOClaw as batched heartbeats.
     *
     * Implementation notes:
     *   - Uses EventLedger.readAll() (no server-push / watch API available).
     *   - Tracks the last processed `seq` to skip already-sent events.
     *   - Failed batches are kept in a bounded in-memory queue (max 1 000 items)
     *     and retried on the next poll cycle.
     *   - Returns a disposer (() => void / Promise<void>) that stops the interval
     *     and performs a final flush.
     *
     * @param ledger    The EventLedger instance to subscribe to.
     * @param opts.mapping       Custom event→heartbeat mapper (default: defaultLedgerMapping).
     * @param opts.flushEveryMs  Poll interval in ms (default: 2 000).
     * @param opts.maxBatch      Maximum heartbeats per sendBatch call (default: 50).
     */
    subscribeLedger(ledger, opts) {
        var _a, _b, _c;
        const flushEveryMs = (_a = opts === null || opts === void 0 ? void 0 : opts.flushEveryMs) !== null && _a !== void 0 ? _a : 2000;
        const maxBatch = (_b = opts === null || opts === void 0 ? void 0 : opts.maxBatch) !== null && _b !== void 0 ? _b : 50;
        const mapFn = (_c = opts === null || opts === void 0 ? void 0 : opts.mapping) !== null && _c !== void 0 ? _c : ((e) => defaultLedgerMapping(e, { workspaceId: this.workspaceId }));
        let lastSeq = -1;
        let stopped = false;
        const pendingQueue = [];
        const syncQueuedStat = () => {
            this._stats.queued = pendingQueue.length;
        };
        // Send up to maxBatch items from pendingQueue; requeue on network failure.
        const flush = () => __awaiter(this, void 0, void 0, function* () {
            if (pendingQueue.length === 0)
                return;
            const batch = pendingQueue.splice(0, maxBatch);
            syncQueuedStat();
            try {
                yield this.sendBatch(batch);
                // sendBatch updates sent/failed stats internally.
            }
            catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                logger.warn('[CeoclawClient] sendBatch failed, requeueing heartbeats', { error: errMsg });
                this._stats.lastError = errMsg;
                this._stats.failed += batch.length;
                // Requeue up to the bounded limit.
                const available = MAX_QUEUE - pendingQueue.length;
                pendingQueue.unshift(...batch.slice(0, available));
                syncQueuedStat();
            }
        });
        // Poll ledger, enqueue new events, then flush.
        const poll = () => __awaiter(this, void 0, void 0, function* () {
            try {
                const events = yield ledger.readAll();
                const newEvents = events.filter((e) => e.seq > lastSeq);
                if (newEvents.length > 0) {
                    lastSeq = newEvents[newEvents.length - 1].seq;
                    for (const event of newEvents) {
                        if (pendingQueue.length >= MAX_QUEUE)
                            break;
                        const hb = mapFn(event);
                        if (hb)
                            pendingQueue.push(hb);
                    }
                    syncQueuedStat();
                }
                yield flush();
            }
            catch (e) {
                logger.warn('[CeoclawClient] ledger poll error', {
                    error: e instanceof Error ? e.message : String(e),
                });
            }
            syncQueuedStat();
        });
        const timer = setInterval(() => {
            if (!stopped)
                void poll();
        }, flushEveryMs);
        // Disposer: stop interval and do one final flush.
        return () => {
            stopped = true;
            clearInterval(timer);
            void poll();
        };
    }
    /** Return a snapshot of cumulative send statistics. */
    getStats() {
        return Object.assign({}, this._stats);
    }
}
