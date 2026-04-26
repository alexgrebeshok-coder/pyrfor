// @vitest-environment node
/**
 * ledger-metrics.test.ts — unit + integration tests for LedgerMetrics.
 *
 * Test groups:
 *  1. quantile()
 *  2. escapeLabelValue()
 *  3. labelsToString()
 *  4. ingest() — counter & histogram behaviour
 *  5. snapshot() — shape and correctness
 *  6. toPrometheus() — format and content
 *  7. reset()
 *  8. Polling integration (real EventLedger, temp file)
 *  9. histogramSampleCap ring-buffer
 * 10. agent_events_total catch-all counter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { makeEvent, EventLedger } from './event-ledger';
import {
  LedgerMetrics,
  quantile,
  escapeLabelValue,
  labelsToString,
} from './ledger-metrics';

// ====== Test helpers =========================================================

function tmpLedgerPath(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `ledger-metrics-test-${hex}`, 'ledger.jsonl');
}

// ====== 1. quantile() ========================================================

describe('quantile', () => {
  it('returns 0 for an empty array', () => {
    expect(quantile([], 0.5)).toBe(0);
  });

  it('returns the single value for a one-element array', () => {
    expect(quantile([42], 0.5)).toBe(42);
    expect(quantile([7], 0)).toBe(7);
    expect(quantile([7], 1)).toBe(7);
  });

  it('p50 of [1..10] is 5.5 (linear interpolation)', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(arr, 0.5)).toBeCloseTo(5.5);
  });

  it('p95 of [1..10] is 9.55', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(arr, 0.95)).toBeCloseTo(9.55);
  });

  it('p99 of [1..10] is 9.91', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(arr, 0.99)).toBeCloseTo(9.91);
  });

  it('clamps q < 0 to 0 (returns min)', () => {
    const arr = [3, 6, 9];
    expect(quantile(arr, -1)).toBe(3);
  });

  it('clamps q > 1 to 1 (returns max)', () => {
    const arr = [3, 6, 9];
    expect(quantile(arr, 2)).toBe(9);
  });

  it('q=0 returns first element, q=1 returns last', () => {
    const arr = [10, 20, 30, 40, 50];
    expect(quantile(arr, 0)).toBe(10);
    expect(quantile(arr, 1)).toBe(50);
  });
});

// ====== 2. escapeLabelValue() ================================================

describe('escapeLabelValue', () => {
  it('escapes backslashes', () => {
    expect(escapeLabelValue('a\\b')).toBe('a\\\\b');
  });

  it('escapes double quotes', () => {
    expect(escapeLabelValue('say "hi"')).toBe('say \\"hi\\"');
  });

  it('escapes newlines', () => {
    expect(escapeLabelValue('line1\nline2')).toBe('line1\\nline2');
  });

  it('leaves plain strings unchanged', () => {
    expect(escapeLabelValue('read_file')).toBe('read_file');
  });

  it('escapes backslash before quote to avoid double-escaping', () => {
    // input: \"  →  output: \\\"
    expect(escapeLabelValue('\\"')).toBe('\\\\\\"');
  });
});

// ====== 3. labelsToString() ==================================================

describe('labelsToString', () => {
  it('returns "" for empty labels', () => {
    expect(labelsToString({})).toBe('');
  });

  it('returns a single key=value pair', () => {
    expect(labelsToString({ tool: 'bash' })).toBe('{tool="bash"}');
  });

  it('sorts keys alphabetically regardless of insertion order', () => {
    const result = labelsToString({ z: 'last', a: 'first', m: 'mid' });
    expect(result).toBe('{a="first",m="mid",z="last"}');
  });

  it('puts quantile before tool alphabetically', () => {
    const result = labelsToString({ tool: 'x', quantile: '0.5' });
    expect(result).toBe('{quantile="0.5",tool="x"}');
  });

  it('escapes label values that contain special chars', () => {
    expect(labelsToString({ msg: 'say "hi"' })).toBe('{msg="say \\"hi\\""}');
  });
});

// ====== 4. ingest() — counter & histogram behaviour =========================

describe('LedgerMetrics ingest', () => {
  let metrics: LedgerMetrics;

  // Placeholder ledger — ingest() bypasses it, but constructor requires one.
  const dummyLedger = {
    readAll: async () => [],
    append: async () => { throw new Error('not used'); },
    close: async () => {},
  } as unknown as EventLedger;

  beforeEach(() => {
    metrics = new LedgerMetrics({ ledger: dummyLedger });
  });

  // ── tool_call ──────────────────────────────────────────────────────────────

  it('tool.requested increments agent_tool_calls_total', () => {
    metrics.ingest([makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' })]);
    const snap = metrics.snapshot();
    const c = snap.counters.find(
      (x) => x.name === 'agent_tool_calls_total' && x.labels.tool === 'bash',
    );
    expect(c?.value).toBe(1);
  });

  it('tool.executed (no error) increments agent_tool_calls_total', () => {
    metrics.ingest([makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'read_file' })]);
    const snap = metrics.snapshot();
    const c = snap.counters.find(
      (x) => x.name === 'agent_tool_calls_total' && x.labels.tool === 'read_file',
    );
    expect(c?.value).toBe(1);
  });

  it('multiple tool.requested calls accumulate the counter', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' }),
      makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' }),
      makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' }),
    ]);
    const snap = metrics.snapshot();
    const c = snap.counters.find(
      (x) => x.name === 'agent_tool_calls_total' && x.labels.tool === 'bash',
    );
    expect(c?.value).toBe(3);
  });

  // ── tool_error ─────────────────────────────────────────────────────────────

  it('tool.executed with error increments agent_tool_errors_total', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'bash', error: 'timeout', status: 'timeout' }),
    ]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_tool_errors_total');
    expect(c?.value).toBe(1);
    expect(c?.labels.code).toBe('timeout');
    expect(c?.labels.tool).toBe('bash');
  });

  it('tool_error defaults code to "unknown" when status is missing', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'write_file', error: 'boom' }),
    ]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_tool_errors_total');
    expect(c?.labels.code).toBe('unknown');
  });

  it('tool_error does NOT also increment agent_tool_calls_total', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'bash', error: 'oops' }),
    ]);
    const snap = metrics.snapshot();
    const calls = snap.counters.find((x) => x.name === 'agent_tool_calls_total');
    expect(calls).toBeUndefined();
  });

  // ── tool_denied ────────────────────────────────────────────────────────────

  it('tool.denied increments agent_tool_denied_total with reason label', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.denied', run_id: 'r1', tool: 'rm', reason: 'policy' }),
    ]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_tool_denied_total');
    expect(c?.value).toBe(1);
    expect(c?.labels.reason).toBe('policy');
    expect(c?.labels.tool).toBe('rm');
  });

  it('approval.denied increments agent_tool_denied_total', () => {
    metrics.ingest([
      makeEvent({ type: 'approval.denied', run_id: 'r1', tool: 'deploy', reason: 'no-approval' }),
    ]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_tool_denied_total');
    expect(c?.value).toBe(1);
  });

  it('tool_denied defaults reason to "unknown" when missing', () => {
    metrics.ingest([makeEvent({ type: 'tool.denied', run_id: 'r1', tool: 'x' })]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_tool_denied_total');
    expect(c?.labels.reason).toBe('unknown');
  });

  // ── tool duration histogram ────────────────────────────────────────────────

  it('tool.executed with ms feeds agent_tool_duration_ms histogram', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'bash', ms: 250 }),
    ]);
    const snap = metrics.snapshot();
    const h = snap.histograms.find((x) => x.name === 'agent_tool_duration_ms');
    expect(h?.count).toBe(1);
    expect(h?.sum).toBe(250);
  });

  it('tool.executed without ms does not create a histogram entry', () => {
    metrics.ingest([makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'bash' })]);
    const snap = metrics.snapshot();
    const h = snap.histograms.find((x) => x.name === 'agent_tool_duration_ms');
    expect(h).toBeUndefined();
  });

  // ── run lifecycle ──────────────────────────────────────────────────────────

  it('run.created increments agent_runs_started_total', () => {
    metrics.ingest([makeEvent({ type: 'run.created', run_id: 'r1' })]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_runs_started_total');
    expect(c?.value).toBe(1);
  });

  it('run.completed increments agent_runs_completed_total', () => {
    metrics.ingest([makeEvent({ type: 'run.completed', run_id: 'r1' })]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_runs_completed_total');
    expect(c?.value).toBe(1);
  });

  it('run.failed increments agent_runs_failed_total', () => {
    metrics.ingest([makeEvent({ type: 'run.failed', run_id: 'r1' })]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_runs_failed_total');
    expect(c?.value).toBe(1);
  });

  it('run_started + run_completed pair emits agent_run_duration_ms sample', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-01T00:00:02.000Z'); // 2000 ms later
    metrics.ingest([
      makeEvent({ type: 'run.created', run_id: 'run-abc', ts: start.toISOString() } as Parameters<typeof makeEvent>[0]),
      makeEvent({ type: 'run.completed', run_id: 'run-abc', ts: end.toISOString() } as Parameters<typeof makeEvent>[0]),
    ]);
    const snap = metrics.snapshot();
    const h = snap.histograms.find((x) => x.name === 'agent_run_duration_ms');
    expect(h?.count).toBe(1);
    expect(h?.sum).toBe(2000);
    expect(h?.min).toBe(2000);
    expect(h?.max).toBe(2000);
  });

  it('run_started + run_failed pair emits agent_run_duration_ms sample', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-01T00:00:01.500Z'); // 1500 ms later
    metrics.ingest([
      makeEvent({ type: 'run.created', run_id: 'run-xyz', ts: start.toISOString() } as Parameters<typeof makeEvent>[0]),
      makeEvent({ type: 'run.failed', run_id: 'run-xyz', ts: end.toISOString() } as Parameters<typeof makeEvent>[0]),
    ]);
    const snap = metrics.snapshot();
    const h = snap.histograms.find((x) => x.name === 'agent_run_duration_ms');
    expect(h?.count).toBe(1);
    expect(h?.sum).toBe(1500);
  });

  it('run_completed without prior run_started emits no run_duration sample', () => {
    metrics.ingest([makeEvent({ type: 'run.completed', run_id: 'orphan' })]);
    const snap = metrics.snapshot();
    const h = snap.histograms.find((x) => x.name === 'agent_run_duration_ms');
    expect(h).toBeUndefined();
  });
});

// ====== 5. snapshot() ========================================================

describe('LedgerMetrics snapshot()', () => {
  let metrics: LedgerMetrics;
  const dummyLedger = { readAll: async () => [] } as unknown as EventLedger;

  beforeEach(() => {
    metrics = new LedgerMetrics({ ledger: dummyLedger });
  });

  it('generatedAt is a valid ISO timestamp', () => {
    const snap = metrics.snapshot();
    expect(new Date(snap.generatedAt).toISOString()).toBe(snap.generatedAt);
  });

  it('totalEventsProcessed reflects ingested count', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' }),
      makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' }),
    ]);
    expect(metrics.snapshot().totalEventsProcessed).toBe(2);
  });

  it('counters have correct shape (name, value, labels)', () => {
    metrics.ingest([makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' })]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_tool_calls_total');
    expect(c).toMatchObject({ name: 'agent_tool_calls_total', value: 1, labels: { tool: 'bash' } });
  });

  it('histograms have correct shape', () => {
    metrics.ingest([makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'bash', ms: 100 })]);
    const snap = metrics.snapshot();
    const h = snap.histograms[0];
    expect(h).toHaveProperty('name');
    expect(h).toHaveProperty('count');
    expect(h).toHaveProperty('sum');
    expect(h).toHaveProperty('min');
    expect(h).toHaveProperty('max');
    expect(h).toHaveProperty('p50');
    expect(h).toHaveProperty('p95');
    expect(h).toHaveProperty('p99');
  });

  it('histogram stats are accurate for synthetic samples', () => {
    // Feed 100 samples: values 1..100
    const events = Array.from({ length: 100 }, (_, i) =>
      makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'op', ms: i + 1 }),
    );
    metrics.ingest(events);
    const snap = metrics.snapshot();
    const h = snap.histograms.find((x) => x.name === 'agent_tool_duration_ms');
    expect(h?.count).toBe(100);
    expect(h?.sum).toBe(5050); // sum(1..100)
    expect(h?.min).toBe(1);
    expect(h?.max).toBe(100);
    // p50 of sorted [1..100] ≈ 50.5
    expect(h?.p50).toBeCloseTo(50.5);
    // p95 of sorted [1..100] ≈ 95.05
    expect(h?.p95).toBeCloseTo(95.05);
    // p99 of sorted [1..100] ≈ 99.01
    expect(h?.p99).toBeCloseTo(99.01);
  });

  it('counters are sorted alphabetically by name then labels', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'z_tool' }),
      makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'a_tool' }),
    ]);
    const snap = metrics.snapshot();
    const calls = snap.counters.filter((c) => c.name === 'agent_tool_calls_total');
    // a_tool should come before z_tool within the same family
    const tools = calls.map((c) => c.labels.tool);
    expect(tools.indexOf('a_tool')).toBeLessThan(tools.indexOf('z_tool'));
  });
});

// ====== 6. toPrometheus() ====================================================

describe('LedgerMetrics toPrometheus()', () => {
  let metrics: LedgerMetrics;
  const dummyLedger = { readAll: async () => [] } as unknown as EventLedger;

  beforeEach(() => {
    metrics = new LedgerMetrics({ ledger: dummyLedger });
  });

  it('emits HELP and TYPE lines for a counter family', () => {
    metrics.ingest([makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' })]);
    const out = metrics.toPrometheus();
    expect(out).toContain('# HELP agent_tool_calls_total');
    expect(out).toContain('# TYPE agent_tool_calls_total counter');
  });

  it('emits HELP and TYPE lines for a histogram family', () => {
    metrics.ingest([makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'bash', ms: 50 })]);
    const out = metrics.toPrometheus();
    expect(out).toContain('# HELP agent_tool_duration_ms');
    expect(out).toContain('# TYPE agent_tool_duration_ms summary');
  });

  it('counter line has correct format: name{labels} value', () => {
    metrics.ingest([makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'read_file' })]);
    const out = metrics.toPrometheus();
    expect(out).toContain('agent_tool_calls_total{tool="read_file"} 1');
  });

  it('summary emits _count, _sum, and three quantile lines', () => {
    metrics.ingest([makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'bash', ms: 200 })]);
    const out = metrics.toPrometheus();
    expect(out).toContain('agent_tool_duration_ms_count{tool="bash"} 1');
    expect(out).toContain('agent_tool_duration_ms_sum{tool="bash"} 200');
    expect(out).toContain('quantile="0.5"');
    expect(out).toContain('quantile="0.95"');
    expect(out).toContain('quantile="0.99"');
  });

  it('escapes special chars in label values', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.denied', run_id: 'r1', tool: 'x', reason: 'path\nviolation' }),
    ]);
    const out = metrics.toPrometheus();
    expect(out).toContain('\\n');
  });

  it('metric families are sorted alphabetically', () => {
    metrics.ingest([
      makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' }),
      makeEvent({ type: 'run.created', run_id: 'r1' }),
    ]);
    const out = metrics.toPrometheus();
    // agent_events_total < agent_runs_started_total < agent_tool_calls_total
    const eventsIdx = out.indexOf('agent_events_total');
    const runsIdx = out.indexOf('agent_runs_started_total');
    const toolsIdx = out.indexOf('agent_tool_calls_total');
    expect(eventsIdx).toBeLessThan(runsIdx);
    expect(runsIdx).toBeLessThan(toolsIdx);
  });

  it('returns empty string when no events have been ingested', () => {
    expect(metrics.toPrometheus()).toBe('');
  });

  it('output ends with a trailing newline', () => {
    metrics.ingest([makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'x' })]);
    expect(metrics.toPrometheus().endsWith('\n')).toBe(true);
  });
});

// ====== 7. reset() ===========================================================

describe('LedgerMetrics reset()', () => {
  let metrics: LedgerMetrics;
  const dummyLedger = { readAll: async () => [] } as unknown as EventLedger;

  beforeEach(() => {
    metrics = new LedgerMetrics({ ledger: dummyLedger });
  });

  it('clears all counters', () => {
    metrics.ingest([makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' })]);
    metrics.reset();
    expect(metrics.snapshot().counters).toHaveLength(0);
  });

  it('clears all histograms', () => {
    metrics.ingest([makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'bash', ms: 100 })]);
    metrics.reset();
    expect(metrics.snapshot().histograms).toHaveLength(0);
  });

  it('resets totalEventsProcessed to 0', () => {
    metrics.ingest([makeEvent({ type: 'run.created', run_id: 'r1' })]);
    metrics.reset();
    expect(metrics.snapshot().totalEventsProcessed).toBe(0);
  });

  it('metrics accumulate correctly after reset', () => {
    metrics.ingest([makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' })]);
    metrics.reset();
    metrics.ingest([makeEvent({ type: 'tool.requested', run_id: 'r2', tool: 'bash' })]);
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_tool_calls_total');
    expect(c?.value).toBe(1); // only the post-reset event
  });
});

// ====== 8. Polling integration ===============================================

describe('LedgerMetrics polling integration', () => {
  let filePath: string;
  let ledger: EventLedger;
  let metrics: LedgerMetrics;

  beforeEach(() => {
    filePath = tmpLedgerPath();
    ledger = new EventLedger(filePath);
    metrics = new LedgerMetrics({ ledger, pollIntervalMs: 50 });
  });

  afterEach(async () => {
    await metrics.stop();
    await ledger.close();
    try {
      await rm(path.dirname(filePath), { recursive: true, force: true });
    } catch { /* best-effort */ }
  });

  it('picks up events appended after start() within one poll cycle', async () => {
    await metrics.start();
    await ledger.append({ type: 'tool.requested', run_id: 'r1', tool: 'bash' });
    await ledger.append({ type: 'tool.requested', run_id: 'r1', tool: 'bash' });
    // Wait for at least one full poll cycle
    await new Promise((r) => setTimeout(r, 150));
    const snap = metrics.snapshot();
    const c = snap.counters.find(
      (x) => x.name === 'agent_tool_calls_total' && x.labels.tool === 'bash',
    );
    expect(c?.value).toBe(2);
  });

  it('does not double-count events across multiple poll cycles', async () => {
    await ledger.append({ type: 'run.created', run_id: 'r1' });
    await metrics.start(); // initial poll processes the above event
    // Wait two full poll cycles — event must not be re-counted
    await new Promise((r) => setTimeout(r, 150));
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_runs_started_total');
    expect(c?.value).toBe(1);
  });

  it('stop() prevents further processing', async () => {
    await metrics.start();
    await metrics.stop();
    await ledger.append({ type: 'run.created', run_id: 'r1' });
    // Wait beyond one poll interval
    await new Promise((r) => setTimeout(r, 150));
    const snap = metrics.snapshot();
    const c = snap.counters.find((x) => x.name === 'agent_runs_started_total');
    expect(c).toBeUndefined();
  });
});

