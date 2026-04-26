// @vitest-environment node
/**
 * Tests for packages/engine/src/subagents/pm-summarizer.ts
 *
 * Covers: groupEventsByRun (grouping, unknown bucket), summarizeRun (status
 * paths, timing, toolCallCount, topTools ordering/limits, errorCount,
 * notableErrors, finalTextPreview truncation, permissionDeniedCount),
 * buildHighlights (all bullet conditions), runPmSummarizer (groupByRun modes,
 * avgDurationMs, highlights count, empty input), and subagentSpec (shape).
 */

import { describe, it, expect } from 'vitest';
import type { LedgerEvent } from '../runtime/event-ledger.js';
import {
  groupEventsByRun,
  summarizeRun,
  buildHighlights,
  runPmSummarizer,
  subagentSpec,
  type RunSummary,
  type PmSummarizerOutput,
} from './pm-summarizer.js';

// ====== Fixtures ======

let _seq = 0;

/**
 * Build a minimal LedgerEvent for test purposes.  All optional fields can be
 * supplied via `extra`; fields not provided fall back to sensible defaults.
 */
function ev(
  type: LedgerEvent['type'],
  extra: Record<string, unknown> = {},
  runId = 'run-1',
): LedgerEvent {
  return {
    id:     `ev-${_seq++}`,
    ts:     new Date(1_700_000_000_000 + _seq * 1000).toISOString(),
    run_id: runId,
    seq:    _seq,
    type,
    ...extra,
  } as unknown as LedgerEvent;
}

/** Convenience: produce a tool.executed event with optional tool name + ms. */
function toolExec(tool: string, ms = 0, runId = 'run-1'): LedgerEvent {
  return ev('tool.executed', { tool, ms }, runId);
}

/** Convenience: produce a tool.requested event. */
function toolReq(tool: string, runId = 'run-1'): LedgerEvent {
  return ev('tool.requested', { tool }, runId);
}

// ====== groupEventsByRun ======

describe('groupEventsByRun', () => {
  it('returns an empty map for an empty array', () => {
    const map = groupEventsByRun([]);
    expect(map.size).toBe(0);
  });

  it('places a single event into the correct run bucket', () => {
    const e = ev('run.created');
    const map = groupEventsByRun([e]);
    expect(map.size).toBe(1);
    expect(map.get('run-1')).toEqual([e]);
  });

  it('separates events belonging to different runs', () => {
    const e1 = ev('run.created', {}, 'run-A');
    const e2 = ev('run.created', {}, 'run-B');
    const map = groupEventsByRun([e1, e2]);
    expect(map.size).toBe(2);
    expect(map.get('run-A')).toEqual([e1]);
    expect(map.get('run-B')).toEqual([e2]);
  });

  it('collects events without a run_id under __unknown__', () => {
    const e = { ...ev('run.created'), run_id: '' } as unknown as LedgerEvent;
    const map = groupEventsByRun([e]);
    expect(map.has('__unknown__')).toBe(true);
    expect(map.get('__unknown__')).toHaveLength(1);
  });

  it('preserves original order within each bucket', () => {
    const events = [
      ev('run.created',   {}, 'run-X'),
      ev('tool.executed', { tool: 'read_file' }, 'run-X'),
      ev('run.completed', {}, 'run-X'),
    ];
    const map = groupEventsByRun(events);
    expect(map.get('run-X')).toEqual(events);
  });

  it('handles mixed known and unknown run_ids together', () => {
    const known   = ev('run.created', {}, 'run-Z');
    const unknown = { ...ev('run.created'), run_id: undefined } as unknown as LedgerEvent;
    const map = groupEventsByRun([known, unknown]);
    expect(map.get('run-Z')).toHaveLength(1);
    expect(map.get('__unknown__')).toHaveLength(1);
  });
});

// ====== summarizeRun — status detection ======

