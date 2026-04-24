// @vitest-environment node
/**
 * integration-harness.test.ts — ≥25 integration tests for the harness.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFakeLlm,
  createFakeClock,
  createIntegrationHarness,
  snapshotHarness,
  type FakeLlmCall,
  type FakeLlm,
  type FakeClock,
  type Harness,
} from './integration-harness.js';

// ─── Cleanup registry ─────────────────────────────────────────────────────────

const harnessRegistry: Harness[] = [];
afterEach(async () => {
  for (const h of harnessRegistry.splice(0)) {
    await h.cleanup().catch(() => {/* ignore */});
  }
});

function track(h: Harness): Harness {
  harnessRegistry.push(h);
  return h;
}

// ─── FakeLlm ──────────────────────────────────────────────────────────────────

describe('FakeLlm', () => {
  it('returns responses in FIFO order', async () => {
    const llm = createFakeLlm();
    llm.enqueue({ prompt: '', response: 'first' });
    llm.enqueue({ prompt: '', response: 'second' });
    llm.enqueue({ prompt: '', response: 'third' });

    const r1 = await llm.complete('p1');
    const r2 = await llm.complete('p2');
    const r3 = await llm.complete('p3');

    expect(r1.text).toBe('first');
    expect(r2.text).toBe('second');
    expect(r3.text).toBe('third');
  });

  it('throws when complete() called with empty queue', async () => {
    const llm = createFakeLlm();
    await expect(llm.complete('oops')).rejects.toThrow('FakeLlm');
  });

  it('throws after queue is exhausted', async () => {
    const llm = createFakeLlm();
    llm.enqueue({ prompt: '', response: 'ok' });
    await llm.complete('p1');
    await expect(llm.complete('p2')).rejects.toThrow();
  });

  it('tracks call history with the actual prompt passed to complete()', async () => {
    const llm = createFakeLlm();
    llm.enqueue({ prompt: 'ignored', response: 'resp' });
    await llm.complete('actual prompt');

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].prompt).toBe('actual prompt');
    expect(llm.calls[0].response).toBe('resp');
  });

  it('preserves toolCalls in enqueued entries', async () => {
    const llm = createFakeLlm();
    const toolCalls = [{ name: 'search', args: { q: 'hello' } }];
    llm.enqueue({ prompt: '', response: 'tool result', toolCalls });
    const r = await llm.complete('p');

    expect(r.toolCalls).toEqual(toolCalls);
    expect(llm.calls[0].toolCalls).toEqual(toolCalls);
  });

  it('stats() reports totalCalls and pending correctly', async () => {
    const llm = createFakeLlm();
    llm.enqueue({ prompt: '', response: 'a' });
    llm.enqueue({ prompt: '', response: 'b' });
    expect(llm.stats()).toEqual({ totalCalls: 0, pending: 2 });

    await llm.complete('x');
    expect(llm.stats()).toEqual({ totalCalls: 1, pending: 1 });

    await llm.complete('y');
    expect(llm.stats()).toEqual({ totalCalls: 2, pending: 0 });
  });

  it('multiple enqueue/complete cycles work independently', async () => {
    const llm = createFakeLlm();
    for (let i = 0; i < 5; i++) {
      llm.enqueue({ prompt: '', response: `r${i}` });
    }
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await llm.complete(`p${i}`);
      results.push(r.text);
    }
    expect(results).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });
});

// ─── FakeClock ────────────────────────────────────────────────────────────────

