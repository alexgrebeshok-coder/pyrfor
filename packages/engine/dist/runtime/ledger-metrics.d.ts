/**
 * ledger-metrics.ts — Additive observability module for the EventLedger.
 *
 * Subscribes (via polling with deduplication by `seq`) to an EventLedger and
 * aggregates counters, histograms, and a Prometheus-compatible text snapshot.
 *
 * No external dependencies beyond the engine runtime. Safe to add without
 * modifying event-ledger.ts.
 */
import type { EventLedger, LedgerEvent } from './event-ledger';
export interface LedgerMetricsOptions {
    ledger: EventLedger;
    /** If polling: how often to drain the ledger (ms). Default 1000. */
    pollIntervalMs?: number;
    /** Max histogram samples kept per metric (ring buffer). Default 1024. */
    histogramSampleCap?: number;
    clock?: () => number;
}
export interface CounterSnapshot {
    name: string;
    value: number;
    labels: Record<string, string>;
}
export interface HistogramSnapshot {
    name: string;
    labels: Record<string, string>;
    count: number;
    sum: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
}
export interface MetricsSnapshot {
    generatedAt: string;
    totalEventsProcessed: number;
    counters: CounterSnapshot[];
    histograms: HistogramSnapshot[];
}
/**
 * Compute a quantile from a sorted-ascending array using linear interpolation.
 * Returns 0 for an empty array. `q` is clamped to [0, 1].
 */
export declare function quantile(sortedAsc: number[], q: number): number;
/**
 * Escape a label value for Prometheus text format.
 * Escapes backslashes, double-quotes, and newlines per the exposition spec.
 */
export declare function escapeLabelValue(v: string): string;
/**
 * Serialize a labels map to a Prometheus label-set string.
 * Keys are sorted alphabetically. Returns "" for an empty map.
 * Example: { b: "2", a: "1" } → `{a="1",b="2"}`
 */
export declare function labelsToString(labels: Record<string, string>): string;
export declare class LedgerMetrics {
    private readonly ledger;
    private readonly pollIntervalMs;
    private readonly histogramSampleCap;
    private readonly clock;
    /** counter value keyed by serialised `name + labelsToString(labels)` */
    private counters;
    /** metadata keyed by the same key used in `counters` */
    private counterMeta;
    private histograms;
    private totalEventsProcessed;
    /** Highest `seq` value already processed; prevents re-ingesting on re-poll. */
    private lastSeq;
    /** Map runId → start timestamp (ms) for run-duration pairing. */
    private runStartTs;
    /** Handle returned by setInterval. */
    private pollTimer?;
    constructor(opts: LedgerMetricsOptions);
    /** Begin polling the ledger at `pollIntervalMs`. Performs an initial drain. */
    start(): Promise<void>;
    /** Stop polling. In-flight poll completes naturally. */
    stop(): Promise<void>;
    /**
     * Directly feed events without going through the ledger.
     * Useful as a test hook; does not affect `lastSeq`.
     */
    ingest(events: LedgerEvent[]): void;
    /** Return a point-in-time snapshot of all aggregated metrics. */
    snapshot(): MetricsSnapshot;
    /**
     * Produce a Prometheus text exposition format string.
     *
     * - HELP and TYPE lines are emitted once per metric family.
     * - Metric families are sorted alphabetically.
     * - Within each family, label-sets are sorted alphabetically by their
     *   serialised form.
     */
    toPrometheus(): string;
    /** Reset all metric state to zero. Does not affect polling schedule. */
    reset(): void;
    /** Drain new events from the ledger, deduplicating by `seq`. */
    private poll;
    /** Core event processing — updates all relevant counters and histograms. */
    private processEvent;
    /**
     * Emit a run-duration sample if a matching run_started event was seen.
     * Deletes the start entry so the map doesn't grow unboundedly.
     */
    private emitRunDuration;
    private incrementCounter;
    private recordHistogram;
}
//# sourceMappingURL=ledger-metrics.d.ts.map