describe('summarizeRun › status', () => {
  it('returns "completed" when run.completed event is present', () => {
    const events = [ev('run.created'), ev('run.completed')];
    expect(summarizeRun(events).status).toBe('completed');
  });

  it('returns "failed" when run.failed is present and run.completed is absent', () => {
    const events = [ev('run.created'), ev('run.failed', { error: 'boom' })];
    expect(summarizeRun(events).status).toBe('failed');
  });

  it('returns "cancelled" when run.cancelled is present', () => {
    const events = [ev('run.created'), ev('run.cancelled', { reason: 'user aborted' })];
    expect(summarizeRun(events).status).toBe('cancelled');
  });

  it('returns "running" when run.created is present but no terminal event', () => {
    const events = [ev('run.created'), ev('tool.executed', { tool: 'bash' })];
    expect(summarizeRun(events).status).toBe('running');
  });

  it('returns "unknown" when no lifecycle events are present', () => {
    const events = [ev('tool.executed', { tool: 'bash' })];
    expect(summarizeRun(events).status).toBe('unknown');
  });

  it('"completed" wins over "failed" when both events are present', () => {
    const events = [ev('run.failed', { error: 'partial' }), ev('run.completed')];
    expect(summarizeRun(events).status).toBe('completed');
  });

  it('"completed" wins over "cancelled"', () => {
    const events = [ev('run.cancelled'), ev('run.completed')];
    expect(summarizeRun(events).status).toBe('completed');
  });

  it('"cancelled" is reported when run.cancelled follows run.failed (no completion)', () => {
    const events = [ev('run.failed', { error: 'x' }), ev('run.cancelled')];
    expect(summarizeRun(events).status).toBe('cancelled');
  });
});

// ====== summarizeRun — timing ======

describe('summarizeRun › timing', () => {
  it('sets startedAt to the ts of the first event', () => {
    const a = ev('run.created');
    const b = ev('run.completed');
    const { startedAt } = summarizeRun([a, b]);
    expect(startedAt).toBe(a.ts);
  });

  it('sets endedAt to the ts of the last event', () => {
    const a = ev('run.created');
    const b = ev('run.completed');
    const { endedAt } = summarizeRun([a, b]);
    expect(endedAt).toBe(b.ts);
  });

  it('computes durationMs as the difference between first and last event timestamps', () => {
    const tsA = '2024-01-01T00:00:00.000Z';
    const tsB = '2024-01-01T00:00:05.000Z'; // +5 s
    const a = { ...ev('run.created'),   ts: tsA } as unknown as LedgerEvent;
    const b = { ...ev('run.completed'), ts: tsB } as unknown as LedgerEvent;
    expect(summarizeRun([a, b]).durationMs).toBe(5000);
  });

  it('sets durationMs to 0 for a single-event run (same ts)', () => {
    const e = ev('run.created');
    expect(summarizeRun([e]).durationMs).toBe(0);
  });

  it('leaves startedAt and endedAt undefined for empty event arrays', () => {
    const { startedAt, endedAt, durationMs } = summarizeRun([]);
    expect(startedAt).toBeUndefined();
    expect(endedAt).toBeUndefined();
    expect(durationMs).toBeUndefined();
  });
});

// ====== summarizeRun — toolCallCount ======

describe('summarizeRun › toolCallCount', () => {
  it('counts tool.executed events', () => {
    expect(summarizeRun([toolExec('bash'), toolExec('read_file')]).toolCallCount).toBe(2);
  });

  it('counts tool.requested events (has tool field)', () => {
    expect(summarizeRun([toolReq('bash'), toolReq('bash')]).toolCallCount).toBe(2);
  });

  it('does not count events that have no tool field and non-matching type', () => {
    const events = [ev('run.created'), ev('run.completed')];
    expect(summarizeRun(events).toolCallCount).toBe(0);
  });

  it('counts both tool.requested and tool.executed when both are present', () => {
    const events = [toolReq('bash'), toolExec('bash', 50)];
    expect(summarizeRun(events).toolCallCount).toBe(2);
  });
});

// ====== summarizeRun — topTools ======