describe('FakeClock', () => {
  it('now() starts at 0 by default', () => {
    const clock = createFakeClock();
    expect(clock.now()).toBe(0);
  });

  it('now() respects custom start value', () => {
    const clock = createFakeClock(1000);
    expect(clock.now()).toBe(1000);
  });

  it('advance() increments time correctly', () => {
    const clock = createFakeClock();
    clock.advance(500);
    expect(clock.now()).toBe(500);
    clock.advance(200);
    expect(clock.now()).toBe(700);
  });

  it('setTimeout fires callback when advance crosses deadline', () => {
    const clock = createFakeClock();
    let fired = false;
    clock.setTimeout(() => { fired = true; }, 100);

    clock.advance(50);
    expect(fired).toBe(false);

    clock.advance(50); // total = 100, exactly at deadline
    expect(fired).toBe(true);
  });

  it('setTimeout fires on the exact millisecond of the deadline', () => {
    const clock = createFakeClock(0);
    let count = 0;
    clock.setTimeout(() => { count++; }, 0);
    clock.advance(0);
    expect(count).toBe(1);
  });

  it('fires multiple timers in deadline order', () => {
    const clock = createFakeClock();
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('b'), 200);
    clock.setTimeout(() => fired.push('a'), 100);
    clock.setTimeout(() => fired.push('c'), 300);

    clock.advance(300);
    expect(fired).toEqual(['a', 'b', 'c']);
  });

  it('clearTimeout cancels a pending timer', () => {
    const clock = createFakeClock();
    let fired = false;
    const id = clock.setTimeout(() => { fired = true; }, 100);
    clock.clearTimeout(id);
    clock.advance(200);
    expect(fired).toBe(false);
  });

  it('clearTimeout on unknown id is a no-op', () => {
    const clock = createFakeClock();
    expect(() => clock.clearTimeout(999)).not.toThrow();
  });

  it('only fires timers up to the advanced point', () => {
    const clock = createFakeClock();
    const fired: number[] = [];
    clock.setTimeout(() => fired.push(1), 100);
    clock.setTimeout(() => fired.push(2), 200);
    clock.setTimeout(() => fired.push(3), 300);

    clock.advance(150);
    expect(fired).toEqual([1]);

    clock.advance(100); // now at 250
    expect(fired).toEqual([1, 2]);
  });

  it('advance throws on negative value', () => {
    const clock = createFakeClock();
    expect(() => clock.advance(-1)).toThrow();
  });
});

// ─── createIntegrationHarness ────────────────────────────────────────────────

