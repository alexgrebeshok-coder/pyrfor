// @vitest-environment node
/**
 * skill-tracker.test.ts — tests for SkillTracker
 *
 * Uses real SkillSynthesizer instances pointing at per-test temporary
 * directories (relative to this file, not /tmp).  The mock LLM is never
 * called; skills are seeded directly via synth.save().
 */

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import path from 'path';

import { SkillTracker, defaultWeightFn } from './skill-tracker.js';
import { SkillSynthesizer } from './skill-synth.js';
import type { Skill } from './skill-synth.js';

// ── Temp-dir helpers ──────────────────────────────────────────────────────────

const TMP_BASE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__skill_tracker_test_tmp__',
);

const _tmpDirs: string[] = [];

async function makeTempDir(prefix = 'st-'): Promise<string> {
  await fsp.mkdir(TMP_BASE, { recursive: true });
  const unique = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dir = path.join(TMP_BASE, unique);
  await fsp.mkdir(dir, { recursive: true });
  _tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of _tmpDirs.splice(0)) {
    await fsp.rm(d, { recursive: true, force: true }).catch(() => undefined);
  }
  await fsp.rm(TMP_BASE, { recursive: true, force: true }).catch(() => undefined);
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockLlm = { async chat() { return '{}'; } };

function makeSynth(baseDir: string): SkillSynthesizer {
  return new SkillSynthesizer({ baseDir, enabled: false, llm: mockLlm });
}

function makeSkill(
  slug: string,
  overrides: Partial<Skill['frontmatter']> = {},
): Skill {
  const now = new Date().toISOString();
  return {
    frontmatter: {
      name: slug,
      title: `Skill ${slug}`,
      category: 'general',
      when_to_use: 'Use in tests.',
      inputs: ['text'],
      outputs: ['result'],
      source: 'manual',
      status: 'approved',
      weight: 0.5,
      applied_count: 0,
      success_count: 0,
      failure_count: 0,
      created_at: now,
      updated_at: now,
      ...overrides,
    },
    body: '## Steps\n\n1. Do the thing.\n\nThis is a test skill body.',
    filePath: '',
  };
}

/** Create a fresh tracker + synth pair, optionally pre-seeding skills. */
async function setup(opts?: {
  skills?: Array<[string, Partial<Skill['frontmatter']>]>;
  trackerOpts?: Partial<ConstructorParameters<typeof SkillTracker>[0]>;
}): Promise<{ tracker: SkillTracker; synth: SkillSynthesizer; invDir: string }> {
  const synthDir = await makeTempDir('synth-');
  const invDir = await makeTempDir('inv-');
  const synth = makeSynth(synthDir);

  for (const [slug, fm] of opts?.skills ?? []) {
    await synth.save(makeSkill(slug, fm));
  }

  const tracker = new SkillTracker({
    baseDir: invDir,
    synth,
    ...opts?.trackerOpts,
  });

  return { tracker, synth, invDir };
}

// ── Helper to write a past-dated JSONL file directly ─────────────────────────