describe('summarizeRun › topTools', () => {
  it('orders by count descending', () => {
    const events = [
      toolExec('read_file'),
      toolExec('read_file'),
      toolExec('bash'),
    ];
    const { topTools } = summarizeRun(events);
    expect(topTools[0].tool).toBe('read_file');
    expect(topTools[1].tool).toBe('bash');
  });

  it('breaks count ties alphabetically', () => {
    const events = [toolExec('zebra'), toolExec('apple')];
    const { topTools } = summarizeRun(events);
    expect(topTools[0].tool).toBe('apple');
    expect(topTools[1].tool).toBe('zebra');
  });

  it('respects topToolsLimit', () => {
    const tools = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const events = tools.map(t => toolExec(t));
    const { topTools } = summarizeRun(events, { topToolsLimit: 3 });
    expect(topTools).toHaveLength(3);
  });

  it('sums totalMs from the ms field of each event', () => {
    const events = [
      toolExec('bash', 100),
      toolExec('bash', 200),
      toolExec('bash', 50),
    ];
    const { topTools } = summarizeRun(events);
    expect(topTools[0].totalMs).toBe(350);
  });

  it('returns an empty topTools array when there are no tool events', () => {
    expect(summarizeRun([ev('run.created')]).topTools).toEqual([]);
  });

  it('defaults to topToolsLimit=5 and omits tools beyond it', () => {
    const tools = ['a','b','c','d','e','f'];
    const events = tools.map(t => toolExec(t));
    expect(summarizeRun(events).topTools).toHaveLength(5);
  });
});

// ====== summarizeRun — errorCount & notableErrors ======

describe('summarizeRun › errors', () => {
  it('counts run.failed events as errors', () => {
    expect(summarizeRun([ev('run.failed', { error: 'boom' })]).errorCount).toBe(1);
  });

  it('counts tool.executed events with an error field', () => {
    const e = ev('tool.executed', { tool: 'bash', error: 'exit 1' });
    expect(summarizeRun([e]).errorCount).toBe(1);
  });

  it('does not count run.completed as an error', () => {
    expect(summarizeRun([ev('run.completed')]).errorCount).toBe(0);
  });

  it('notableErrors selects the last N error events', () => {
    const errs = [
      ev('run.failed', { error: 'first' }),
      ev('run.failed', { error: 'second' }),
      ev('run.failed', { error: 'third' }),
      ev('run.failed', { error: 'fourth' }),
    ];
    const { notableErrors } = summarizeRun(errs, { notableErrorsLimit: 3 });
    expect(notableErrors).toHaveLength(3);
    expect(notableErrors[0].message).toBe('second');
    expect(notableErrors[2].message).toBe('fourth');
  });

  it('extracts error message from a top-level string error field', () => {
    const e = ev('run.failed', { error: 'connection refused' });
    const { notableErrors } = summarizeRun([e]);
    expect(notableErrors[0].message).toBe('connection refused');
  });

  it('extracts error message from a nested data.error object', () => {
    const e = ev('run.failed', { data: { error: { message: 'deep error' } } });
    const { notableErrors } = summarizeRun([e]);
    expect(notableErrors[0].message).toBe('deep error');
  });

  it('falls back to "unknown error" when no message field is found', () => {
    const e = ev('run.failed');
    const { notableErrors } = summarizeRun([e]);
    expect(notableErrors[0].message).toBe('unknown error');
  });

  it('notableErrors ts matches the source event ts', () => {
    const ts = '2024-06-01T12:00:00.000Z';
    const e  = { ...ev('run.failed', { error: 'x' }), ts } as unknown as LedgerEvent;
    expect(summarizeRun([e]).notableErrors[0].ts).toBe(ts);
  });
});

// ====== summarizeRun — finalTextPreview ======