// ====== 9. histogramSampleCap (ring buffer) ===================================

describe('LedgerMetrics histogramSampleCap', () => {
  const dummyLedger = { readAll: async () => [] } as unknown as EventLedger;
  const CAP = 5;

  it('ring buffer holds at most CAP samples', () => {
    const metrics = new LedgerMetrics({ ledger: dummyLedger, histogramSampleCap: CAP });
    const events = Array.from({ length: CAP + 50 }, (_, i) =>
      makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'op', ms: i + 1 }),
    );
    metrics.ingest(events);
    const snap = metrics.snapshot();
    const h = snap.histograms.find((x) => x.name === 'agent_tool_duration_ms');
    // count is always accurate (total ever)
    expect(h?.count).toBe(CAP + 50);
    // sum is also always accurate
    const expectedSum = ((CAP + 50) * (CAP + 51)) / 2; // sum(1..CAP+50)
    expect(h?.sum).toBe(expectedSum);
  });

  it('min and max reflect all ingested values, not just ring-buffer contents', () => {
    const metrics = new LedgerMetrics({ ledger: dummyLedger, histogramSampleCap: CAP });
    const events = Array.from({ length: CAP + 10 }, (_, i) =>
      makeEvent({ type: 'tool.executed', run_id: 'r1', tool: 'op', ms: i + 1 }),
    );
    metrics.ingest(events);
    const snap = metrics.snapshot();
    const h = snap.histograms.find((x) => x.name === 'agent_tool_duration_ms');
    expect(h?.min).toBe(1);
    expect(h?.max).toBe(CAP + 10);
  });
});

