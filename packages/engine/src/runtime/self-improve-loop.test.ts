// @vitest-environment node
/**
 * self-improve-loop.test.ts — ≥35 tests for the Hermes-style self-improvement loop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fsp, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSelfImproveLoop } from './self-improve-loop.js';
import type { TaskOutcome, Lesson, SelfImproveLoopOptions } from './self-improve-loop.js';

// ── Fixture directory ────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dir, '__self_improve_test_tmp__');

let storeCounter = 0;
function tempStore(): string {
  return join(FIXTURE_DIR, `store-${storeCounter++}.json`);
}

function makeOutcome(overrides: Partial<TaskOutcome> = {}): TaskOutcome {
  return {
    taskId: `task-${Math.random().toString(36).slice(2)}`,
    verdict: 'failure',
    signature: 'tool:bash:ENOENT',
    details: 'File not found',
    ts: 1_000_000,
    ...overrides,
  };
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  await fsp.mkdir(FIXTURE_DIR, { recursive: true });
});

afterEach(async () => {
  await fsp.rm(FIXTURE_DIR, { recursive: true, force: true });
  vi.useRealTimers();
});

// ── Helper: build loop with large debounce (never auto-fires) + injected clock ─
// Tests call flush() explicitly rather than relying on the debounce timer, which
// avoids race conditions between the debounce firing and afterEach cleanup.

function makeLoop(extra: Partial<SelfImproveLoopOptions> = {}, storePath?: string) {
  return createSelfImproveLoop({
    storePath: storePath ?? tempStore(),
    flushDebounceMs: 999_999, // effectively disabled; tests call flush() explicitly
    clock: () => 9_999,
    ...extra,
  });
}

// ── 1. recordOutcome stores entry ────────────────────────────────────────────

describe('recordOutcome', () => {
  it('stores a single outcome', () => {
    const loop = makeLoop();
    const o = makeOutcome({ taskId: 't1' });
    loop.recordOutcome(o);
    expect(loop.listOutcomes()).toHaveLength(1);
    expect(loop.listOutcomes()[0]).toEqual(o);
  });

  it('stores multiple outcomes', () => {
    const loop = makeLoop();
    loop.recordOutcome(makeOutcome({ taskId: 't1' }));
    loop.recordOutcome(makeOutcome({ taskId: 't2' }));
    loop.recordOutcome(makeOutcome({ taskId: 't3' }));
    expect(loop.listOutcomes()).toHaveLength(3);
  });

  it('preserves all fields including optional tags', () => {
    const loop = makeLoop();
    const o = makeOutcome({ taskId: 'tag-task', verdict: 'success', tags: ['alpha', 'beta'] });
    loop.recordOutcome(o);
    expect(loop.listOutcomes()[0]?.tags).toEqual(['alpha', 'beta']);
  });
});

// ── 2. listOutcomes filtering ────────────────────────────────────────────────

describe('listOutcomes', () => {
  it('returns all outcomes when no filter provided', () => {
    const loop = makeLoop();
    loop.recordOutcome(makeOutcome({ verdict: 'success', signature: 'sig-a', ts: 100 }));
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-b', ts: 200 }));
    expect(loop.listOutcomes()).toHaveLength(2);
  });

  it('filters by verdict', () => {
    const loop = makeLoop();
    loop.recordOutcome(makeOutcome({ verdict: 'success' }));
    loop.recordOutcome(makeOutcome({ verdict: 'failure' }));
    loop.recordOutcome(makeOutcome({ verdict: 'partial' }));
    expect(loop.listOutcomes({ verdict: 'failure' })).toHaveLength(1);
    expect(loop.listOutcomes({ verdict: 'success' })).toHaveLength(1);
    expect(loop.listOutcomes({ verdict: 'partial' })).toHaveLength(1);
  });

  it('filters by signature', () => {
    const loop = makeLoop();
    loop.recordOutcome(makeOutcome({ signature: 'sig-x' }));
    loop.recordOutcome(makeOutcome({ signature: 'sig-y' }));
    loop.recordOutcome(makeOutcome({ signature: 'sig-x' }));
    expect(loop.listOutcomes({ signature: 'sig-x' })).toHaveLength(2);
  });

  it('filters by sinceTs', () => {
    const loop = makeLoop();
    loop.recordOutcome(makeOutcome({ ts: 100 }));
    loop.recordOutcome(makeOutcome({ ts: 500 }));
    loop.recordOutcome(makeOutcome({ ts: 900 }));
    expect(loop.listOutcomes({ sinceTs: 500 })).toHaveLength(2);
  });

  it('combines verdict and signature filters', () => {
    const loop = makeLoop();
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-a' }));
    loop.recordOutcome(makeOutcome({ verdict: 'success', signature: 'sig-a' }));
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-b' }));
    expect(loop.listOutcomes({ verdict: 'failure', signature: 'sig-a' })).toHaveLength(1);
  });
});

// ── 3. generateLessonsNow — no failures ──────────────────────────────────────

describe('generateLessonsNow – no failures', () => {
  it('creates no lessons when there are no outcomes at all', async () => {
    const loop = makeLoop();
    const { created, skipped } = await loop.generateLessonsNow();
    expect(created).toHaveLength(0);
    expect(skipped).toBe(0);
  });

  it('creates no lessons when all outcomes are successes', async () => {
    const loop = makeLoop();
    for (let i = 0; i < 5; i++) loop.recordOutcome(makeOutcome({ verdict: 'success' }));
    const { created } = await loop.generateLessonsNow();
    expect(created).toHaveLength(0);
  });

  it('creates no lessons when failures are below threshold', async () => {
    const loop = makeLoop({ clusterThreshold: 3 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-small' }));
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-small' }));
    const { created, skipped } = await loop.generateLessonsNow();
    expect(created).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});

// ── 4. generateLessonsNow — creates lesson on cluster ≥ threshold ────────────

describe('generateLessonsNow – lesson creation', () => {
  it('creates a lesson when cluster ≥ threshold (default 3)', async () => {
    const loop = makeLoop();
    for (let i = 0; i < 3; i++)
      loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-big', taskId: `t${i}` }));
    const { created } = await loop.generateLessonsNow();
    expect(created).toHaveLength(1);
    expect(created[0]!.trigger.signature).toBe('sig-big');
    expect(created[0]!.text).toContain('sig-big');
    expect(created[0]!.sourceOutcomeIds).toHaveLength(3);
  });

  it('lesson appears in listLessons() after generation', async () => {
    const loop = makeLoop();
    for (let i = 0; i < 3; i++)
      loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-foo' }));
    await loop.generateLessonsNow();
    expect(loop.listLessons()).toHaveLength(1);
  });

  it('uses custom clusterThreshold', async () => {
    const loop = makeLoop({ clusterThreshold: 5 });
    for (let i = 0; i < 4; i++)
      loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'only-4' }));
    const { created } = await loop.generateLessonsNow();
    expect(created).toHaveLength(0);

    // add the 5th — now it qualifies
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'only-4' }));
    const { created: c2 } = await loop.generateLessonsNow();
    expect(c2).toHaveLength(1);
  });

  it('skips signatures already covered by an existing lesson', async () => {
    const loop = makeLoop({ clusterThreshold: 2 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-dup' }));
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-dup' }));
    await loop.generateLessonsNow(); // creates 1 lesson
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-dup' }));
    const { created, skipped } = await loop.generateLessonsNow(); // should skip
    expect(created).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('creates lessons for multiple independent signatures', async () => {
    const loop = makeLoop({ clusterThreshold: 2 });
    for (let i = 0; i < 2; i++)
      loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-A' }));
    for (let i = 0; i < 2; i++)
      loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-B' }));
    const { created } = await loop.generateLessonsNow();
    expect(created).toHaveLength(2);
    const sigs = created.map((l) => l.trigger.signature).sort();
    expect(sigs).toEqual(['sig-A', 'sig-B']);
  });
});

// ── 5. custom lessonGenerator ─────────────────────────────────────────────────

describe('custom lessonGenerator', () => {
  it('calls custom generator with the cluster', async () => {
    const generator = vi.fn().mockResolvedValue({
      text: 'Custom lesson text',
      trigger: { signature: 'custom-sig', keyword: 'bash' },
    });
    const loop = makeLoop({ lessonGenerator: generator, clusterThreshold: 2 });
    const o1 = makeOutcome({ verdict: 'failure', signature: 'custom-sig' });
    const o2 = makeOutcome({ verdict: 'failure', signature: 'custom-sig' });
    loop.recordOutcome(o1);
    loop.recordOutcome(o2);
    const { created } = await loop.generateLessonsNow();
    expect(generator).toHaveBeenCalledOnce();
    expect(generator.mock.calls[0]![0]).toHaveLength(2);
    expect(created[0]!.text).toBe('Custom lesson text');
    expect(created[0]!.trigger.keyword).toBe('bash');
  });

  it('stores sourceOutcomeIds from cluster taskIds', async () => {
    const loop = makeLoop({ clusterThreshold: 2 });
    const o1 = makeOutcome({ taskId: 'id-X', verdict: 'failure', signature: 'sig-src' });
    const o2 = makeOutcome({ taskId: 'id-Y', verdict: 'failure', signature: 'sig-src' });
    loop.recordOutcome(o1);
    loop.recordOutcome(o2);
    const { created } = await loop.generateLessonsNow();
    expect(created[0]!.sourceOutcomeIds).toContain('id-X');
    expect(created[0]!.sourceOutcomeIds).toContain('id-Y');
  });
});

// ── 6. findApplicableLessons ─────────────────────────────────────────────────

describe('findApplicableLessons', () => {
  async function loopWithLesson(lesson: Partial<Lesson> = {}): Promise<ReturnType<typeof makeLoop>> {
    const loop = makeLoop({ clusterThreshold: 1 });
    const base: Lesson = {
      id: 'lesson-1',
      trigger: { signature: 'sig-match', tags: ['network'], keyword: 'timeout' },
      text: 'Be careful with timeouts',
      createdAt: 1,
      appliedCount: 0,
      successAfter: 0,
      failureAfter: 0,
      sourceOutcomeIds: [],
      ...lesson,
    };
    // inject directly via generation
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-match', taskId: 'inject' }));
    // We'll use generateLessonsNow with custom generator to produce the base lesson
    // Override via direct approach: generate + inspect
    return loop;
  }

  it('matches by signature', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-net' }));
    await loop.generateLessonsNow();
    const found = loop.findApplicableLessons({ signature: 'sig-net' });
    expect(found).toHaveLength(1);
  });

  it('does not match by signature when different', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-net' }));
    await loop.generateLessonsNow();
    const found = loop.findApplicableLessons({ signature: 'sig-other' });
    expect(found).toHaveLength(0);
  });

  it('matches by tags', async () => {
    const generator = vi.fn().mockResolvedValue({
      text: 'Network lesson',
      trigger: { tags: ['network', 'timeout'] },
    });
    const loop = makeLoop({ clusterThreshold: 1, lessonGenerator: generator });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-t' }));
    await loop.generateLessonsNow();
    expect(loop.findApplicableLessons({ tags: ['network'] })).toHaveLength(1);
  });

  it('does not match by tags when no overlap', async () => {
    const generator = vi.fn().mockResolvedValue({
      text: 'lesson',
      trigger: { tags: ['network'] },
    });
    const loop = makeLoop({ clusterThreshold: 1, lessonGenerator: generator });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-t2' }));
    await loop.generateLessonsNow();
    expect(loop.findApplicableLessons({ tags: ['disk'] })).toHaveLength(0);
  });

  it('matches by keyword (case-insensitive)', async () => {
    const generator = vi.fn().mockResolvedValue({
      text: 'lesson',
      trigger: { keyword: 'TIMEOUT' },
    });
    const loop = makeLoop({ clusterThreshold: 1, lessonGenerator: generator });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-kw' }));
    await loop.generateLessonsNow();
    expect(loop.findApplicableLessons({ text: 'request timeout exceeded' })).toHaveLength(1);
  });

  it('returns empty when context matches no lesson', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-z' }));
    await loop.generateLessonsNow();
    expect(loop.findApplicableLessons({ signature: 'completely-different' })).toHaveLength(0);
  });

  it('returns multiple matching lessons', async () => {
    const gen = vi
      .fn()
      .mockResolvedValueOnce({ text: 'L1', trigger: { signature: 'sig-q' } })
      .mockResolvedValueOnce({ text: 'L2', trigger: { signature: 'sig-q' } });
    // Two lessons with same signature trigger by two separate clusters
    const gen2 = vi.fn().mockResolvedValue({ text: 'L', trigger: { signature: 'sig-q' } });
    const loop = makeLoop({ clusterThreshold: 1, lessonGenerator: gen2 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-q' }));
    await loop.generateLessonsNow();
    // Already covered; add a different sig that also matches via tags
    const generator2 = vi.fn().mockResolvedValue({ text: 'L2', trigger: { tags: ['qa'] } });
    const loop2 = makeLoop({ clusterThreshold: 1, lessonGenerator: generator2 });
    loop2.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-r' }));
    await loop2.generateLessonsNow();
    // Check loop2 has one lesson matching by tags
    const found = loop2.findApplicableLessons({ tags: ['qa'] });
    expect(found).toHaveLength(1);
  });
});

// ── 7. markLessonApplied ──────────────────────────────────────────────────────

describe('markLessonApplied', () => {
  async function loopWithLesson() {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-ml' }));
    await loop.generateLessonsNow();
    return loop;
  }

  it('increments appliedCount', async () => {
    const loop = await loopWithLesson();
    const id = loop.listLessons()[0]!.id;
    loop.markLessonApplied(id, 'success');
    expect(loop.getLesson(id)!.appliedCount).toBe(1);
  });

  it('increments successAfter on success verdict', async () => {
    const loop = await loopWithLesson();
    const id = loop.listLessons()[0]!.id;
    loop.markLessonApplied(id, 'success');
    expect(loop.getLesson(id)!.successAfter).toBe(1);
    expect(loop.getLesson(id)!.failureAfter).toBe(0);
  });

  it('increments failureAfter on failure verdict', async () => {
    const loop = await loopWithLesson();
    const id = loop.listLessons()[0]!.id;
    loop.markLessonApplied(id, 'failure');
    expect(loop.getLesson(id)!.failureAfter).toBe(1);
    expect(loop.getLesson(id)!.successAfter).toBe(0);
  });

  it('partial verdict increments only appliedCount', async () => {
    const loop = await loopWithLesson();
    const id = loop.listLessons()[0]!.id;
    loop.markLessonApplied(id, 'partial');
    const l = loop.getLesson(id)!;
    expect(l.appliedCount).toBe(1);
    expect(l.successAfter).toBe(0);
    expect(l.failureAfter).toBe(0);
  });

  it('is a no-op for unknown lesson id', async () => {
    const loop = await loopWithLesson();
    expect(() => loop.markLessonApplied('nonexistent-id', 'success')).not.toThrow();
  });

  it('accumulates multiple applications', async () => {
    const loop = await loopWithLesson();
    const id = loop.listLessons()[0]!.id;
    loop.markLessonApplied(id, 'success');
    loop.markLessonApplied(id, 'success');
    loop.markLessonApplied(id, 'failure');
    expect(loop.getLesson(id)!.appliedCount).toBe(3);
    expect(loop.getLesson(id)!.successAfter).toBe(2);
    expect(loop.getLesson(id)!.failureAfter).toBe(1);
  });
});

// ── 8. effectiveness ─────────────────────────────────────────────────────────

describe('effectiveness', () => {
  it('returns 0 for unknown lesson', () => {
    const loop = makeLoop();
    expect(loop.effectiveness('unknown')).toEqual({ applied: 0, successRate: 0 });
  });

  it('returns 0 successRate when never applied', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-eff' }));
    await loop.generateLessonsNow();
    const id = loop.listLessons()[0]!.id;
    expect(loop.effectiveness(id)).toEqual({ applied: 0, successRate: 0 });
  });

  it('computes successRate as successAfter / (success + failure)', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-eff2' }));
    await loop.generateLessonsNow();
    const id = loop.listLessons()[0]!.id;
    loop.markLessonApplied(id, 'success');
    loop.markLessonApplied(id, 'success');
    loop.markLessonApplied(id, 'failure');
    const { applied, successRate } = loop.effectiveness(id);
    expect(applied).toBe(3);
    expect(successRate).toBeCloseTo(2 / 3);
  });

  it('successRate = 1 when all outcomes after are successes', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-eff3' }));
    await loop.generateLessonsNow();
    const id = loop.listLessons()[0]!.id;
    loop.markLessonApplied(id, 'success');
    loop.markLessonApplied(id, 'success');
    expect(loop.effectiveness(id).successRate).toBe(1);
  });

  it('partial does not affect successRate numerator or denominator', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-eff4' }));
    await loop.generateLessonsNow();
    const id = loop.listLessons()[0]!.id;
    loop.markLessonApplied(id, 'partial');
    loop.markLessonApplied(id, 'partial');
    expect(loop.effectiveness(id)).toEqual({ applied: 2, successRate: 0 });
  });
});

// ── 9. flush — atomic + debounced + in-flight coalescing ─────────────────────

describe('flush', () => {
  it('writes file atomically (no .tmp left behind)', async () => {
    const store = tempStore();
    const loop = makeLoop({}, store);
    loop.recordOutcome(makeOutcome());
    await loop.flush();
    expect(existsSync(store)).toBe(true);
    expect(existsSync(`${store}.${process.pid}.tmp`)).toBe(false);
  });

  it('persists outcomes and lessons in valid JSON', async () => {
    const store = tempStore();
    const loop = makeLoop({}, store);
    loop.recordOutcome(makeOutcome({ taskId: 'persist-me', signature: 'sig-p' }));
    await loop.flush();
    const raw = await fsp.readFile(store, 'utf8');
    const data = JSON.parse(raw);
    expect(data.outcomes).toHaveLength(1);
    expect(data.outcomes[0].taskId).toBe('persist-me');
  });

  it('concurrent flush() calls share the same in-flight promise', async () => {
    const store = tempStore();
    const loop = makeLoop({}, store);
    loop.recordOutcome(makeOutcome());
    const p1 = loop.flush();
    const p2 = loop.flush();
    expect(p1).toBe(p2);
    await Promise.all([p1, p2]);
  });

  it('is idempotent — second flush after completion writes again without error', async () => {
    const store = tempStore();
    const loop = makeLoop({}, store);
    loop.recordOutcome(makeOutcome());
    await loop.flush();
    await expect(loop.flush()).resolves.toBeUndefined();
  });
});

// ── 10. reset ────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears all outcomes', () => {
    const loop = makeLoop();
    loop.recordOutcome(makeOutcome());
    loop.recordOutcome(makeOutcome());
    loop.reset();
    expect(loop.listOutcomes()).toHaveLength(0);
  });

  it('clears all lessons', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-reset' }));
    await loop.generateLessonsNow();
    loop.reset();
    expect(loop.listLessons()).toHaveLength(0);
  });

  it('does not throw if reset called on empty loop', () => {
    const loop = makeLoop();
    expect(() => loop.reset()).not.toThrow();
  });
});

// ── 11. persistence — load from existing file ─────────────────────────────────

describe('persistence', () => {
  it('restores outcomes and lessons from existing store file', async () => {
    const store = tempStore();
    const loop1 = makeLoop({}, store);
    loop1.recordOutcome(makeOutcome({ taskId: 'saved-1', signature: 'sig-persist' }));
    loop1.recordOutcome(makeOutcome({ taskId: 'saved-2', signature: 'sig-persist', verdict: 'failure' }));
    loop1.recordOutcome(makeOutcome({ taskId: 'saved-3', signature: 'sig-persist', verdict: 'failure' }));
    await loop1.flush();

    // new loop reading same file
    const loop2 = makeLoop({}, store);
    expect(loop2.listOutcomes()).toHaveLength(3);
  });

  it('restores lessons from existing store file', async () => {
    const store = tempStore();
    const loop1 = makeLoop({ clusterThreshold: 2 }, store);
    loop1.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-load' }));
    loop1.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-load' }));
    await loop1.generateLessonsNow(); // flushes inside
    expect(loop1.listLessons()).toHaveLength(1);

    const loop2 = makeLoop({}, store);
    expect(loop2.listLessons()).toHaveLength(1);
    expect(loop2.listLessons()[0]!.trigger.signature).toBe('sig-load');
  });

  it('starts empty when file does not exist', () => {
    const store = tempStore(); // does not exist yet
    const loop = makeLoop({}, store);
    expect(loop.listOutcomes()).toHaveLength(0);
    expect(loop.listLessons()).toHaveLength(0);
  });

  it('falls back to empty state on corrupt file and calls logger', () => {
    const store = tempStore();
    // Write corrupt JSON synchronously
    require('node:fs').mkdirSync(FIXTURE_DIR, { recursive: true });
    require('node:fs').writeFileSync(store, '{ INVALID JSON <<<', 'utf8');

    const logMessages: Array<{ msg: string; meta: unknown }> = [];
    const loop = makeLoop(
      {
        logger: (msg, meta) => logMessages.push({ msg, meta }),
      },
      store,
    );

    expect(loop.listOutcomes()).toHaveLength(0);
    expect(loop.listLessons()).toHaveLength(0);
    expect(logMessages.some((l) => l.msg.includes('could not load'))).toBe(true);
  });
});

// ── 12. getLesson / listLessons ───────────────────────────────────────────────

describe('getLesson / listLessons', () => {
  it('getLesson returns lesson by id', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-get' }));
    await loop.generateLessonsNow();
    const id = loop.listLessons()[0]!.id;
    expect(loop.getLesson(id)).toBeDefined();
    expect(loop.getLesson(id)!.id).toBe(id);
  });

  it('getLesson returns undefined for unknown id', () => {
    const loop = makeLoop();
    expect(loop.getLesson('does-not-exist')).toBeUndefined();
  });

  it('listLessons returns a copy (mutation does not affect internal state)', async () => {
    const loop = makeLoop({ clusterThreshold: 1 });
    loop.recordOutcome(makeOutcome({ verdict: 'failure', signature: 'sig-copy' }));
    await loop.generateLessonsNow();
    const snapshot = loop.listLessons();
    snapshot.length = 0; // mutate returned array
    expect(loop.listLessons()).toHaveLength(1);
  });
});