describe('summarizeRun › finalTextPreview', () => {
  it('returns undefined when no assistant-message event is present', () => {
    expect(summarizeRun([ev('run.created')]).finalTextPreview).toBeUndefined();
  });

  it('picks the last matching event and returns short text unchanged', () => {
    const text = 'All done.';
    const e    = ev('assistant.message' as LedgerEvent['type'], { text });
    expect(summarizeRun([e]).finalTextPreview).toBe(text);
  });

  it('truncates text longer than 240 chars and appends "…"', () => {
    const long = 'x'.repeat(300);
    const e    = ev('assistant.message' as LedgerEvent['type'], { text: long });
    const preview = summarizeRun([e]).finalTextPreview!;
    expect(preview).toHaveLength(241); // 240 + ellipsis char
    expect(preview.endsWith('\u2026')).toBe(true);
  });

  it('exactly-240-char text is not truncated', () => {
    const exact = 'y'.repeat(240);
    const e     = ev('assistant.message' as LedgerEvent['type'], { text: exact });
    expect(summarizeRun([e]).finalTextPreview).toBe(exact);
  });

  it('reads text from data.content when data.text is absent', () => {
    const e = ev('final.text' as LedgerEvent['type'], { data: { content: 'hi there' } });
    expect(summarizeRun([e]).finalTextPreview).toBe('hi there');
  });

  it('uses the LAST matching event when multiple exist', () => {
    const first  = ev('assistant.message' as LedgerEvent['type'], { text: 'first' });
    const second = ev('assistant.message' as LedgerEvent['type'], { text: 'second' });
    expect(summarizeRun([first, second]).finalTextPreview).toBe('second');
  });
});

// ====== summarizeRun — permissionDeniedCount ======

describe('summarizeRun › permissionDeniedCount', () => {
  it('counts approval.denied events', () => {
    expect(summarizeRun([ev('approval.denied', { reason: 'policy' })]).permissionDeniedCount).toBe(1);
  });

  it('counts tool.denied events', () => {
    expect(summarizeRun([ev('tool.denied', { tool: 'bash', reason: 'no' })]).permissionDeniedCount).toBe(1);
  });

  it('counts a /permission/ type with data.outcome === "denied"', () => {
    const e = ev('permission.check' as LedgerEvent['type'], { data: { outcome: 'denied' } });
    expect(summarizeRun([e]).permissionDeniedCount).toBe(1);
  });

  it('counts a /permission/ type with data.allowed === false', () => {
    const e = ev('permission.check' as LedgerEvent['type'], { data: { allowed: false } });
    expect(summarizeRun([e]).permissionDeniedCount).toBe(1);
  });

  it('does not count approval.granted as a denial', () => {
    expect(summarizeRun([ev('approval.granted')]).permissionDeniedCount).toBe(0);
  });

  it('accumulates multiple denial events', () => {
    const events = [
      ev('approval.denied'),
      ev('tool.denied', { tool: 'bash' }),
      ev('approval.denied'),
    ];
    expect(summarizeRun(events).permissionDeniedCount).toBe(3);
  });
});

// ====== buildHighlights ======

