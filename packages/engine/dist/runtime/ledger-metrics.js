// @ts-strict
/**
 * ledger-metrics.ts — Additive observability module for the EventLedger.
 *
 * Subscribes (via polling with deduplication by `seq`) to an EventLedger and
 * aggregates counters, histograms, and a Prometheus-compatible text snapshot.
 *
 * No external dependencies beyond the engine runtime. Safe to add without
 * modifying event-ledger.ts.
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
// ====== Pure helpers =========================================================
/**
 * Compute a quantile from a sorted-ascending array using linear interpolation.
 * Returns 0 for an empty array. `q` is clamped to [0, 1].
 */
export function quantile(sortedAsc, q) {
    if (sortedAsc.length === 0)
        return 0;
    const clamped = Math.min(1, Math.max(0, q));
    if (sortedAsc.length === 1)
        return sortedAsc[0];
    const idx = clamped * (sortedAsc.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper)
        return sortedAsc[lower];
    const frac = idx - lower;
    return sortedAsc[lower] * (1 - frac) + sortedAsc[upper] * frac;
}
/**
 * Escape a label value for Prometheus text format.
 * Escapes backslashes, double-quotes, and newlines per the exposition spec.
 */
export function escapeLabelValue(v) {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
/**
 * Serialize a labels map to a Prometheus label-set string.
 * Keys are sorted alphabetically. Returns "" for an empty map.
 * Example: { b: "2", a: "1" } → `{a="1",b="2"}`
 */
export function labelsToString(labels) {
    const keys = Object.keys(labels).sort();
    if (keys.length === 0)
        return '';
    const parts = keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`);
    return `{${parts.join(',')}}`;
}
// ====== Internal helpers =====================================================
/**
 * Classify a LedgerEvent into a broad metric category.
 * Defensively matches multiple plausible event type spellings.
 */
function classifyEvent(e) {
    switch (e.type) {
        case 'tool.requested':
        case 'tool.approved':
            return 'tool_call';
        case 'tool.executed': {
            // Events with an `error` field are classified as errors.
            const asErr = e;
            if (asErr.error)
                return 'tool_error';
            return 'tool_call';
        }
        case 'tool.denied':
        case 'approval.denied':
            return 'tool_denied';
        case 'run.created':
            return 'run_started';
        case 'run.completed':
            return 'run_completed';
        case 'run.failed':
        case 'run.cancelled':
            return 'run_failed';
        default:
            return 'other';
    }
}
/** Extract the `tool` label value from any event that may carry one. */
function getToolName(e) {
    var _a;
    return (_a = ('tool' in e ? e.tool : undefined)) !== null && _a !== void 0 ? _a : 'unknown';
}
/** Extract the `reason` label value from any event that may carry one. */
function getReason(e) {
    var _a;
    return (_a = ('reason' in e ? e.reason : undefined)) !== null && _a !== void 0 ? _a : 'unknown';
}
/** Extract the `status` / error-code value from a tool-executed event. */
function getErrorCode(e) {
    var _a;
    return (_a = ('status' in e ? e.status : undefined)) !== null && _a !== void 0 ? _a : 'unknown';
}
// ====== Static Prometheus metadata ===========================================
const COUNTER_HELP = {
    agent_events_total: 'Total events observed in ledger',
    agent_runs_completed_total: 'Total run completions observed in ledger',
    agent_runs_failed_total: 'Total run failures observed in ledger',
    agent_runs_started_total: 'Total run starts observed in ledger',
    agent_tool_calls_total: 'Total tool calls observed in ledger',
    agent_tool_denied_total: 'Total tool denials observed in ledger',
    agent_tool_errors_total: 'Total tool errors observed in ledger',
};
const HISTOGRAM_HELP = {
    agent_run_duration_ms: 'Run duration in milliseconds (summary)',
    agent_tool_duration_ms: 'Tool execution duration in milliseconds (summary)',
};
// ====== LedgerMetrics class ==================================================
export class LedgerMetrics {
    constructor(opts) {
        var _a, _b, _c;
        // ── Counters ───────────────────────────────────────────────────────────────
        /** counter value keyed by serialised `name + labelsToString(labels)` */
        this.counters = new Map();
        /** metadata keyed by the same key used in `counters` */
        this.counterMeta = new Map();
        // ── Histograms ─────────────────────────────────────────────────────────────
        this.histograms = new Map();
        // ── Misc state ─────────────────────────────────────────────────────────────
        this.totalEventsProcessed = 0;
        /** Highest `seq` value already processed; prevents re-ingesting on re-poll. */
        this.lastSeq = -1;
        /** Map runId → start timestamp (ms) for run-duration pairing. */
        this.runStartTs = new Map();
        this.ledger = opts.ledger;
        this.pollIntervalMs = (_a = opts.pollIntervalMs) !== null && _a !== void 0 ? _a : 1000;
        this.histogramSampleCap = (_b = opts.histogramSampleCap) !== null && _b !== void 0 ? _b : 1024;
        this.clock = (_c = opts.clock) !== null && _c !== void 0 ? _c : (() => Date.now());
    }
    // ====== Public API =========================================================
    /** Begin polling the ledger at `pollIntervalMs`. Performs an initial drain. */
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.poll();
            this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
        });
    }
    /** Stop polling. In-flight poll completes naturally. */
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.pollTimer !== undefined) {
                clearInterval(this.pollTimer);
                this.pollTimer = undefined;
            }
        });
    }
    /**
     * Directly feed events without going through the ledger.
     * Useful as a test hook; does not affect `lastSeq`.
     */
    ingest(events) {
        for (const e of events) {
            this.processEvent(e);
        }
    }
    /** Return a point-in-time snapshot of all aggregated metrics. */
    snapshot() {
        // ── Counters ──────────────────────────────────────────────────────────────
        const counters = [];
        for (const [key, value] of this.counters) {
            const meta = this.counterMeta.get(key);
            counters.push({ name: meta.name, value, labels: meta.labels });
        }
        counters.sort((a, b) => {
            const n = a.name.localeCompare(b.name);
            return n !== 0 ? n : labelsToString(a.labels).localeCompare(labelsToString(b.labels));
        });
        // ── Histograms ────────────────────────────────────────────────────────────
        const histograms = [];
        for (const [, state] of this.histograms) {
            const sorted = [...state.samples].sort((a, b) => a - b);
            histograms.push({
                name: state.name,
                labels: state.labels,
                count: state.count,
                sum: state.sum,
                min: state.count > 0 ? state.min : 0,
                max: state.count > 0 ? state.max : 0,
                p50: quantile(sorted, 0.5),
                p95: quantile(sorted, 0.95),
                p99: quantile(sorted, 0.99),
            });
        }
        histograms.sort((a, b) => {
            const n = a.name.localeCompare(b.name);
            return n !== 0 ? n : labelsToString(a.labels).localeCompare(labelsToString(b.labels));
        });
        return {
            generatedAt: new Date(this.clock()).toISOString(),
            totalEventsProcessed: this.totalEventsProcessed,
            counters,
            histograms,
        };
    }
    /**
     * Produce a Prometheus text exposition format string.
     *
     * - HELP and TYPE lines are emitted once per metric family.
     * - Metric families are sorted alphabetically.
     * - Within each family, label-sets are sorted alphabetically by their
     *   serialised form.
     */
    toPrometheus() {
        var _a, _b;
        const { counters, histograms } = this.snapshot();
        const lines = [];
        // Group by metric name (families already sorted via snapshot sort)
        const counterFamilies = new Map();
        for (const c of counters) {
            let family = counterFamilies.get(c.name);
            if (!family) {
                family = [];
                counterFamilies.set(c.name, family);
            }
            family.push(c);
        }
        const histFamilies = new Map();
        for (const h of histograms) {
            let family = histFamilies.get(h.name);
            if (!family) {
                family = [];
                histFamilies.set(h.name, family);
            }
            family.push(h);
        }
        // Unified sorted list of all metric family names
        const allNames = [
            ...new Set([...counterFamilies.keys(), ...histFamilies.keys()]),
        ].sort();
        for (const name of allNames) {
            if (counterFamilies.has(name)) {
                const help = (_a = COUNTER_HELP[name]) !== null && _a !== void 0 ? _a : `${name} counter`;
                lines.push(`# HELP ${name} ${help}`);
                lines.push(`# TYPE ${name} counter`);
                for (const c of counterFamilies.get(name)) {
                    lines.push(`${name}${labelsToString(c.labels)} ${c.value}`);
                }
            }
            else {
                const help = (_b = HISTOGRAM_HELP[name]) !== null && _b !== void 0 ? _b : `${name} summary`;
                lines.push(`# HELP ${name} ${help}`);
                lines.push(`# TYPE ${name} summary`);
                for (const h of histFamilies.get(name)) {
                    const lbl = h.labels;
                    lines.push(`${name}_count${labelsToString(lbl)} ${h.count}`);
                    lines.push(`${name}_sum${labelsToString(lbl)} ${h.sum}`);
                    lines.push(`${name}${labelsToString(Object.assign(Object.assign({}, lbl), { quantile: '0.5' }))} ${h.p50}`);
                    lines.push(`${name}${labelsToString(Object.assign(Object.assign({}, lbl), { quantile: '0.95' }))} ${h.p95}`);
                    lines.push(`${name}${labelsToString(Object.assign(Object.assign({}, lbl), { quantile: '0.99' }))} ${h.p99}`);
                }
            }
        }
        return lines.length > 0 ? lines.join('\n') + '\n' : '';
    }
    /** Reset all metric state to zero. Does not affect polling schedule. */
    reset() {
        this.counters.clear();
        this.counterMeta.clear();
        this.histograms.clear();
        this.totalEventsProcessed = 0;
        this.lastSeq = -1;
        this.runStartTs.clear();
    }
    // ====== Private helpers ====================================================
    /** Drain new events from the ledger, deduplicating by `seq`. */
    poll() {
        return __awaiter(this, void 0, void 0, function* () {
            const all = yield this.ledger.readAll();
            const newEvents = all.filter((e) => e.seq > this.lastSeq);
            if (newEvents.length === 0)
                return;
            newEvents.sort((a, b) => a.seq - b.seq);
            this.ingest(newEvents);
            this.lastSeq = newEvents[newEvents.length - 1].seq;
        });
    }
    /** Core event processing — updates all relevant counters and histograms. */
    processEvent(e) {
        this.totalEventsProcessed++;
        // Every event counts toward the total-by-type counter.
        this.incrementCounter('agent_events_total', { type: e.type });
        const category = classifyEvent(e);
        switch (category) {
            case 'tool_call': {
                const tool = getToolName(e);
                this.incrementCounter('agent_tool_calls_total', { tool });
                // Record execution duration when available (tool.executed events).
                if (e.type === 'tool.executed' && e.ms != null) {
                    this.recordHistogram('agent_tool_duration_ms', { tool }, e.ms);
                }
                break;
            }
            case 'tool_error': {
                const tool = getToolName(e);
                const code = getErrorCode(e);
                this.incrementCounter('agent_tool_errors_total', { code, tool });
                // Still record duration for error executions if present.
                if (e.type === 'tool.executed' && e.ms != null) {
                    this.recordHistogram('agent_tool_duration_ms', { tool }, e.ms);
                }
                break;
            }
            case 'tool_denied': {
                const tool = getToolName(e);
                const reason = getReason(e);
                this.incrementCounter('agent_tool_denied_total', { reason, tool });
                break;
            }
            case 'run_started': {
                this.incrementCounter('agent_runs_started_total', {});
                const tsMs = new Date(e.ts).getTime();
                this.runStartTs.set(e.run_id, tsMs);
                break;
            }
            case 'run_completed': {
                this.incrementCounter('agent_runs_completed_total', {});
                this.emitRunDuration(e);
                break;
            }
            case 'run_failed': {
                this.incrementCounter('agent_runs_failed_total', {});
                this.emitRunDuration(e);
                break;
            }
            default:
                // 'other' — agent_events_total already incremented above.
                break;
        }
    }
    /**
     * Emit a run-duration sample if a matching run_started event was seen.
     * Deletes the start entry so the map doesn't grow unboundedly.
     */
    emitRunDuration(e) {
        const startTs = this.runStartTs.get(e.run_id);
        if (startTs === undefined)
            return;
        const endTs = new Date(e.ts).getTime();
        this.recordHistogram('agent_run_duration_ms', {}, endTs - startTs);
        this.runStartTs.delete(e.run_id);
    }
    // ── Counter helpers ────────────────────────────────────────────────────────
    incrementCounter(name, labels) {
        var _a;
        const key = `${name}${labelsToString(labels)}`;
        this.counters.set(key, ((_a = this.counters.get(key)) !== null && _a !== void 0 ? _a : 0) + 1);
        if (!this.counterMeta.has(key)) {
            this.counterMeta.set(key, { name, labels });
        }
    }
    // ── Histogram helpers ──────────────────────────────────────────────────────
    recordHistogram(name, labels, value) {
        const key = `${name}${labelsToString(labels)}`;
        let state = this.histograms.get(key);
        if (!state) {
            state = {
                name,
                labels,
                count: 0,
                sum: 0,
                min: Infinity,
                max: -Infinity,
                samples: [],
                head: 0,
            };
            this.histograms.set(key, state);
        }
        state.count++;
        state.sum += value;
        if (value < state.min)
            state.min = value;
        if (value > state.max)
            state.max = value;
        // Ring buffer: push until cap, then overwrite oldest slot.
        if (state.samples.length < this.histogramSampleCap) {
            state.samples.push(value);
        }
        else {
            state.samples[state.head] = value;
            state.head = (state.head + 1) % this.histogramSampleCap;
        }
    }
}