async function writePastJsonl(
  invDir: string,
  dateStr: string, // YYYY-MM-DD
  invocations: Array<Partial<Skill['frontmatter']> & {
    skillSlug: string;
    success?: boolean;
  }>,
): Promise<void> {
  await fsp.mkdir(invDir, { recursive: true });
  const lines = invocations.map((inv) =>
    JSON.stringify({
      skillSlug: inv.skillSlug,
      sessionId: 'sess-test',
      trajectoryId: 'traj-test',
      startedAt: `${dateStr}T10:00:00.000Z`,
      finishedAt: `${dateStr}T10:00:01.000Z`,
      success: inv.success ?? true,
      durationMs: 1000,
    }),
  );
  await fsp.writeFile(path.join(invDir, `${dateStr}.jsonl`), lines.join('\n') + '\n', 'utf8');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('beginInvocation', () => {
  it('returns a non-empty ULID-like id', async () => {
    const { tracker, synth } = await setup({ skills: [['alpha', {}]] });
    await synth.save(makeSkill('alpha'));
    const id = await tracker.beginInvocation({
      skillSlug: 'alpha',
      sessionId: 'sess-1',
      trajectoryId: 'traj-1',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(10);
  });

  it('stores skillSlug / sessionId / trajectoryId in memory', async () => {
    const { tracker } = await setup({ skills: [['beta', {}]] });
    const id = await tracker.beginInvocation({
      skillSlug: 'beta',
      sessionId: 's-42',
      trajectoryId: 't-99',
    });
    // Access internal _pending map via cast to verify in-memory state
    const pending = (tracker as unknown as { _pending: Map<string, { skillSlug: string; sessionId: string; trajectoryId: string }> })._pending;
    expect(pending.has(id)).toBe(true);
    expect(pending.get(id)?.skillSlug).toBe('beta');
    expect(pending.get(id)?.sessionId).toBe('s-42');
    expect(pending.get(id)?.trajectoryId).toBe('t-99');
  });
});

describe('endInvocation', () => {
  it('writes a well-formed JSONL line to today\'s file', async () => {
    const { tracker, invDir } = await setup({ skills: [['my-skill', {}]] });

    const id = await tracker.beginInvocation({ skillSlug: 'my-skill', sessionId: 's1', trajectoryId: 't1' });
    await tracker.endInvocation(id, { success: true });

    const today = new Date().toISOString().slice(0, 10);
    const content = await fsp.readFile(path.join(invDir, `${today}.jsonl`), 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.skillSlug).toBe('my-skill');
    expect(parsed.success).toBe(true);
    expect(typeof parsed.startedAt).toBe('string');
    expect(typeof parsed.finishedAt).toBe('string');
    expect(typeof parsed.durationMs).toBe('number');
  });

  it('calls synth.recordUsage with success=true', async () => {
    const { tracker, synth } = await setup({ skills: [['rec-skill', {}]] });

    const id = await tracker.beginInvocation({ skillSlug: 'rec-skill', sessionId: 's', trajectoryId: 't' });
    await tracker.endInvocation(id, { success: true });

    const skill = await synth.load('rec-skill');
    expect(skill?.frontmatter.applied_count).toBe(1);
    expect(skill?.frontmatter.success_count).toBe(1);
    expect(skill?.frontmatter.failure_count).toBe(0);
  });

  it('calls synth.recordUsage with success=false', async () => {
    const { tracker, synth } = await setup({ skills: [['fail-skill', {}]] });

    const id = await tracker.beginInvocation({ skillSlug: 'fail-skill', sessionId: 's', trajectoryId: 't' });
    await tracker.endInvocation(id, { success: false, errorMessage: 'boom' });

    const skill = await synth.load('fail-skill');
    expect(skill?.frontmatter.failure_count).toBe(1);
    expect(skill?.frontmatter.success_count).toBe(0);
  });

  it('unknown id → warns and does NOT throw', async () => {
    const { tracker } = await setup();
    await expect(tracker.endInvocation('nonexistent-id', { success: true })).resolves.toBeUndefined();
  });

  it('removes the in-flight record from memory after completion', async () => {
    const { tracker } = await setup({ skills: [['cleanup', {}]] });
    const id = await tracker.beginInvocation({ skillSlug: 'cleanup', sessionId: 's', trajectoryId: 't' });

    const pending = (tracker as unknown as { _pending: Map<string, unknown> })._pending;
    expect(pending.has(id)).toBe(true);

    await tracker.endInvocation(id, { success: true });
    expect(pending.has(id)).toBe(false);
  });
});

describe('listInvocations', () => {
  it('returns all invocations when no filter provided', async () => {
    const { tracker } = await setup({ skills: [['s1', {}], ['s2', {}]] });

    const i1 = await tracker.beginInvocation({ skillSlug: 's1', sessionId: 'x', trajectoryId: 'y' });
    await tracker.endInvocation(i1, { success: true });
    const i2 = await tracker.beginInvocation({ skillSlug: 's2', sessionId: 'x', trajectoryId: 'y' });
    await tracker.endInvocation(i2, { success: false });

    const all = await tracker.listInvocations();
    expect(all).toHaveLength(2);
  });

  it('filters by slug', async () => {
    const { tracker } = await setup({ skills: [['aa', {}], ['bb', {}]] });

    for (const slug of ['aa', 'bb', 'aa']) {
      const id = await tracker.beginInvocation({ skillSlug: slug, sessionId: 's', trajectoryId: 't' });
      await tracker.endInvocation(id, { success: true });
    }

    const filtered = await tracker.listInvocations({ slug: 'aa' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((i) => i.skillSlug === 'aa')).toBe(true);
  });

  it('filters by since', async () => {
    const { tracker, invDir } = await setup({ skills: [['ts', {}]] });

    // Write an old invocation directly
    await writePastJsonl(invDir, '2020-01-01', [{ skillSlug: 'ts', success: true }]);

    // Write a recent invocation via tracker
    const id = await tracker.beginInvocation({ skillSlug: 'ts', sessionId: 's', trajectoryId: 't' });
    await tracker.endInvocation(id, { success: true });

    const recent = await tracker.listInvocations({ since: new Date('2024-01-01') });
    expect(recent.length).toBeGreaterThanOrEqual(1);
    expect(recent.every((i) => new Date(i.startedAt) >= new Date('2024-01-01'))).toBe(true);
  });

  it('filters by until', async () => {
    const { tracker, invDir } = await setup({ skills: [['tu', {}]] });

    await writePastJsonl(invDir, '2020-06-15', [{ skillSlug: 'tu', success: true }]);

    const id = await tracker.beginInvocation({ skillSlug: 'tu', sessionId: 's', trajectoryId: 't' });
    await tracker.endInvocation(id, { success: false });

    const old = await tracker.listInvocations({ until: new Date('2022-01-01') });
    expect(old.length).toBeGreaterThanOrEqual(1);
    expect(old.every((i) => new Date(i.startedAt) <= new Date('2022-01-01'))).toBe(true);
  });

  it('filters by success=false', async () => {
    const { tracker } = await setup({ skills: [['filt', {}]] });

    for (const success of [true, false, false, true]) {
      const id = await tracker.beginInvocation({ skillSlug: 'filt', sessionId: 's', trajectoryId: 't' });
      await tracker.endInvocation(id, { success });
    }

    const failures = await tracker.listInvocations({ success: false });
    expect(failures).toHaveLength(2);
    expect(failures.every((i) => i.success === false)).toBe(true);
  });

  it('respects limit', async () => {
    const { tracker } = await setup({ skills: [['lim', {}]] });

    for (let i = 0; i < 5; i++) {
      const id = await tracker.beginInvocation({ skillSlug: 'lim', sessionId: 's', trajectoryId: 't' });
      await tracker.endInvocation(id, { success: true });
    }

    const limited = await tracker.listInvocations({ limit: 2 });
    expect(limited).toHaveLength(2);
  });
});

describe('recompute', () => {
  it('returns empty result when no skills exist', async () => {
    const { tracker } = await setup();
    const result = await tracker.recompute();
    expect(result).toEqual({ updated: 0, archived: 0, stats: [] });
  });

  it('updates weight when drift >= 0.05', async () => {
    // applied=20, success=18 → defaultWeightFn ≈ 0.615, drift from 0.5 > 0.05
    const { tracker, synth } = await setup({
      skills: [['heavy', { applied_count: 20, success_count: 18, failure_count: 2, weight: 0.5 }]],
    });

    const { updated, stats } = await tracker.recompute();
    expect(updated).toBe(1);
    const s = stats.find((x) => x.slug === 'heavy');
    expect(s?.weight).toBeCloseTo(defaultWeightFn({ applied_count: 20, success_count: 18, failure_count: 2 }), 5);

    // Verify the file was actually updated
    const reloaded = await synth.load('heavy');
    expect(reloaded?.frontmatter.weight).toBeCloseTo(s!.weight, 5);
  });

  it('does NOT update weight when drift < 0.05', async () => {
    // applied=0 → defaultWeightFn = 0.5 = current weight; drift = 0 < 0.05
    const { tracker, synth } = await setup({
      skills: [['neutral', { applied_count: 0, weight: 0.5 }]],
    });

    const { updated } = await tracker.recompute();
    expect(updated).toBe(0);

    const skill = await synth.load('neutral');
    expect(skill?.frontmatter.weight).toBe(0.5); // unchanged
  });

  it('auto-archives skill below threshold with enough samples', async () => {
    // successRate = 1/15 ≈ 0.067 < 0.2 threshold, applied >= 10 minSamples
    const { tracker, synth } = await setup({
      skills: [['bad', { applied_count: 15, success_count: 1, failure_count: 14 }]],
      trackerOpts: { autoArchiveThreshold: 0.2, minSamples: 10 },
    });

    const { archived, stats } = await tracker.recompute();
    expect(archived).toBe(1);

    const s = stats.find((x) => x.slug === 'bad');
    expect(s?.status).toBe('archived');

    const reloaded = await synth.load('bad');
    expect(reloaded?.frontmatter.status).toBe('archived');
  });

  it('does NOT auto-archive when applied_count < minSamples', async () => {
    // successRate is terrible but only 5 samples < minSamples=10
    const { tracker, synth } = await setup({
      skills: [['few', { applied_count: 5, success_count: 0, failure_count: 5 }]],
      trackerOpts: { autoArchiveThreshold: 0.2, minSamples: 10 },
    });

    const { archived } = await tracker.recompute();
    expect(archived).toBe(0);

    const skill = await synth.load('few');
    expect(skill?.frontmatter.status).toBe('approved');
  });

  it('skips already-archived skills from weight update and archive count', async () => {
    const { tracker, synth } = await setup({
      skills: [['already', {
        applied_count: 20, success_count: 1, failure_count: 19,
        status: 'archived', weight: 0.1,
      }]],
    });

    const { updated, archived } = await tracker.recompute();
    expect(updated).toBe(0);
    expect(archived).toBe(0);

    // Confirm file was not modified
    const skill = await synth.load('already');
    expect(skill?.frontmatter.weight).toBe(0.1);
  });

  it('uses custom weightFn when provided', async () => {
    const customFn = () => 0.99;
    const { tracker } = await setup({
      skills: [['custom', { applied_count: 5, success_count: 5, weight: 0.5 }]],
      trackerOpts: { weightFn: customFn },
    });

    const { stats, updated } = await tracker.recompute();
    const s = stats.find((x) => x.slug === 'custom');
    expect(s?.weight).toBe(0.99);
    expect(updated).toBe(1);
  });
});

describe('getStats', () => {
  it('returns null for unknown slug', async () => {
    const { tracker } = await setup();
    expect(await tracker.getStats('does-not-exist')).toBeNull();
  });

  it('returns correct stats including recentFailureStreak', async () => {
    const { tracker, invDir } = await setup({
      skills: [['qs', { applied_count: 5, success_count: 3, failure_count: 2, weight: 0.6 }]],
    });

    // Write 3 consecutive failures as the most recent invocations
    await writePastJsonl(invDir, '2024-06-01', [
      { skillSlug: 'qs', success: true },
      { skillSlug: 'qs', success: false },
      { skillSlug: 'qs', success: false },
      { skillSlug: 'qs', success: false },
    ]);

    const stats = await tracker.getStats('qs');
    expect(stats).not.toBeNull();
    expect(stats!.slug).toBe('qs');
    expect(stats!.applied_count).toBe(5);
    expect(stats!.successRate).toBeCloseTo(3 / 5, 5);
    expect(stats!.recentFailureStreak).toBe(3);
  });
});

describe('listStats', () => {
  it('returns stats sorted by weight descending', async () => {
    const { tracker } = await setup({
      skills: [
        ['low',  { weight: 0.1 }],
        ['high', { weight: 0.9 }],
        ['mid',  { weight: 0.5 }],
      ],
    });

    const stats = await tracker.listStats();
    expect(stats.map((s) => s.slug)).toEqual(['high', 'mid', 'low']);
  });

  it('returns empty array when no skills exist', async () => {
    const { tracker } = await setup();
    expect(await tracker.listStats()).toEqual([]);
  });
});

describe('recentFailureStreak', () => {
  it('resets to 0 after a success', async () => {
    const { tracker, invDir } = await setup({ skills: [['streak', {}]] });

    await writePastJsonl(invDir, '2024-05-01', [
      { skillSlug: 'streak', success: false },
      { skillSlug: 'streak', success: false },
      { skillSlug: 'streak', success: true },  // breaks streak
    ]);

    const stats = await tracker.getStats('streak');
    expect(stats!.recentFailureStreak).toBe(0);
  });

  it('counts consecutive failures from the end', async () => {
    const { tracker, invDir } = await setup({ skills: [['cs', {}]] });

    await writePastJsonl(invDir, '2024-05-02', [
      { skillSlug: 'cs', success: true },
      { skillSlug: 'cs', success: false },
      { skillSlug: 'cs', success: false },
    ]);

    const stats = await tracker.getStats('cs');
    expect(stats!.recentFailureStreak).toBe(2);
  });
});

describe('pruneOld', () => {
  it('deletes files older than N days and keeps recent files', async () => {
    const { tracker, invDir } = await setup({ skills: [['p', {}]] });

    await writePastJsonl(invDir, '2020-01-01', [{ skillSlug: 'p' }]);
    await writePastJsonl(invDir, '2020-06-15', [{ skillSlug: 'p' }]);

    const id = await tracker.beginInvocation({ skillSlug: 'p', sessionId: 's', trajectoryId: 't' });
    await tracker.endInvocation(id, { success: true }); // creates today's file

    const removed = await tracker.pruneOld(30); // 30 day cutoff
    expect(removed).toBe(2); // both old files removed

    const remaining = await fsp.readdir(invDir);
    const jsonlFiles = remaining.filter((f) => f.endsWith('.jsonl'));
    expect(jsonlFiles).toHaveLength(1); // only today's file survives
  });

  it('ignores non-.jsonl files and non-date filenames', async () => {
    const { tracker, invDir } = await setup();
    await fsp.mkdir(invDir, { recursive: true });
    await fsp.writeFile(path.join(invDir, 'readme.txt'), 'hello', 'utf8');
    await fsp.writeFile(path.join(invDir, 'not-a-date.jsonl'), '', 'utf8');

    const removed = await tracker.pruneOld(0); // prune everything
    expect(removed).toBe(0); // neither file matches pruning criteria
  });

  it('returns 0 when baseDir does not exist', async () => {
    const synthDir = await makeTempDir('synth-');
    const synth = makeSynth(synthDir);
    const tracker = new SkillTracker({ baseDir: path.join(synthDir, 'nonexistent'), synth });
    expect(await tracker.pruneOld(7)).toBe(0);
  });
});

describe('concurrent safety', () => {
  it('no interleaved writes from concurrent endInvocations on different invocations', async () => {
    const { tracker } = await setup({ skills: [['conc', {}]] });

    // Begin 10 invocations simultaneously, then end them concurrently
    const ids = await Promise.all(
      Array.from({ length: 10 }, () =>
        tracker.beginInvocation({ skillSlug: 'conc', sessionId: 's', trajectoryId: 't' }),
      ),
    );

    await Promise.all(ids.map((id) => tracker.endInvocation(id, { success: true })));

    const all = await tracker.listInvocations();
    expect(all).toHaveLength(10);
  });

  it('50 concurrent endInvocations produce well-formed JSONL', async () => {
    const { tracker, invDir } = await setup({ skills: [['stress', {}]] });

    const ids = await Promise.all(
      Array.from({ length: 50 }, () =>
        tracker.beginInvocation({ skillSlug: 'stress', sessionId: 's', trajectoryId: 't' }),
      ),
    );

    await Promise.all(ids.map((id, i) => tracker.endInvocation(id, { success: i % 2 === 0 })));

    const today = new Date().toISOString().slice(0, 10);
    const content = await fsp.readFile(path.join(invDir, `${today}.jsonl`), 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(50);
    // Every line must be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe('defaultWeightFn', () => {
  it('returns 0.5 when applied_count is 0', () => {
    expect(defaultWeightFn({ applied_count: 0, success_count: 0, failure_count: 0 })).toBe(0.5);
  });

  it('returns a value in [0, 1] for arbitrary inputs', () => {
    for (const [a, s, f] of [[10, 10, 0], [10, 0, 10], [1, 1, 0], [100, 50, 50]]) {
      const w = defaultWeightFn({ applied_count: a, success_count: s, failure_count: f });
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('increases with higher successRate given same applied_count', () => {
    const high = defaultWeightFn({ applied_count: 20, success_count: 18, failure_count: 2 });
    const low = defaultWeightFn({ applied_count: 20, success_count: 2, failure_count: 18 });
    expect(high).toBeGreaterThan(low);
  });
});