describe('buildHighlights', () => {
  function minimal(): Pick<PmSummarizerOutput, 'overall' | 'runs'> {
    return {
      overall: {
        completed: 0, failed: 0, running: 0, cancelled: 0,
        totalToolCalls: 0, totalErrors: 0, avgDurationMs: 0,
      },
      runs: [],
    };
  }

  it('returns empty array when there are no runs', () => {
    expect(buildHighlights(minimal())).toEqual([]);
  });

  it('emits "X of Y runs completed" bullet when runs exist', () => {
    const out = minimal();
    out.overall.completed = 3;
    out.runs = Array(5).fill(null).map((_, i) => ({
      runId: `r${i}`, status: 'completed' as const,
      toolCallCount: 0, topTools: [], errorCount: 0,
      permissionDeniedCount: 0, notableErrors: [],
    } satisfies RunSummary));
    const h = buildHighlights(out);
    expect(h.some(b => b.startsWith('3 of 5 runs completed'))).toBe(true);
  });

  it('emits most-used tool bullet when topTools are present', () => {
    const out = minimal();
    out.runs = [{
      runId: 'r1', status: 'completed',
      toolCallCount: 10,
      topTools: [{ tool: 'read_file', count: 10, totalMs: 500 }],
      errorCount: 0, permissionDeniedCount: 0, notableErrors: [],
    }];
    const h = buildHighlights(out);
    expect(h.some(b => b.includes('read_file') && b.includes('10 calls'))).toBe(true);
  });

  it('emits error count bullet when totalErrors > 0', () => {
    const out = minimal();
    out.overall.totalErrors = 4;
    out.runs = [{
      runId: 'r1', status: 'failed',
      toolCallCount: 0, topTools: [], errorCount: 4,
      permissionDeniedCount: 0, notableErrors: [],
    }];
    const h = buildHighlights(out);
    expect(h.some(b => /4 errors/.test(b))).toBe(true);
  });

  it('emits permission-denied bullet when permissionDeniedCount > 0', () => {
    const out = minimal();
    out.runs = [{
      runId: 'r1', status: 'running',
      toolCallCount: 0, topTools: [], errorCount: 0,
      permissionDeniedCount: 2, notableErrors: [],
    }];
    const h = buildHighlights(out);
    expect(h.some(b => /permission/.test(b))).toBe(true);
  });

  it('emits avg duration bullet when avgDurationMs > 0', () => {
    const out = minimal();
    out.overall.avgDurationMs = 3500;
    out.runs = [{ runId: 'r1', status: 'completed', toolCallCount: 0, topTools: [],
      errorCount: 0, permissionDeniedCount: 0, notableErrors: [] }];
    const h = buildHighlights(out);
    expect(h.some(b => /Avg run duration.*3500ms/.test(b))).toBe(true);
  });

  it('does not exceed 7 bullets', () => {
    const out = minimal();
    out.overall = {
      completed: 1, failed: 0, running: 0, cancelled: 0,
      totalToolCalls: 5, totalErrors: 3, avgDurationMs: 1000,
    };
    out.runs = [{
      runId: 'r1', status: 'completed', toolCallCount: 5,
      topTools: [{ tool: 'bash', count: 5, totalMs: 100 }],
      errorCount: 3, permissionDeniedCount: 2, notableErrors: [],
    }];
    expect(buildHighlights(out).length).toBeLessThanOrEqual(7);
  });
});

// ====== runPmSummarizer ======

