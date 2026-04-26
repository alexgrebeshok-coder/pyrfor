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

import type { EventLedger, LedgerEvent } from './event-ledger';

// ====== Public option / snapshot interfaces ==================================

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

// ====== Pure helpers =========================================================

/**
 * Compute a quantile from a sorted-ascending array using linear interpolation.
 * Returns 0 for an empty array. `q` is clamped to [0, 1].
 */
export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const clamped = Math.min(1, Math.max(0, q));
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = clamped * (sortedAsc.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedAsc[lower];
  const frac = idx - lower;
  return sortedAsc[lower] * (1 - frac) + sortedAsc[upper] * frac;
}

/**
 * Escape a label value for Prometheus text format.
 * Escapes backslashes, double-quotes, and newlines per the exposition spec.
 */
export function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Serialize a labels map to a Prometheus label-set string.
 * Keys are sorted alphabetically. Returns "" for an empty map.
 * Example: { b: "2", a: "1" } → `{a="1",b="2"}`
 */
export function labelsToString(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${parts.join(',')}}`;
}

// ====== Internal types =======================================================

type MetricCategory =
  | 'tool_call'
  | 'tool_error'
  | 'tool_denied'
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'other';

/** Internal ring-buffer state for a single histogram series. */
interface HistogramState {
  name: string;
  labels: Record<string, string>;
  /** Total observations ever (not capped). */
  count: number;
  sum: number;
  min: number;
  max: number;
  /** Ring buffer — holds at most `histogramSampleCap` values. */
  samples: number[];
  /** Next write head in the ring buffer. */
  head: number;
}

// ====== Internal helpers =====================================================

/**
 * Classify a LedgerEvent into a broad metric category.
 * Defensively matches multiple plausible event type spellings.
 */
function classifyEvent(e: LedgerEvent): MetricCategory {
  switch (e.type) {
    case 'tool.requested':
    case 'tool.approved':
      return 'tool_call';

    case 'tool.executed': {
      // Events with an `error` field are classified as errors.
      const asErr = e as { error?: string };
      if (asErr.error) return 'tool_error';
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
function getToolName(e: LedgerEvent): string {
  return ('tool' in e ? (e as { tool?: string }).tool : undefined) ?? 'unknown';
}

/** Extract the `reason` label value from any event that may carry one. */
function getReason(e: LedgerEvent): string {
  return ('reason' in e ? (e as { reason?: string }).reason : undefined) ?? 'unknown';
}

/** Extract the `status` / error-code value from a tool-executed event. */
function getErrorCode(e: LedgerEvent): string {
  return ('status' in e ? (e as { status?: string }).status : undefined) ?? 'unknown';
}

// ====== Static Prometheus metadata ===========================================

const COUNTER_HELP: Record<string, string> = {
  agent_events_total: 'Total events observed in ledger',
  agent_runs_completed_total: 'Total run completions observed in ledger',
  agent_runs_failed_total: 'Total run failures observed in ledger',
  agent_runs_started_total: 'Total run starts observed in ledger',
  agent_tool_calls_total: 'Total tool calls observed in ledger',
  agent_tool_denied_total: 'Total tool denials observed in ledger',
  agent_tool_errors_total: 'Total tool errors observed in ledger',
};

const HISTOGRAM_HELP: Record<string, string> = {
  agent_run_duration_ms: 'Run duration in milliseconds (summary)',
  agent_tool_duration_ms: 'Tool execution duration in milliseconds (summary)',
};

// ====== LedgerMetrics class ==================================================

export class LedgerMetrics {
  // ── Options ────────────────────────────────────────────────────────────────
  private readonly ledger: EventLedger;
  private readonly pollIntervalMs: number;
  private readonly histogramSampleCap: number;
  private readonly clock: () => number;

  // ── Counters ───────────────────────────────────────────────────────────────
  /** counter value keyed by serialised `name + labelsToString(labels)` */
  private counters = new Map<string, number>();
  /** metadata keyed by the same key used in `counters` */
  private counterMeta = new Map<string, { name: string; labels: Record<string, string> }>();

  // ── Histograms ─────────────────────────────────────────────────────────────
  private histograms = new Map<string, HistogramState>();

  // ── Misc state ─────────────────────────────────────────────────────────────
  private totalEventsProcessed = 0;
  /** Highest `seq` value already processed; prevents re-ingesting on re-poll. */
  private lastSeq = -1;
  /** Map runId → start timestamp (ms) for run-duration pairing. */
  private runStartTs = new Map<string, number>();
  /** Handle returned by setInterval. */
  private pollTimer?: ReturnType<typeof setInterval>;

  constructor(opts: LedgerMetricsOptions) {
    this.ledger = opts.ledger;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.histogramSampleCap = opts.histogramSampleCap ?? 1024;
    this.clock = opts.clock ?? (() => Date.now());
  }

  // ====== Public API =========================================================

  /** Begin polling the ledger at `pollIntervalMs`. Performs an initial drain. */
  async start(): Promise<void> {
    await this.poll();
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  /** Stop polling. In-flight poll completes naturally. */
  async stop(): Promise<void> {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Directly feed events without going through the ledger.
   * Useful as a test hook; does not affect `lastSeq`.
   */
  ingest(events: LedgerEvent[]): void {
    for (const e of events) {
      this.processEvent(e);
    }
  }

  /** Return a point-in-time snapshot of all aggregated metrics. */
  snapshot(): MetricsSnapshot {
    // ── Counters ──────────────────────────────────────────────────────────────
    const counters: CounterSnapshot[] = [];
    for (const [key, value] of this.counters) {
      const meta = this.counterMeta.get(key)!;
      counters.push({ name: meta.name, value, labels: meta.labels });
    }
    counters.sort((a, b) => {
      const n = a.name.localeCompare(b.name);
      return n !== 0 ? n : labelsToString(a.labels).localeCompare(labelsToString(b.labels));
    });

    // ── Histograms ────────────────────────────────────────────────────────────
    const histograms: HistogramSnapshot[] = [];
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
  toPrometheus(): string {
    const { counters, histograms } = this.snapshot();
    const lines: string[] = [];

    // Group by metric name (families already sorted via snapshot sort)
    const counterFamilies = new Map<string, CounterSnapshot[]>();
    for (const c of counters) {
      let family = counterFamilies.get(c.name);
      if (!family) { family = []; counterFamilies.set(c.name, family); }
      family.push(c);
    }

    const histFamilies = new Map<string, HistogramSnapshot[]>();
    for (const h of histograms) {
      let family = histFamilies.get(h.name);
      if (!family) { family = []; histFamilies.set(h.name, family); }
      family.push(h);
    }

    // Unified sorted list of all metric family names
    const allNames = [
      ...new Set([...counterFamilies.keys(), ...histFamilies.keys()]),
    ].sort();

    for (const name of allNames) {
      if (counterFamilies.has(name)) {
        const help = COUNTER_HELP[name] ?? `${name} counter`;
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} counter`);
        for (const c of counterFamilies.get(name)!) {
          lines.push(`${name}${labelsToString(c.labels)} ${c.value}`);
        }
      } else {
        const help = HISTOGRAM_HELP[name] ?? `${name} summary`;
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} summary`);
        for (const h of histFamilies.get(name)!) {
          const lbl = h.labels;
          lines.push(`${name}_count${labelsToString(lbl)} ${h.count}`);
          lines.push(`${name}_sum${labelsToString(lbl)} ${h.sum}`);
          lines.push(`${name}${labelsToString({ ...lbl, quantile: '0.5' })} ${h.p50}`);
          lines.push(`${name}${labelsToString({ ...lbl, quantile: '0.95' })} ${h.p95}`);
          lines.push(`${name}${labelsToString({ ...lbl, quantile: '0.99' })} ${h.p99}`);
        }
      }
    }

    return lines.length > 0 ? lines.join('\n') + '\n' : '';
  }

  /** Reset all metric state to zero. Does not affect polling schedule. */
  reset(): void {
    this.counters.clear();
    this.counterMeta.clear();
    this.histograms.clear();
    this.totalEventsProcessed = 0;
    this.lastSeq = -1;
    this.runStartTs.clear();
  }

  // ====== Private helpers ====================================================

  /** Drain new events from the ledger, deduplicating by `seq`. */
  private async poll(): Promise<void> {
    const all = await this.ledger.readAll();
    const newEvents = all.filter((e) => e.seq > this.lastSeq);
    if (newEvents.length === 0) return;
    newEvents.sort((a, b) => a.seq - b.seq);
    this.ingest(newEvents);
    this.lastSeq = newEvents[newEvents.length - 1].seq;
  }

  /** Core event processing — updates all relevant counters and histograms. */
  private processEvent(e: LedgerEvent): void {
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
  private emitRunDuration(e: LedgerEvent): void {
    const startTs = this.runStartTs.get(e.run_id);
    if (startTs === undefined) return;
    const endTs = new Date(e.ts).getTime();
    this.recordHistogram('agent_run_duration_ms', {}, endTs - startTs);
    this.runStartTs.delete(e.run_id);
  }

  // ── Counter helpers ────────────────────────────────────────────────────────

  private incrementCounter(name: string, labels: Record<string, string>): void {
    const key = `${name}${labelsToString(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
    if (!this.counterMeta.has(key)) {
      this.counterMeta.set(key, { name, labels });
    }
  }

  // ── Histogram helpers ──────────────────────────────────────────────────────

  private recordHistogram(
    name: string,
    labels: Record<string, string>,
    value: number,
  ): void {
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
    if (value < state.min) state.min = value;
    if (value > state.max) state.max = value;
    // Ring buffer: push until cap, then overwrite oldest slot.
    if (state.samples.length < this.histogramSampleCap) {
      state.samples.push(value);
    } else {
      state.samples[state.head] = value;
      state.head = (state.head + 1) % this.histogramSampleCap;
    }
  }
}
