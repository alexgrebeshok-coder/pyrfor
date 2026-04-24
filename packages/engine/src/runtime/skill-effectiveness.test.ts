// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  createSkillEffectivenessTracker,
  type SkillEffectivenessTracker,
  type SkillEffectivenessRecord,
} from './skill-effectiveness.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function tmpPath(): string {
  return path.join(os.tmpdir(), `skill-eff-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function makeTracker(overrides: Parameters<typeof createSkillEffectivenessTracker>[0] = {}): SkillEffectivenessTracker {
  return createSkillEffectivenessTracker(overrides);
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('SkillEffectivenessTracker', () => {
  let filePaths: string[] = [];

  function trackedPath(): string {
    const p = tmpPath();
    filePaths.push(p);
    return p;
  }

  afterEach(() => {
    for (const p of filePaths) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
    filePaths = [];
    vi.useRealTimers();
  });

  // ── 1. recordOutcome creates record with uses=1 ───────────────────────────

  it('recordOutcome creates a new record with uses=1', () => {
    const t = makeTracker();
    const rec = t.recordOutcome({ skillId: 'a', skillName: 'Alpha', outcome: 'success', latencyMs: 100 });
    expect(rec.skillId).toBe('a');
    expect(rec.skillName).toBe('Alpha');
    expect(rec.uses).toBe(1);
    expect(rec.successes).toBe(1);
    expect(rec.failures).toBe(0);
    expect(rec.partials).toBe(0);
  });

  // ── 2. success counter ────────────────────────────────────────────────────

  it('increments successes on success outcome', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'a', skillName: 'A', outcome: 'success', latencyMs: 10 });
    t.recordOutcome({ skillId: 'a', skillName: 'A', outcome: 'success', latencyMs: 10 });
    const rec = t.get('a')!;
    expect(rec.successes).toBe(2);
    expect(rec.failures).toBe(0);
  });

  // ── 3. failure counter ────────────────────────────────────────────────────

  it('increments failures on failure outcome', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'b', skillName: 'B', outcome: 'failure', latencyMs: 50 });
    const rec = t.get('b')!;
    expect(rec.failures).toBe(1);
    expect(rec.successes).toBe(0);
  });

  // ── 4. partial counter ────────────────────────────────────────────────────

  it('increments partials on partial outcome', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'c', skillName: 'C', outcome: 'partial', latencyMs: 30 });
    const rec = t.get('c')!;
    expect(rec.partials).toBe(1);
  });

  // ── 5. meanLatencyMs ─────────────────────────────────────────────────────

  it('computes meanLatencyMs correctly', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'd', skillName: 'D', outcome: 'success', latencyMs: 100 });
    t.recordOutcome({ skillId: 'd', skillName: 'D', outcome: 'success', latencyMs: 200 });
    t.recordOutcome({ skillId: 'd', skillName: 'D', outcome: 'failure', latencyMs: 300 });
    const rec = t.get('d')!;
    expect(rec.meanLatencyMs).toBeCloseTo(200, 5);
    expect(rec.totalLatencyMs).toBe(600);
  });

  // ── 6. EMA with alpha=0.3 ─────────────────────────────────────────────────

  it('updates EMA with alpha=0.3 after successive successes', () => {
    const t = makeTracker({ alpha: 0.3 });
    // initial ema = 0.5
    // success → x=1 → ema = 0.3*1 + 0.7*0.5 = 0.65
    t.recordOutcome({ skillId: 'e', skillName: 'E', outcome: 'success', latencyMs: 0 });
    expect(t.get('e')!.ema).toBeCloseTo(0.65, 5);
    // second success → ema = 0.3*1 + 0.7*0.65 = 0.755
    t.recordOutcome({ skillId: 'e', skillName: 'E', outcome: 'success', latencyMs: 0 });
    expect(t.get('e')!.ema).toBeCloseTo(0.755, 5);
  });

  it('updates EMA after failure', () => {
    const t = makeTracker({ alpha: 0.3 });
    // initial ema=0.5; failure x=0 → 0.3*0 + 0.7*0.5 = 0.35
    t.recordOutcome({ skillId: 'f', skillName: 'F', outcome: 'failure', latencyMs: 0 });
    expect(t.get('f')!.ema).toBeCloseTo(0.35, 5);
  });

  it('updates EMA after partial', () => {
    const t = makeTracker({ alpha: 0.3 });
    // initial ema=0.5; partial x=0.5 → 0.3*0.5 + 0.7*0.5 = 0.5
    t.recordOutcome({ skillId: 'g', skillName: 'G', outcome: 'partial', latencyMs: 0 });
    expect(t.get('g')!.ema).toBeCloseTo(0.5, 5);
  });

  // ── 7. lastUsedAt + lastOutcome ───────────────────────────────────────────

  it('sets lastUsedAt and lastOutcome', () => {
    const t = makeTracker();
    const ts = '2024-06-01T12:00:00.000Z';
    t.recordOutcome({ skillId: 'h', skillName: 'H', outcome: 'success', latencyMs: 0, timestamp: ts });
    const rec = t.get('h')!;
    expect(rec.lastUsedAt).toBe(ts);
    expect(rec.lastOutcome).toBe('success');
  });

  it('uses clock() when timestamp not provided', () => {
    const now = 1_700_000_000_000;
    const t = makeTracker({ clock: () => now });
    t.recordOutcome({ skillId: 'hh', skillName: 'HH', outcome: 'failure', latencyMs: 0 });
    const rec = t.get('hh')!;
    expect(rec.lastUsedAt).toBe(new Date(now).toISOString());
  });

  // ── 8. tags merged, deduped, capped at 10 ────────────────────────────────

  it('merges tags, deduplicates, and caps at 10', () => {
    const t = makeTracker();
    t.recordOutcome({
      skillId: 'i', skillName: 'I', outcome: 'success', latencyMs: 0,
      tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    });
    t.recordOutcome({
      skillId: 'i', skillName: 'I', outcome: 'success', latencyMs: 0,
      tags: ['b', 'h', 'j', 'k', 'l'], // 'b' dup; adds h,j,k,l → total 11 → capped 10
    });
    const rec = t.get('i')!;
    expect(rec.tags!.length).toBeLessThanOrEqual(10);
    // dedup: 'b' should appear once
    expect(rec.tags!.filter((x) => x === 'b').length).toBe(1);
  });

  // ── 9. negative latency coerced to 0 ─────────────────────────────────────

  it('coerces negative latencyMs to 0', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'j', skillName: 'J', outcome: 'success', latencyMs: -99 });
    const rec = t.get('j')!;
    expect(rec.totalLatencyMs).toBe(0);
    expect(rec.meanLatencyMs).toBe(0);
  });

  // ── 10. get / list ────────────────────────────────────────────────────────

  it('get returns undefined for unknown skill', () => {
    expect(makeTracker().get('unknown')).toBeUndefined();
  });

  it('list returns all recorded skills', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'x1', skillName: 'X1', outcome: 'success', latencyMs: 0 });
    t.recordOutcome({ skillId: 'x2', skillName: 'X2', outcome: 'failure', latencyMs: 0 });
    expect(t.list().length).toBe(2);
  });

  // ── 11. rank sorts by default scoreFn desc ────────────────────────────────

  it('rank() sorts by default scoreFn descending', () => {
    const fixedClock = () => 0;
    const t = makeTracker({ clock: fixedClock });
    // Give skill 'high' many successes → high EMA
    for (let i = 0; i < 10; i++) {
      t.recordOutcome({ skillId: 'high', skillName: 'High', outcome: 'success', latencyMs: 10, timestamp: new Date(0).toISOString() });
    }
    // Give skill 'low' many failures → low EMA
    for (let i = 0; i < 10; i++) {
      t.recordOutcome({ skillId: 'low', skillName: 'Low', outcome: 'failure', latencyMs: 10, timestamp: new Date(0).toISOString() });
    }
    const ranked = t.rank({ clock: fixedClock });
    expect(ranked[0]!.skillId).toBe('high');
    expect(ranked[ranked.length - 1]!.skillId).toBe('low');
  });

  // ── 12. rank with custom scoreFn ─────────────────────────────────────────

  it('rank() respects custom scoreFn', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'alpha', skillName: 'Alpha', outcome: 'success', latencyMs: 1000 });
    t.recordOutcome({ skillId: 'beta', skillName: 'Beta', outcome: 'failure', latencyMs: 1 });
    // custom: rank by latency ascending (lower is better = higher score)
    const ranked = t.rank({ scoreFn: (r) => 1 / (1 + r.meanLatencyMs) });
    expect(ranked[0]!.skillId).toBe('beta');
  });

  // ── 13. pickBest returns top eligible ─────────────────────────────────────

  it('pickBest returns top-scoring candidate (explorationRate=0)', () => {
    const fixedClock = () => 0;
    const t = makeTracker({ clock: fixedClock });
    for (let i = 0; i < 5; i++) {
      t.recordOutcome({ skillId: 's1', skillName: 'S1', outcome: 'success', latencyMs: 10, timestamp: new Date(0).toISOString() });
    }
    for (let i = 0; i < 5; i++) {
      t.recordOutcome({ skillId: 's2', skillName: 'S2', outcome: 'failure', latencyMs: 10, timestamp: new Date(0).toISOString() });
    }
    const best = t.pickBest(
      [{ id: 's1' }, { id: 's2' }],
      { explorationRate: 0, clock: fixedClock },
    );
    expect(best?.id).toBe('s1');
  });

  // ── 14. pickBest minUses filter ───────────────────────────────────────────

  it('pickBest respects minUses filter', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'u1', skillName: 'U1', outcome: 'success', latencyMs: 0 });
    // u2 has 0 uses
    const best = t.pickBest([{ id: 'u1' }, { id: 'u2' }], { explorationRate: 0, minUses: 1 });
    expect(best?.id).toBe('u1');
  });

  // ── 15. pickBest minScore filter ──────────────────────────────────────────

  it('pickBest filters out candidates below minScore', () => {
    const t = makeTracker();
    for (let i = 0; i < 5; i++) {
      t.recordOutcome({ skillId: 'bad', skillName: 'Bad', outcome: 'failure', latencyMs: 9999 });
    }
    // synthetic record for 'good' (no record, ema=0.5 → score > 0)
    const best = t.pickBest(
      [{ id: 'bad' }, { id: 'good' }],
      { explorationRate: 0, minScore: 0.4 },
    );
    // 'good' has ema=0.5 → score ~0.45; 'bad' has very low score from failures
    expect(best?.id).toBe('good');
  });

  // ── 16. pickBest empty candidates → undefined ─────────────────────────────

  it('pickBest returns undefined for empty candidates', () => {
    expect(makeTracker().pickBest([])).toBeUndefined();
  });

  // ── 17. pickBest with no eligible → undefined ─────────────────────────────

  it('pickBest returns undefined when all candidates filtered out by minUses', () => {
    const t = makeTracker();
    const result = t.pickBest([{ id: 'x' }], { minUses: 99 });
    expect(result).toBeUndefined();
  });

  // ── 18. pickBest exploration ─────────────────────────────────────────────

  it('pickBest exploration: seeded rng can return non-top candidate', () => {
    const fixedClock = () => 0;
    const t = makeTracker({ clock: fixedClock });
    for (let i = 0; i < 10; i++) {
      t.recordOutcome({ skillId: 'top', skillName: 'Top', outcome: 'success', latencyMs: 0, timestamp: new Date(0).toISOString() });
    }
    for (let i = 0; i < 10; i++) {
      t.recordOutcome({ skillId: 'other', skillName: 'Other', outcome: 'failure', latencyMs: 0, timestamp: new Date(0).toISOString() });
    }
    // Force exploration: first call to rng() < explorationRate=1.0 so always explores;
    // second call picks index — we drive it to index 1 (the non-top)
    const calls: number[] = [];
    const rng = () => {
      calls.push(calls.length);
      if (calls.length === 1) return 0.05; // < explorationRate=1.0 → explore
      return 0.99; // picks last eligible item
    };
    const candidates = [{ id: 'top' }, { id: 'other' }];
    const chosen = t.pickBest(candidates, { explorationRate: 1.0, rng, clock: fixedClock });
    // With rng returning 0.99 for index → floor(0.99*2) = 1 → 'other'
    expect(chosen?.id).toBe('other');
  });

  // ── 19. pickBest explorationRate=0 always picks top ──────────────────────

  it('pickBest with explorationRate=0 always picks top', () => {
    const fixedClock = () => 0;
    const t = makeTracker({ clock: fixedClock });
    for (let i = 0; i < 5; i++) {
      t.recordOutcome({ skillId: 'winner', skillName: 'W', outcome: 'success', latencyMs: 0, timestamp: new Date(0).toISOString() });
    }
    for (let i = 0; i < 20; i++) {
      t.recordOutcome({ skillId: 'loser', skillName: 'L', outcome: 'failure', latencyMs: 0, timestamp: new Date(0).toISOString() });
    }
    for (let i = 0; i < 5; i++) {
      const result = t.pickBest([{ id: 'winner' }, { id: 'loser' }], { explorationRate: 0, clock: fixedClock });
      expect(result?.id).toBe('winner');
    }
  });

  // ── 20. pickBest candidates without records rankable when minUses=0 ───────

  it('candidates without records are rankable when minUses=0', () => {
    const t = makeTracker();
    // No records recorded — both are synthetic
    const best = t.pickBest([{ id: 'new1', name: 'New1' }, { id: 'new2', name: 'New2' }], {
      explorationRate: 0,
      minUses: 0,
    });
    // Both score equally; tie-break by first encountered
    expect(['new1', 'new2']).toContain(best?.id);
  });

  // ── 21. explorationRate clamped (passing >1 treated as 1) ─────────────────

  it('clamps explorationRate > 1 to 1 (always explores)', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'top', skillName: 'Top', outcome: 'success', latencyMs: 0 });
    t.recordOutcome({ skillId: 'bot', skillName: 'Bot', outcome: 'failure', latencyMs: 0 });
    // rng always returns 0 for index check (first eligible)
    let callN = 0;
    const rng = () => {
      callN++;
      return callN === 1 ? 0.9999 : 0; // first call: 0.9999 < clamp(2→1) → explores; second: pick index 0
    };
    const result = t.pickBest([{ id: 'top' }, { id: 'bot' }], { explorationRate: 2, rng });
    // exploration with index 0 → first eligible
    expect(result).toBeDefined();
  });

  // ── 22. reset(id) removes that record only ────────────────────────────────

  it('reset(id) removes only that skill', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'r1', skillName: 'R1', outcome: 'success', latencyMs: 0 });
    t.recordOutcome({ skillId: 'r2', skillName: 'R2', outcome: 'success', latencyMs: 0 });
    t.reset('r1');
    expect(t.get('r1')).toBeUndefined();
    expect(t.get('r2')).toBeDefined();
  });

  // ── 23. reset() clears all ────────────────────────────────────────────────

  it('reset() clears all records', () => {
    const t = makeTracker();
    t.recordOutcome({ skillId: 'r1', skillName: 'R1', outcome: 'success', latencyMs: 0 });
    t.recordOutcome({ skillId: 'r2', skillName: 'R2', outcome: 'success', latencyMs: 0 });
    t.reset();
    expect(t.list().length).toBe(0);
  });

  // ── 24. flush writes JSON file ────────────────────────────────────────────

  it('flush writes a valid JSON file', async () => {
    const p = trackedPath();
    const t = makeTracker({ storePath: p, flushDebounceMs: 60_000 }); // large debounce → won't auto-flush
    t.recordOutcome({ skillId: 'f1', skillName: 'F1', outcome: 'success', latencyMs: 100 });
    await t.flush();
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as SkillEffectivenessRecord[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]!.skillId).toBe('f1');
  });

  // ── 25. flush is atomic (parseable even when called twice rapidly) ─────────

  it('flush is atomic: two rapid flushes both produce valid JSON', async () => {
    const p = trackedPath();
    const t = makeTracker({ storePath: p, flushDebounceMs: 60_000 });
    t.recordOutcome({ skillId: 'at1', skillName: 'AT1', outcome: 'success', latencyMs: 50 });
    await Promise.all([t.flush(), t.flush()]);
    const raw = fs.readFileSync(p, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  // ── 26. reload on startup restores records ────────────────────────────────

  it('reload on startup restores persisted records', async () => {
    const p = trackedPath();
    const t1 = makeTracker({ storePath: p, flushDebounceMs: 60_000 });
    t1.recordOutcome({ skillId: 'persist', skillName: 'Persist', outcome: 'success', latencyMs: 200 });
    await t1.flush();

    const t2 = makeTracker({ storePath: p });
    const rec = t2.get('persist');
    expect(rec).toBeDefined();
    expect(rec!.uses).toBe(1);
    expect(rec!.successes).toBe(1);
    expect(rec!.meanLatencyMs).toBe(200);
  });

  // ── 27. malformed JSON → starts empty + warns ─────────────────────────────

  it('malformed JSON in storePath starts fresh and logs warn', () => {
    const p = trackedPath();
    fs.writeFileSync(p, '{ not valid json ]]]', 'utf8');
    const warnings: string[] = [];
    const t = makeTracker({
      storePath: p,
      logger: (level, msg) => { if (level === 'warn') warnings.push(msg); },
    });
    expect(t.list().length).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  // ── 28. debounced flush coalesces multiple recordOutcome into 1 write ──────

  it('debounced flush coalesces multiple recordOutcome calls', async () => {
    vi.useFakeTimers();
    const p = trackedPath();
    const t = makeTracker({ storePath: p, flushDebounceMs: 200 });

    // Record multiple outcomes — each schedules a debounced flush
    t.recordOutcome({ skillId: 'db', skillName: 'DB', outcome: 'success', latencyMs: 10 });
    t.recordOutcome({ skillId: 'db', skillName: 'DB', outcome: 'failure', latencyMs: 20 });
    t.recordOutcome({ skillId: 'db', skillName: 'DB', outcome: 'partial', latencyMs: 30 });

    // File not written yet (debounce pending)
    expect(fs.existsSync(p)).toBe(false);

    // Advance time past debounce
    vi.advanceTimersByTime(300);
    await Promise.resolve(); // flush microtask queue

    expect(fs.existsSync(p)).toBe(true);
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as SkillEffectivenessRecord[];
    expect(parsed[0]!.uses).toBe(3);
  });
});