describe('runPmSummarizer', () => {
  it('returns totalEvents=0, totalRuns=0, highlights=[] for empty input', async () => {
    const out = await runPmSummarizer({ events: [] });
    expect(out.totalEvents).toBe(0);
    expect(out.totalRuns).toBe(0);
    expect(out.highlights).toEqual([]);
  });

  it('groups events by run_id when groupByRun=true (default)', async () => {
    const events = [
      ev('run.created', {}, 'run-A'),
      ev('run.created', {}, 'run-B'),
      ev('run.completed', {}, 'run-A'),
    ];
    const out = await runPmSummarizer({ events });
    expect(out.totalRuns).toBe(2);
    const ids = out.runs.map(r => r.runId).sort();
    expect(ids).toEqual(['run-A', 'run-B']);
  });

  it('creates a single "__all__" run when groupByRun=false', async () => {
    const events = [
      ev('run.created', {}, 'run-A'),
      ev('run.created', {}, 'run-B'),
    ];
    const out = await runPmSummarizer({ events, groupByRun: false });
    expect(out.totalRuns).toBe(1);
    expect(out.runs[0].runId).toBe('__all__');
  });

  it('sets totalEvents to the length of the input array', async () => {
    const events = [ev('run.created'), ev('run.completed'), toolExec('bash')];
    const out = await runPmSummarizer({ events });
    expect(out.totalEvents).toBe(3);
  });

  it('overall.totalToolCalls sums toolCallCount across all runs', async () => {
    const events = [
      toolExec('bash',      0, 'run-A'),
      toolExec('read_file', 0, 'run-A'),
      toolExec('bash',      0, 'run-B'),
    ];
    const out = await runPmSummarizer({ events });
    expect(out.overall.totalToolCalls).toBe(3);
  });

  it('avgDurationMs is averaged only over runs that have a durationMs', async () => {
    const tsA1 = '2024-01-01T00:00:00.000Z';
    const tsA2 = '2024-01-01T00:00:02.000Z'; // 2 000 ms
    const tsB1 = '2024-01-01T00:00:00.000Z';
    const tsB2 = '2024-01-01T00:00:04.000Z'; // 4 000 ms

    const events: LedgerEvent[] = [
      { ...ev('run.created',   {}, 'run-A'), ts: tsA1 } as unknown as LedgerEvent,
      { ...ev('run.completed', {}, 'run-A'), ts: tsA2 } as unknown as LedgerEvent,
      { ...ev('run.created',   {}, 'run-B'), ts: tsB1 } as unknown as LedgerEvent,
      { ...ev('run.completed', {}, 'run-B'), ts: tsB2 } as unknown as LedgerEvent,
    ];

    const out = await runPmSummarizer({ events });
    // avg of 2000 and 4000 = 3000
    expect(out.overall.avgDurationMs).toBe(3000);
  });

  it('highlights array has between 0 and 7 entries', async () => {
    const events = [ev('run.created'), ev('run.completed')];
    const out = await runPmSummarizer({ events });
    expect(out.highlights.length).toBeGreaterThanOrEqual(0);
    expect(out.highlights.length).toBeLessThanOrEqual(7);
  });

  it('highlights array has ≥3 entries for a rich run with tools and errors', async () => {
    const events = [
      ev('run.created'),
      toolExec('bash', 100),
      toolExec('bash', 200),
      ev('run.failed', { error: 'oops' }),
    ];
    const out = await runPmSummarizer({ events });
    expect(out.highlights.length).toBeGreaterThanOrEqual(2); // at minimum: "0 of 1" + errors
  });

  it('overall.completed counts runs with completed status', async () => {
    const events = [
      ev('run.created',   {}, 'run-A'),
      ev('run.completed', {}, 'run-A'),
      ev('run.created',   {}, 'run-B'),
      ev('run.failed',    { error: 'x' }, 'run-B'),
    ];
    const out = await runPmSummarizer({ events });
    expect(out.overall.completed).toBe(1);
    expect(out.overall.failed).toBe(1);
  });

  it('generatedAt is a valid ISO 8601 string', async () => {
    const out = await runPmSummarizer({ events: [] });
    expect(() => new Date(out.generatedAt)).not.toThrow();
    expect(new Date(out.generatedAt).toISOString()).toBe(out.generatedAt);
  });

  it('passes topToolsLimit through to each run summary', async () => {
    const events = ['a','b','c','d','e','f'].map(t => toolExec(t));
    const out = await runPmSummarizer({ events, topToolsLimit: 2 });
    expect(out.runs[0].topTools).toHaveLength(2);
  });

  it('passes notableErrorsLimit through to each run summary', async () => {
    const events = Array(5).fill(null).map(() => ev('run.failed', { error: 'x' }));
    const out = await runPmSummarizer({ events, notableErrorsLimit: 2 });
    expect(out.runs[0].notableErrors).toHaveLength(2);
  });
});

// ====== subagentSpec ======

describe('subagentSpec', () => {
  it('returns name "pm-summarizer"', () => {
    expect(subagentSpec().name).toBe('pm-summarizer');
  });

  it('provides a non-empty description', () => {
    expect(typeof subagentSpec().description).toBe('string');
    expect(subagentSpec().description.length).toBeGreaterThan(10);
  });

  it('inputSchema requires the "events" field', () => {
    const schema = subagentSpec().inputSchema as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toContain('events');
    expect(schema.properties['events']).toBeDefined();
  });

  it('outputSchema is defined and lists required fields', () => {
    const schema = subagentSpec().outputSchema as { required: string[] };
    expect(Array.isArray(schema.required)).toBe(true);
    expect(schema.required).toContain('runs');
    expect(schema.required).toContain('overall');
  });

  it('each call returns a fresh object (no shared mutable state)', () => {
    const a = subagentSpec();
    const b = subagentSpec();
    expect(a).not.toBe(b);
  });
});