// ====== 10. agent_events_total catch-all =====================================

describe('agent_events_total catch-all counter', () => {
  const dummyLedger = { readAll: async () => [] } as unknown as EventLedger;

  it('every ingested event increments agent_events_total with its type label', () => {
    const metrics = new LedgerMetrics({ ledger: dummyLedger });
    metrics.ingest([
      makeEvent({ type: 'tool.requested', run_id: 'r1', tool: 'bash' }),
      makeEvent({ type: 'run.created', run_id: 'r1' }),
      makeEvent({ type: 'run.completed', run_id: 'r1' }),
    ]);
    const snap = metrics.snapshot();

    const checkType = (t: string) =>
      snap.counters.find(
        (c) => c.name === 'agent_events_total' && c.labels.type === t,
      );

    expect(checkType('tool.requested')?.value).toBe(1);
    expect(checkType('run.created')?.value).toBe(1);
    expect(checkType('run.completed')?.value).toBe(1);
    expect(snap.totalEventsProcessed).toBe(3);
  });

  it('agent_events_total counts unclassified event types too', () => {
    const metrics = new LedgerMetrics({ ledger: dummyLedger });
    // plan.proposed is an 'other' category event
    metrics.ingest([makeEvent({ type: 'plan.proposed', run_id: 'r1', steps: 3 })]);
    const snap = metrics.snapshot();
    const c = snap.counters.find(
      (x) => x.name === 'agent_events_total' && x.labels.type === 'plan.proposed',
    );
    expect(c?.value).toBe(1);
    // Should NOT appear in any other counter
    const otherCounters = snap.counters.filter(
      (x) => x.name !== 'agent_events_total',
    );
    expect(otherCounters).toHaveLength(0);
  });
});
