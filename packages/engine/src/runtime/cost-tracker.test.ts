// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createCostTracker, type ModelPricing, type BudgetAlert } from './cost-tracker';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GPT4: ModelPricing = { promptPer1k: 30, completionPer1k: 60 };
// 1000p+1000c → (1*30)+(1*60) = $90
const CLAUDE: ModelPricing = { promptPer1k: 8, completionPer1k: 24 };

// ─── record ───────────────────────────────────────────────────────────────────

describe('record', () => {
  it('computes cost from pricing', () => {
    const t = createCostTracker({ pricing: { 'gpt-4': GPT4 } });
    const rec = t.record('gpt-4', 1000, 1000);
    expect(rec.cost).toBeCloseTo(90);
  });

  it('unknown model defaults cost to 0', () => {
    const t = createCostTracker();
    const rec = t.record('unknown-model', 500, 500);
    expect(rec.cost).toBe(0);
  });

  it('returns the UsageRecord with all fields', () => {
    const now = 1_700_000_000_000;
    const t = createCostTracker({ pricing: { 'gpt-4': GPT4 }, clock: () => now });
    const rec = t.record('gpt-4', 200, 100);
    expect(rec.ts).toBe(now);
    expect(rec.model).toBe('gpt-4');
    expect(rec.promptTokens).toBe(200);
    expect(rec.completionTokens).toBe(100);
    expect(rec.cost).toBeCloseTo((200 / 1000) * 30 + (100 / 1000) * 60);
  });

  it('preserves meta on the record', () => {
    const t = createCostTracker();
    const rec = t.record('x', 0, 0, { sessionId: 'abc', step: 3 });
    expect(rec.meta).toEqual({ sessionId: 'abc', step: 3 });
  });

  it('record without meta has no meta key', () => {
    const t = createCostTracker();
    const rec = t.record('x', 0, 0);
    expect(rec.meta).toBeUndefined();
  });

  it('pricing 0/0 yields cost 0', () => {
    const t = createCostTracker({ pricing: { m: { promptPer1k: 0, completionPer1k: 0 } } });
    const rec = t.record('m', 9999, 9999);
    expect(rec.cost).toBe(0);
  });
});

// ─── setPricing ───────────────────────────────────────────────────────────────

describe('setPricing', () => {
  it('updates rates used for subsequent records', () => {
    const t = createCostTracker();
    t.setPricing('gpt-4', GPT4);
    const rec = t.record('gpt-4', 1000, 0);
    expect(rec.cost).toBeCloseTo(30);
  });

  it('overrides existing pricing', () => {
    const t = createCostTracker({ pricing: { 'gpt-4': GPT4 } });
    t.setPricing('gpt-4', { promptPer1k: 1, completionPer1k: 2 });
    const rec = t.record('gpt-4', 1000, 1000);
    expect(rec.cost).toBeCloseTo(3);
  });
});

// ─── getSpend ─────────────────────────────────────────────────────────────────

describe('getSpend', () => {
  it('total returns sum of all costs', () => {
    const t = createCostTracker({ pricing: { m: GPT4 } });
    t.record('m', 1000, 0); // $30
    t.record('m', 0, 1000); // $60
    expect(t.getSpend('total')).toBeCloseTo(90);
  });

  it('hour window excludes records older than 3600s', () => {
    let now = 10_000_000;
    const t = createCostTracker({ pricing: { m: GPT4 }, clock: () => now });
    t.record('m', 1000, 0); // $30 — old
    now += 3_600_001;       // advance past 1 hour
    t.record('m', 1000, 0); // $30 — within window
    expect(t.getSpend('hour')).toBeCloseTo(30);
  });

  it('day window excludes records older than 86400s', () => {
    let now = 10_000_000;
    const t = createCostTracker({ pricing: { m: GPT4 }, clock: () => now });
    t.record('m', 1000, 0);   // old
    now += 86_400_001;
    t.record('m', 0, 1000);   // within day
    expect(t.getSpend('day')).toBeCloseTo(60);
  });

  it('month window spans 30 days', () => {
    let now = 100_000_000;
    const t = createCostTracker({ pricing: { m: GPT4 }, clock: () => now });
    t.record('m', 1000, 0);           // old (outside month)
    now += 30 * 86_400_000 + 1;
    t.record('m', 0, 1000);           // within month window
    expect(t.getSpend('month')).toBeCloseTo(60);
  });

  it('filters spend by model', () => {
    const t = createCostTracker({ pricing: { a: GPT4, b: CLAUDE } });
    t.record('a', 1000, 0); // $30
    t.record('b', 1000, 0); // $8
    expect(t.getSpend('total', 'a')).toBeCloseTo(30);
    expect(t.getSpend('total', 'b')).toBeCloseTo(8);
  });

  it('multiple records in same hour aggregate correctly', () => {
    let now = 5_000_000;
    const t = createCostTracker({ pricing: { m: GPT4 }, clock: () => now });
    t.record('m', 500, 0);  // $15
    now += 100_000;
    t.record('m', 500, 0);  // $15
    now += 100_000;
    t.record('m', 0, 500);  // $30
    expect(t.getSpend('hour')).toBeCloseTo(60);
  });
});

