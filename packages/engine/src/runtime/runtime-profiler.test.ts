// @vitest-environment node
/**
 * runtime-profiler.test.ts — tests for RuntimeProfiler.
 *
 * All timing is deterministic via injected clock.
 * File-I/O tests write to __fixtures__ and clean up after themselves.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, unlink } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRuntimeProfiler, quantile } from './runtime-profiler.js';
import type { CreateRuntimeProfilerOptions } from './runtime-profiler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Clock helper ──────────────────────────────────────────────────────────────

function makeClock(startMs = 1_000_000) {
  let now = startMs;
  return {
    tick: (ms: number) => { now += ms; },
    set: (ms: number) => { now = ms; },
    fn: () => now,
  };
}

function makeProfiler(extra: Partial<CreateRuntimeProfilerOptions> = {}) {
  const clk = makeClock();
  const profiler = createRuntimeProfiler({ clock: clk.fn, ...extra });
  return { profiler, clk };
}

// ── Unique trace file path (in-project, auto-cleaned) ─────────────────────────

function traceFilePath(label: string): string {
  return path.join(
    __dirname,
    '__fixtures__',
    `profiler-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`,
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// quantile (pure function — no profiler instance needed)
// ═════════════════════════════════════════════════════════════════════════════

describe('quantile', () => {
  it('returns 0 for an empty array', () => {
    expect(quantile([], 0.5)).toBe(0);
  });

  it('returns first element for q=0', () => {
    expect(quantile([10, 20, 30, 40], 0)).toBe(10);
  });

  it('returns last element for q=1', () => {
    expect(quantile([10, 20, 30, 40], 1)).toBe(40);
  });

  it('[10,20,30,40] q=0.5 → 20 (nearest-rank)', () => {
    // ceil(0.5 * 4) - 1 = 2 - 1 = 1 → sorted[1] = 20
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(20);
  });

  it('clamps q below 0 to 0', () => {
    expect(quantile([5, 10, 15], -1)).toBe(5);
  });

  it('clamps q above 1 to 1', () => {
    expect(quantile([5, 10, 15], 99)).toBe(15);
  });

  it('works on an unsorted array', () => {
    expect(quantile([40, 10, 30, 20], 0.5)).toBe(20);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// start / end
// ═════════════════════════════════════════════════════════════════════════════

describe('start / end', () => {
  it('records a sample with positive duration', () => {
    const { profiler, clk } = makeProfiler();
    const token = profiler.start('api');
    clk.tick(150);
    token.end();

    const samples = profiler.list('api');
    expect(samples).toHaveLength(1);
    expect(samples[0].durationMs).toBe(150);
    expect(samples[0].stage).toBe('api');
  });

  it('end() returns the recorded duration', () => {
    const { profiler, clk } = makeProfiler();
    const token = profiler.start('db');
    clk.tick(42);
    const dur = token.end();
    expect(dur).toBe(42);
  });

  it('calling end() twice records two samples', () => {
    const { profiler, clk } = makeProfiler();
    const token = profiler.start('render');
    clk.tick(10);
    token.end();
    clk.tick(5);
    token.end(); // second call — measures from same t0

    const samples = profiler.list('render');
    expect(samples).toHaveLength(2);
    expect(samples[0].durationMs).toBe(10);
    expect(samples[1].durationMs).toBe(15); // clock() - t0 = 10+5
  });

  it('attaches meta from start() and extraMeta from end()', () => {
    const { profiler, clk } = makeProfiler();
    const token = profiler.start('parse', { source: 'file' });
    clk.tick(20);
    token.end({ extra: 'yes' });

    const sample = profiler.list('parse')[0];
    expect(sample.meta).toEqual({ source: 'file', extra: 'yes' });
  });

  it('omits meta field when neither start nor end provide meta', () => {
    const { profiler, clk } = makeProfiler();
    const token = profiler.start('bare');
    clk.tick(1);
    token.end();

    const sample = profiler.list('bare')[0];
    expect(sample.meta).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// record (direct API)
// ═════════════════════════════════════════════════════════════════════════════

describe('record', () => {
  it('records a sample via direct record()', () => {
    const { profiler } = makeProfiler();
    profiler.record('emit', 77);

    const samples = profiler.list('emit');
    expect(samples).toHaveLength(1);
    expect(samples[0].durationMs).toBe(77);
  });

  it('coerces negative durationMs to 0', () => {
    const { profiler } = makeProfiler();
    profiler.record('neg', -50);

    const sample = profiler.list('neg')[0];
    expect(sample.durationMs).toBe(0);
  });

  it('skips NaN durationMs and calls logger warn', () => {
    const warns: string[] = [];
    const logger = (l: string, m: string) => { if (l === 'warn') warns.push(m); };
    const { profiler } = makeProfiler({ logger: logger as CreateRuntimeProfilerOptions['logger'] });

    profiler.record('bad', NaN);

    expect(profiler.list('bad')).toHaveLength(0);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/non-finite/);
  });

  it('skips Infinity durationMs and calls logger warn', () => {
    const warns: string[] = [];
    const logger = (l: string, m: string) => { if (l === 'warn') warns.push(m); };
    const { profiler } = makeProfiler({ logger: logger as CreateRuntimeProfilerOptions['logger'] });

    profiler.record('inf', Infinity);
    profiler.record('neginf', -Infinity);

    expect(profiler.list('inf')).toHaveLength(0);
    expect(profiler.list('neginf')).toHaveLength(0);
    expect(warns).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// counters
// ═════════════════════════════════════════════════════════════════════════════

describe('counters', () => {
  it('count() with default delta=1 increments by 1', () => {
    const { profiler } = makeProfiler();
    expect(profiler.count('hits')).toBe(1);
    expect(profiler.count('hits')).toBe(2);
  });

  it('count() with custom delta increments by that amount', () => {
    const { profiler } = makeProfiler();
    expect(profiler.count('bytes', 1024)).toBe(1024);
    expect(profiler.count('bytes', 512)).toBe(1536);
  });

  it('count() with negative delta decreases the counter', () => {
    const { profiler } = makeProfiler();
    profiler.count('q', 10);
    expect(profiler.count('q', -3)).toBe(7);
  });

  it('getCount() returns 0 for an unknown counter', () => {
    const { profiler } = makeProfiler();
    expect(profiler.getCount('nope')).toBe(0);
  });

  it('resetCount(name) removes only that counter', () => {
    const { profiler } = makeProfiler();
    profiler.count('a', 5);
    profiler.count('b', 3);
    profiler.resetCount('a');

    expect(profiler.getCount('a')).toBe(0);
    expect(profiler.getCount('b')).toBe(3);
  });

  it('resetCount() with no argument clears all counters', () => {
    const { profiler } = makeProfiler();
    profiler.count('x', 9);
    profiler.count('y', 4);
    profiler.resetCount();

    expect(profiler.getCount('x')).toBe(0);
    expect(profiler.getCount('y')).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// snapshot
// ═════════════════════════════════════════════════════════════════════════════

describe('snapshot', () => {
  it('returns empty stages and correct counters when no samples exist', () => {
    const { profiler } = makeProfiler();
    profiler.count('err', 2);
    const snap = profiler.snapshot();

    expect(snap.stages).toHaveLength(0);
    expect(snap.counters).toEqual({ err: 2 });
    expect(snap.generatedAt).toBeTruthy();
  });

  it('computes mean, p50, p95, p99, max, min for one stage', () => {
    const { profiler } = makeProfiler();
    // 10 known values
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach((d) => profiler.record('op', d));

    const snap = profiler.snapshot({ windowMs: 9_999_999 });
    expect(snap.stages).toHaveLength(1);
    const s = snap.stages[0];

    expect(s.stage).toBe('op');
    expect(s.count).toBe(10);
    expect(s.totalMs).toBe(550);
    expect(s.meanMs).toBe(55);
    expect(s.minMs).toBe(10);
    expect(s.maxMs).toBe(100);
    // nearest-rank: p50 → ceil(0.5*10)-1 = 4 → sorted[4] = 50
    expect(s.p50).toBe(50);
    // p95 → ceil(0.95*10)-1 = 9 → sorted[9] = 100
    expect(s.p95).toBe(100);
    // p99 → ceil(0.99*10)-1 = 9 → sorted[9] = 100
    expect(s.p99).toBe(100);
  });

  it('filters out samples older than windowMs', () => {
    const { profiler, clk } = makeProfiler();

    // Record at t=1_000_000
    profiler.record('slow', 99);

    // Advance clock past the default window (5 min)
    clk.tick(5 * 60 * 1_000 + 1);

    // Record a fresh sample
    profiler.record('slow', 1);

    // Request a 1-second window from now
    const snap = profiler.snapshot({ windowMs: 1_000 });
    const stage = snap.stages.find((s) => s.stage === 'slow');

    // Only the new sample (durationMs=1) should appear
    expect(stage).toBeDefined();
    expect(stage!.count).toBe(1);
    expect(stage!.maxMs).toBe(1);
  });

  it('restricts snapshot to a single stage when opts.stage is given', () => {
    const { profiler } = makeProfiler();
    profiler.record('a', 10);
    profiler.record('b', 20);

    const snap = profiler.snapshot({ windowMs: 9_999_999, stage: 'a' });
    expect(snap.stages).toHaveLength(1);
    expect(snap.stages[0].stage).toBe('a');
  });

  it('returns no stages for unknown stage filter', () => {
    const { profiler } = makeProfiler();
    profiler.record('x', 5);
    const snap = profiler.snapshot({ stage: 'z' });
    expect(snap.stages).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// list
// ═════════════════════════════════════════════════════════════════════════════

describe('list', () => {
  it('returns all samples for a stage in chronological asc order', () => {
    const { profiler, clk } = makeProfiler();
    profiler.record('q', 1);
    clk.tick(10);
    profiler.record('q', 2);
    clk.tick(10);
    profiler.record('q', 3);

    const samples = profiler.list('q');
    expect(samples.map((s) => s.durationMs)).toEqual([1, 2, 3]);
  });

  it('limit returns the last N samples (most recent)', () => {
    const { profiler, clk } = makeProfiler();
    for (let i = 1; i <= 5; i++) {
      profiler.record('ev', i * 10);
      clk.tick(1);
    }

    const last3 = profiler.list('ev', { limit: 3 });
    expect(last3).toHaveLength(3);
    expect(last3.map((s) => s.durationMs)).toEqual([30, 40, 50]);
  });

  it('sinceMs filters by absolute epoch lower bound', () => {
    const { profiler, clk } = makeProfiler();
    profiler.record('r', 10); // at t=1_000_000
    clk.tick(100);
    profiler.record('r', 20); // at t=1_000_100
    clk.tick(100);
    profiler.record('r', 30); // at t=1_000_200

    // Filter: only samples at or after t=1_000_100
    const recent = profiler.list('r', { sinceMs: 1_000_100 });
    expect(recent).toHaveLength(2);
    expect(recent.map((s) => s.durationMs)).toEqual([20, 30]);
  });

  it('returns all stages when no stage arg given', () => {
    const { profiler } = makeProfiler();
    profiler.record('a', 1);
    profiler.record('b', 2);

    const all = profiler.list();
    expect(all.map((s) => s.stage).sort()).toEqual(['a', 'b']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// clear
// ═════════════════════════════════════════════════════════════════════════════

describe('clear', () => {
  it('clear(stage) removes only that stage', () => {
    const { profiler } = makeProfiler();
    profiler.record('alpha', 1);
    profiler.record('beta', 2);
    profiler.clear('alpha');

    expect(profiler.list('alpha')).toHaveLength(0);
    expect(profiler.list('beta')).toHaveLength(1);
  });

  it('clear() with no argument removes all stages but leaves counters intact', () => {
    const { profiler } = makeProfiler();
    profiler.record('x', 1);
    profiler.record('y', 2);
    profiler.count('hits', 5);
    profiler.clear();

    expect(profiler.list()).toHaveLength(0);
    expect(profiler.getCount('hits')).toBe(5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ring buffer
// ═════════════════════════════════════════════════════════════════════════════

describe('ring buffer', () => {
  it('enforces ringSize — oldest samples are dropped when cap is exceeded', () => {
    const { profiler, clk } = makeProfiler({ ringSize: 3 });

    for (let i = 1; i <= 5; i++) {
      profiler.record('ev', i * 10);
      clk.tick(1);
    }

    const samples = profiler.list('ev');
    expect(samples).toHaveLength(3);
    // oldest (10, 20) are gone; newest (30, 40, 50) remain
    expect(samples.map((s) => s.durationMs)).toEqual([30, 40, 50]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// flush — no tracePath
// ═════════════════════════════════════════════════════════════════════════════

describe('flush without tracePath', () => {
  it('flush() resolves immediately (no-op) when tracePath is not set', async () => {
    const { profiler } = makeProfiler();
    profiler.record('x', 1);
    await expect(profiler.flush()).resolves.toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// flush — with tracePath
// ═════════════════════════════════════════════════════════════════════════════

describe('flush with tracePath', () => {
  const traceFiles: string[] = [];

  afterEach(async () => {
    for (const f of traceFiles.splice(0)) {
      await unlink(f).catch(() => { /* already gone */ });
    }
  });

  it('writes JSONL lines to tracePath; each line parses as ProfilerSample', async () => {
    const tp = traceFilePath('basic');
    traceFiles.push(tp);

    const { profiler } = makeProfiler({ tracePath: tp, flushDebounceMs: 0 });
    profiler.record('stage-a', 55, { req: 'abc' });
    profiler.record('stage-b', 88);
    await profiler.flush();

    const raw = await readFile(tp, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const parsed = lines.map((l) => JSON.parse(l));
    expect(parsed[0]).toMatchObject({ stage: 'stage-a', durationMs: 55 });
    expect(parsed[1]).toMatchObject({ stage: 'stage-b', durationMs: 88 });
  });

  it('flush() is idempotent — second flush after empty queue writes nothing extra', async () => {
    const tp = traceFilePath('idempotent');
    traceFiles.push(tp);

    const { profiler } = makeProfiler({ tracePath: tp, flushDebounceMs: 0 });
    profiler.record('s', 10);
    await profiler.flush();
    // Second flush — queue is empty
    await profiler.flush();

    const raw = await readFile(tp, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('concurrent flush() calls reuse the in-flight promise (no duplicate writes)', async () => {
    const tp = traceFilePath('concurrent');
    traceFiles.push(tp);

    const { profiler } = makeProfiler({ tracePath: tp, flushDebounceMs: 0 });
    profiler.record('c', 1);
    profiler.record('c', 2);

    const p1 = profiler.flush();
    const p2 = profiler.flush();

    // Same promise object → single in-flight
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);

    const raw = await readFile(tp, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    // Two records, written exactly once
    expect(lines).toHaveLength(2);
  });

  it('debounced flush coalesces multiple records into one write', async () => {
    const tp = traceFilePath('debounce');
    traceFiles.push(tp);

    // Short real debounce: all 4 records land before it fires
    const { profiler } = makeProfiler({ tracePath: tp, flushDebounceMs: 30 });

    // Record 4 samples in quick succession — each resets the single debounce timer
    for (let i = 0; i < 4; i++) {
      profiler.record('d', i * 10);
    }

    // Wait longer than the debounce + I/O round-trip
    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    const raw = await readFile(tp, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    // Exactly 4 samples written (no duplicates from multiple timer firings)
    expect(lines).toHaveLength(4);
  });
});