describe('createIntegrationHarness', () => {
  it('returns empty modules object when no modules requested', async () => {
    const h = track(await createIntegrationHarness());
    expect(Object.keys(h.modules)).toHaveLength(0);
  });

  it('provides a FakeLlm on h.llm', async () => {
    const h = track(await createIntegrationHarness());
    expect(typeof h.llm.enqueue).toBe('function');
    expect(typeof h.llm.complete).toBe('function');
    expect(Array.isArray(h.llm.calls)).toBe(true);
  });

  it('provides a FakeClock on h.clock', async () => {
    const h = track(await createIntegrationHarness());
    expect(typeof h.clock.now).toBe('function');
    expect(typeof h.clock.advance).toBe('function');
    expect(h.clock.now()).toBe(0);
  });

  it('tmpDir exists after creation', async () => {
    const h = track(await createIntegrationHarness());
    expect(existsSync(h.tmpDir)).toBe(true);
  });

  it('cleanup() removes tmpDir', async () => {
    const h = await createIntegrationHarness();
    const { tmpDir } = h;
    await h.cleanup();
    expect(existsSync(tmpDir)).toBe(false);
  });

  it('cleanup() is idempotent — second call does not throw', async () => {
    const h = await createIntegrationHarness();
    await h.cleanup();
    await expect(h.cleanup()).resolves.not.toThrow();
  });

  it('loads memory-wiki without error', async () => {
    const h = track(await createIntegrationHarness({ modules: ['memory-wiki'] }));
    expect(h.modules['memory-wiki']).toBeDefined();
    expect(typeof h.modules['memory-wiki'].upsert).toBe('function');
  });

  it('memory-wiki persists to tmpDir (file written after flush)', async () => {
    const h = track(await createIntegrationHarness({ modules: ['memory-wiki'] }));
    const wiki = h.modules['memory-wiki'];
    wiki.upsert({ title: 'Test Page', body: 'hello world' });
    await wiki.flush();
    expect(existsSync(join(h.tmpDir, 'memory-wiki.json'))).toBe(true);
  });

  it('loads skill-effectiveness without error', async () => {
    const h = track(await createIntegrationHarness({ modules: ['skill-effectiveness'] }));
    const tracker = h.modules['skill-effectiveness'];
    expect(tracker).toBeDefined();
    expect(typeof tracker.recordOutcome).toBe('function');
  });

  it('loads runtime-profiler without error', async () => {
    const h = track(await createIntegrationHarness({ modules: ['runtime-profiler'] }));
    const profiler = h.modules['runtime-profiler'];
    expect(profiler).toBeDefined();
    expect(typeof profiler.start).toBe('function');
  });

  it('loads cron-persistence without error', async () => {
    const h = track(await createIntegrationHarness({ modules: ['cron-persistence'] }));
    const store = h.modules['cron-persistence'];
    expect(store).toBeDefined();
    expect(typeof store.upsert).toBe('function');
  });

  it('loads guardrails without error', async () => {
    const h = track(await createIntegrationHarness({ modules: ['guardrails'] }));
    const gr = h.modules['guardrails'];
    expect(gr).toBeDefined();
    expect(typeof gr.evaluate).toBe('function');
  });

  it('loads cost-aware-dag without error', async () => {
    const h = track(await createIntegrationHarness({ modules: ['cost-aware-dag'] }));
    const planner = h.modules['cost-aware-dag'];
    expect(planner).toBeDefined();
    expect(typeof planner.plan).toBe('function');
  });

  it('loads all supported modules together', async () => {
    const h = track(await createIntegrationHarness({
      modules: [
        'memory-wiki',
        'skill-effectiveness',
        'runtime-profiler',
        'cron-persistence',
        'guardrails',
        'cost-aware-dag',
      ],
    }));
    expect(Object.keys(h.modules)).toHaveLength(6);
  });

  it('concurrent createIntegrationHarness calls produce independent tmpDirs', async () => {
    const [h1, h2, h3] = await Promise.all([
      createIntegrationHarness(),
      createIntegrationHarness(),
      createIntegrationHarness(),
    ]);
    track(h1); track(h2); track(h3);

    expect(h1.tmpDir).not.toBe(h2.tmpDir);
    expect(h2.tmpDir).not.toBe(h3.tmpDir);
    expect(h1.tmpDir).not.toBe(h3.tmpDir);

    // All exist independently
    expect(existsSync(h1.tmpDir)).toBe(true);
    expect(existsSync(h2.tmpDir)).toBe(true);
    expect(existsSync(h3.tmpDir)).toBe(true);
  });

  it('concurrent harnesses have independent FakeLlm queues', async () => {
    const h1 = track(await createIntegrationHarness());
    const h2 = track(await createIntegrationHarness());

    h1.llm.enqueue({ prompt: '', response: 'from-h1' });
    h2.llm.enqueue({ prompt: '', response: 'from-h2' });

    const r1 = await h1.llm.complete('p');
    const r2 = await h2.llm.complete('p');

    expect(r1.text).toBe('from-h1');
    expect(r2.text).toBe('from-h2');
  });

  it('concurrent harnesses have independent FakeClocks', async () => {
    const h1 = track(await createIntegrationHarness());
    const h2 = track(await createIntegrationHarness());

    h1.clock.advance(1000);
    expect(h1.clock.now()).toBe(1000);
    expect(h2.clock.now()).toBe(0);
  });
});

// ─── snapshotHarness ──────────────────────────────────────────────────────────

describe('snapshotHarness', () => {
  it('returns llmStats, moduleNames and tmpDir', async () => {
    const h = track(await createIntegrationHarness({ modules: ['memory-wiki'] }));
    h.llm.enqueue({ prompt: '', response: 'ok' });
    await h.llm.complete('x');

    const snap = snapshotHarness(h);
    expect(snap.llmStats).toEqual({ totalCalls: 1, pending: 0 });
    expect(snap.moduleNames).toContain('memory-wiki');
    expect(snap.tmpDir).toBe(h.tmpDir);
  });

  it('snapshot of empty harness has empty moduleNames', async () => {
    const h = track(await createIntegrationHarness());
    const snap = snapshotHarness(h);
    expect(snap.moduleNames).toHaveLength(0);
    expect(snap.llmStats.totalCalls).toBe(0);
    expect(snap.llmStats.pending).toBe(0);
  });

  it('snapshot does not mutate the harness', async () => {
    const h = track(await createIntegrationHarness());
    snapshotHarness(h);
    snapshotHarness(h); // second call is safe
    expect(h.llm.stats().totalCalls).toBe(0);
  });
});