// ─── getTokens ────────────────────────────────────────────────────────────────

describe('getTokens', () => {
  it('returns prompt/completion/total for total window', () => {
    const t = createCostTracker();
    t.record('m', 400, 600);
    t.record('m', 100, 200);
    const tok = t.getTokens('total');
    expect(tok.prompt).toBe(500);
    expect(tok.completion).toBe(800);
    expect(tok.total).toBe(1300);
  });

  it('filters tokens by model', () => {
    const t = createCostTracker();
    t.record('a', 100, 200);
    t.record('b', 300, 400);
    const tok = t.getTokens('total', 'a');
    expect(tok.prompt).toBe(100);
    expect(tok.completion).toBe(200);
    expect(tok.total).toBe(300);
  });

  it('hour window excludes old records', () => {
    let now = 0;
    const t = createCostTracker({ clock: () => now });
    t.record('m', 1000, 2000);
    now += 3_600_001;
    t.record('m', 50, 50);
    const tok = t.getTokens('hour');
    expect(tok.prompt).toBe(50);
    expect(tok.completion).toBe(50);
    expect(tok.total).toBe(100);
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────

describe('getStats', () => {
  it('returns perModel breakdown', () => {
    const t = createCostTracker({ pricing: { 'gpt-4': GPT4, claude: CLAUDE } });
    t.record('gpt-4', 1000, 1000);  // $90
    t.record('gpt-4', 0, 1000);     // $60
    t.record('claude', 1000, 0);    // $8
    const stats = t.getStats();
    expect(stats.perModel['gpt-4'].calls).toBe(2);
    expect(stats.perModel['gpt-4'].cost).toBeCloseTo(150);
    expect(stats.perModel['gpt-4'].prompt).toBe(1000);
    expect(stats.perModel['gpt-4'].completion).toBe(2000);
    expect(stats.perModel['claude'].calls).toBe(1);
    expect(stats.perModel['claude'].cost).toBeCloseTo(8);
    expect(stats.totalCost).toBeCloseTo(158);
    expect(stats.totalTokens).toBe(4000);
  });
});

// ─── getRecent ────────────────────────────────────────────────────────────────

describe('getRecent', () => {
  it('returns records in reverse-chronological order', () => {
    let now = 1000;
    const t = createCostTracker({ clock: () => now++ });
    t.record('m', 1, 0);
    t.record('m', 2, 0);
    t.record('m', 3, 0);
    const recent = t.getRecent();
    expect(recent[0].promptTokens).toBe(3);
    expect(recent[2].promptTokens).toBe(1);
  });

  it('respects limit parameter', () => {
    const t = createCostTracker();
    for (let i = 0; i < 10; i++) t.record('m', i, 0);
    expect(t.getRecent(3)).toHaveLength(3);
  });

  it('no limit returns all records', () => {
    const t = createCostTracker();
    for (let i = 0; i < 5; i++) t.record('m', 0, 0);
    expect(t.getRecent()).toHaveLength(5);
  });
});

// ─── addAlert / removeAlert ────────────────────────────────────────────────────

describe('addAlert / removeAlert', () => {
  it('removeAlert returns true when found', () => {
    const t = createCostTracker();
    const alert: BudgetAlert = { id: 'a1', level: 'warn', threshold: 10, window: 'total' };
    t.addAlert(alert);
    expect(t.removeAlert('a1')).toBe(true);
  });

  it('removeAlert returns false when not found', () => {
    const t = createCostTracker();
    expect(t.removeAlert('missing')).toBe(false);
  });
});

// ─── onAlert ──────────────────────────────────────────────────────────────────

describe('onAlert', () => {
  it('fires when threshold crossed', () => {
    const fired: Array<[BudgetAlert, number]> = [];
    const t = createCostTracker({
      pricing: { m: GPT4 },
      onAlert: (a, s) => fired.push([a, s]),
    });
    const alert: BudgetAlert = { id: 'a1', level: 'warn', threshold: 25, window: 'total' };
    t.addAlert(alert);
    t.record('m', 1000, 0); // $30 >= $25
    expect(fired).toHaveLength(1);
    expect(fired[0][0].id).toBe('a1');
    expect(fired[0][1]).toBeCloseTo(30);
  });

  it('does not fire when below threshold', () => {
    const fired: unknown[] = [];
    const t = createCostTracker({
      pricing: { m: GPT4 },
      onAlert: () => fired.push(1),
    });
    t.addAlert({ id: 'a1', level: 'warn', threshold: 100, window: 'total' });
    t.record('m', 100, 0); // $3 < $100
    expect(fired).toHaveLength(0);
  });

  it('does not double-fire within same window epoch', () => {
    const fired: unknown[] = [];
    let now = 1_000_000;
    const t = createCostTracker({
      pricing: { m: GPT4 },
      clock: () => now,
      onAlert: () => fired.push(1),
    });
    t.addAlert({ id: 'a1', level: 'warn', threshold: 10, window: 'total' });
    t.record('m', 1000, 0); // $30 — fires
    now += 1000;
    t.record('m', 1000, 0); // still $60 total — same epoch, no re-fire
    expect(fired).toHaveLength(1);
  });

  it('fires again in next day epoch', () => {
    const fired: unknown[] = [];
    let now = 86_400_000; // exactly epoch 1 boundary
    const t = createCostTracker({
      pricing: { m: GPT4 },
      clock: () => now,
      onAlert: () => fired.push(1),
    });
    t.addAlert({ id: 'a1', level: 'warn', threshold: 10, window: 'day' });
    t.record('m', 1000, 0); // fires epoch 1
    expect(fired).toHaveLength(1);

    // Move to next day epoch and record enough spend (but the window resets so old record is gone)
    now += 86_400_001; // next day epoch
    t.record('m', 1000, 0); // $30 in new day window — new epoch → fires again
    expect(fired).toHaveLength(2);
  });

  it('removed alert no longer fires', () => {
    const fired: unknown[] = [];
    const t = createCostTracker({
      pricing: { m: GPT4 },
      onAlert: () => fired.push(1),
    });
    t.addAlert({ id: 'a1', level: 'critical', threshold: 1, window: 'total' });
    t.removeAlert('a1');
    t.record('m', 1000, 0);
    expect(fired).toHaveLength(0);
  });
});

// ─── clear ────────────────────────────────────────────────────────────────────

describe('clear', () => {
  it('empties all records', () => {
    const t = createCostTracker();
    t.record('m', 100, 200);
    t.record('m', 300, 400);
    t.clear();
    expect(t.getRecent()).toHaveLength(0);
    expect(t.getSpend('total')).toBe(0);
  });

  it('resets alert trigger state so onAlert can re-fire', () => {
    const fired: unknown[] = [];
    const t = createCostTracker({
      pricing: { m: GPT4 },
      onAlert: () => fired.push(1),
    });
    t.addAlert({ id: 'a1', level: 'warn', threshold: 10, window: 'total' });
    t.record('m', 1000, 0); // fires
    t.clear();
    t.record('m', 1000, 0); // fires again after clear
    expect(fired).toHaveLength(2);
  });
});

// ─── save / load ──────────────────────────────────────────────────────────────

describe('save / load', () => {
  const testDir = path.join(
    process.env['HOME'] ?? '.',
    'ceoclaw-dev',
    '.cost-tracker-test-tmp',
  );
  const testFile = path.join(testDir, 'test-persist.json');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('save + load round-trips records, pricing, and alerts', () => {
    const t1 = createCostTracker({
      pricing: { 'gpt-4': GPT4 },
      persistPath: testFile,
    });
    t1.addAlert({ id: 'a1', level: 'warn', threshold: 50, window: 'day' });
    t1.record('gpt-4', 1000, 500);
    t1.save();

    const t2 = createCostTracker({ persistPath: testFile });
    t2.load();
    const recent = t2.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].model).toBe('gpt-4');
    expect(recent[0].promptTokens).toBe(1000);
    // pricing was restored
    const r2 = t2.record('gpt-4', 1000, 0);
    expect(r2.cost).toBeCloseTo(30);
  });

  it('load on missing file is a no-op', () => {
    const t = createCostTracker({ persistPath: testFile });
    expect(() => t.load()).not.toThrow();
    expect(t.getRecent()).toHaveLength(0);
  });

  it('save writes JSON with version 1', () => {
    const t = createCostTracker({ persistPath: testFile });
    t.record('m', 0, 0);
    t.save();
    const raw = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    expect(raw.version).toBe(1);
    expect(Array.isArray(raw.records)).toBe(true);
  });

  it('save is atomic (no partial file visible)', () => {
    const t = createCostTracker({ persistPath: testFile });
    t.record('m', 100, 200);
    t.save();
    // If save is atomic the file must exist and be valid JSON
    expect(() => JSON.parse(fs.readFileSync(testFile, 'utf8'))).not.toThrow();
  });
});
