// @vitest-environment node
/**
 * Tests for the Token / Cost Budget Controller.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createTokenBudgetController,
  type BudgetRule,
  type Consumption,
} from './token-budget-controller';

// ── Test helpers ─────────────────────────────────────────────────────────────

const STORE_DIR = join(process.cwd(), '__tbc_test_tmp__');

function storePath(name: string) {
  return join(STORE_DIR, `${name}.json`);
}

function makeConsumption(overrides: Partial<Consumption> = {}): Consumption {
  return {
    ts: Date.now(),
    scope: 'global',
    promptTokens: 100,
    completionTokens: 50,
    costUsd: 0.01,
    ...overrides,
  };
}

function makeRule(overrides: Partial<BudgetRule> = {}): BudgetRule {
  return {
    id: 'r1',
    scope: 'global',
    window: 'total',
    maxTokens: 10_000,
    ...overrides,
  };
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  // Individual tests use unique paths — just ensure the directory exists
  mkdirSync(STORE_DIR, { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
});

// Clean up before (handles leftover files from prior failed runs) and after
beforeAll(() => {
  if (existsSync(STORE_DIR)) rmSync(STORE_DIR, { recursive: true, force: true });
  mkdirSync(STORE_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(STORE_DIR)) rmSync(STORE_DIR, { recursive: true, force: true });
});

// ── Rule management ──────────────────────────────────────────────────────────

describe('addRule / removeRule / listRules', () => {
  it('starts with empty rule list when no rules passed', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('a1'), flushDebounceMs: 0 });
    expect(ctrl.listRules()).toEqual([]);
  });

  it('addRule appends a rule', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('a2'), flushDebounceMs: 0 });
    const rule = makeRule();
    ctrl.addRule(rule);
    expect(ctrl.listRules()).toHaveLength(1);
    expect(ctrl.listRules()[0].id).toBe('r1');
  });

  it('addRule replaces rule with same id', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('a3'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ maxTokens: 100 }));
    ctrl.addRule(makeRule({ maxTokens: 999 }));
    expect(ctrl.listRules()).toHaveLength(1);
    expect(ctrl.listRules()[0].maxTokens).toBe(999);
  });

  it('removeRule removes by id', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('a4'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'x' }));
    ctrl.addRule(makeRule({ id: 'y' }));
    ctrl.removeRule('x');
    const ids = ctrl.listRules().map((r) => r.id);
    expect(ids).not.toContain('x');
    expect(ids).toContain('y');
  });

  it('removeRule on non-existent id is a no-op', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('a5'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule());
    ctrl.removeRule('nonexistent');
    expect(ctrl.listRules()).toHaveLength(1);
  });

  it('rules passed at construction are available immediately', () => {
    const rule = makeRule({ id: 'init' });
    const ctrl = createTokenBudgetController({
      storePath: storePath('a6'),
      rules: [rule],
      flushDebounceMs: 0,
    });
    expect(ctrl.listRules().map((r) => r.id)).toContain('init');
  });
});

// ── canConsume ────────────────────────────────────────────────────────────────

describe('canConsume', () => {
  it('returns allowed=true when under token budget', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('b1'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ maxTokens: 10_000 }));
    const res = ctrl.canConsume({ scope: 'global', estPromptTokens: 100, estCompletionTokens: 50, estCostUsd: 0 });
    expect(res.allowed).toBe(true);
  });

  it('returns allowed=false with blockingRule when estimate would exceed token budget', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('b2'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'tok', maxTokens: 100 }));
    const res = ctrl.canConsume({ scope: 'global', estPromptTokens: 80, estCompletionTokens: 30, estCostUsd: 0 });
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe('tok');
  });

  it('returns remainingTokens in block result', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('b3'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'tok', maxTokens: 200 }));
    ctrl.recordConsumption(makeConsumption({ promptTokens: 150, completionTokens: 0, costUsd: 0 }));
    const res = ctrl.canConsume({ scope: 'global', estPromptTokens: 100, estCompletionTokens: 0, estCostUsd: 0 });
    expect(res.allowed).toBe(false);
    expect(res.remainingTokens).toBe(50);
  });

  it('returns allowed=false when estimate would exceed cost budget', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('b4'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'cost', maxTokens: undefined, maxCostUsd: 0.05 }));
    const res = ctrl.canConsume({ scope: 'global', estPromptTokens: 10, estCompletionTokens: 5, estCostUsd: 0.06 });
    expect(res.allowed).toBe(false);
    expect(res.blockingRule).toBe('cost');
  });

  it('returns remainingCostUsd in block result', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('b5'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'c', maxTokens: undefined, maxCostUsd: 1.0 }));
    ctrl.recordConsumption(makeConsumption({ promptTokens: 0, completionTokens: 0, costUsd: 0.7 }));
    const res = ctrl.canConsume({ scope: 'global', estPromptTokens: 0, estCompletionTokens: 0, estCostUsd: 0.4 });
    expect(res.allowed).toBe(false);
    expect(res.remainingCostUsd).toBeCloseTo(0.3, 5);
  });

  it('task rule only blocks task scope with matching targetId', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('b6'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'task-rule', scope: 'task', targetId: 'task-123', maxTokens: 50 }));

    // different scope → not blocked
    const globalReq = ctrl.canConsume({ scope: 'global', estPromptTokens: 100, estCompletionTokens: 0, estCostUsd: 0 });
    expect(globalReq.allowed).toBe(true);

    // same scope, different targetId → not blocked
    const otherTask = ctrl.canConsume({ scope: 'task', targetId: 'task-999', estPromptTokens: 100, estCompletionTokens: 0, estCostUsd: 0 });
    expect(otherTask.allowed).toBe(true);

    // same scope + matching targetId → blocked
    const blocked = ctrl.canConsume({ scope: 'task', targetId: 'task-123', estPromptTokens: 40, estCompletionTokens: 20, estCostUsd: 0 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blockingRule).toBe('task-rule');
  });

  it('session rule with targetId does not block different session', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('b7'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'sess', scope: 'session', targetId: 'sess-A', maxTokens: 10 }));
    const res = ctrl.canConsume({ scope: 'session', targetId: 'sess-B', estPromptTokens: 100, estCompletionTokens: 0, estCostUsd: 0 });
    expect(res.allowed).toBe(true);
  });
});

// ── recordConsumption ─────────────────────────────────────────────────────────

describe('recordConsumption', () => {
  it('updates totals in snapshot', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('c1'), flushDebounceMs: 0 });
    ctrl.recordConsumption(makeConsumption({ promptTokens: 200, completionTokens: 100, costUsd: 0.05 }));
    ctrl.recordConsumption(makeConsumption({ promptTokens: 300, completionTokens: 50, costUsd: 0.03 }));
    const snap = ctrl.reportSnapshot();
    expect(snap.totalConsumption).toBe(650);
    expect(snap.totalCostUsd).toBeCloseTo(0.08, 5);
  });

  it('emits consume event', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('c2'), flushDebounceMs: 0 });
    const consumed: unknown[] = [];
    ctrl.on('consume', (p) => consumed.push(p));
    const c = makeConsumption();
    ctrl.recordConsumption(c);
    expect(consumed).toHaveLength(1);
  });

  it('emits warn event when warnAtPercent threshold crossed', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('c3'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'w', maxTokens: 1000, warnAtPercent: 80 }));
    const warnings: unknown[] = [];
    ctrl.on('warn', (p) => warnings.push(p));

    ctrl.recordConsumption(makeConsumption({ promptTokens: 700, completionTokens: 100, costUsd: 0 }));
    expect(warnings).toHaveLength(1);
  });

  it('warn event fires only once per window (not repeated)', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('c4'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'w2', maxTokens: 1000, warnAtPercent: 80 }));
    const warnings: unknown[] = [];
    ctrl.on('warn', (p) => warnings.push(p));

    ctrl.recordConsumption(makeConsumption({ promptTokens: 500, completionTokens: 350, costUsd: 0 })); // 85%
    ctrl.recordConsumption(makeConsumption({ promptTokens: 100, completionTokens: 0, costUsd: 0 }));   // 95%
    expect(warnings).toHaveLength(1);
  });

  it('returns warning rule ids in result', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('c5'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'wret', maxTokens: 1000, warnAtPercent: 50 }));
    const result = ctrl.recordConsumption(makeConsumption({ promptTokens: 400, completionTokens: 200, costUsd: 0 }));
    expect(result.warnings).toContain('wret');
  });

  it('emits block event when recordConsumption pushes over limit', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('c6'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'blk', maxTokens: 100 }));
    const blocks: unknown[] = [];
    ctrl.on('block', (p) => blocks.push(p));

    ctrl.recordConsumption(makeConsumption({ promptTokens: 80, completionTokens: 30, costUsd: 0 }));
    expect(blocks).toHaveLength(1);
  });
});

// ── Window math ───────────────────────────────────────────────────────────────

describe('window math', () => {
  it('hour window: consumptions older than 1h do not count', () => {
    vi.useFakeTimers();
    const NOW = Date.UTC(2024, 5, 15, 12, 0, 0); // noon
    vi.setSystemTime(NOW);

    let now = NOW;
    const ctrl = createTokenBudgetController({
      storePath: storePath('w1'),
      flushDebounceMs: 99_999,
      clock: () => now,
    });
    ctrl.addRule(makeRule({ id: 'hr', window: 'hour', maxTokens: 500 }));

    // old consumption (2h ago)
    ctrl.recordConsumption(makeConsumption({ ts: NOW - 2 * 3_600_000, promptTokens: 400, completionTokens: 0, costUsd: 0 }));
    // recent consumption (30min ago)
    ctrl.recordConsumption(makeConsumption({ ts: NOW - 30 * 60_000, promptTokens: 100, completionTokens: 0, costUsd: 0 }));

    const usage = ctrl.usageFor({ id: 'hr', scope: 'global', window: 'hour', maxTokens: 500 });
    expect(usage.tokens).toBe(100);
  });

  it('day window: only today (UTC midnight) counts', () => {
    vi.useFakeTimers();
    const TODAY = Date.UTC(2024, 5, 15, 10, 0, 0);
    vi.setSystemTime(TODAY);

    let now = TODAY;
    const ctrl = createTokenBudgetController({
      storePath: storePath('w2'),
      flushDebounceMs: 99_999,
      clock: () => now,
    });
    ctrl.addRule(makeRule({ id: 'day', window: 'day', maxTokens: 500 }));

    // yesterday
    ctrl.recordConsumption(makeConsumption({ ts: Date.UTC(2024, 5, 14, 23, 59, 0), promptTokens: 200, completionTokens: 0, costUsd: 0 }));
    // today
    ctrl.recordConsumption(makeConsumption({ ts: Date.UTC(2024, 5, 15, 8, 0, 0), promptTokens: 100, completionTokens: 0, costUsd: 0 }));

    const usage = ctrl.usageFor({ id: 'day', scope: 'global', window: 'day', maxTokens: 500 });
    expect(usage.tokens).toBe(100);
  });

  it('month window: only this month counts', () => {
    vi.useFakeTimers();
    const NOW = Date.UTC(2024, 5, 15, 10, 0, 0); // June 15
    vi.setSystemTime(NOW);

    let now = NOW;
    const ctrl = createTokenBudgetController({
      storePath: storePath('w3'),
      flushDebounceMs: 99_999,
      clock: () => now,
    });
    ctrl.addRule(makeRule({ id: 'mon', window: 'month', maxTokens: 10_000 }));

    // last month (May)
    ctrl.recordConsumption(makeConsumption({ ts: Date.UTC(2024, 4, 31, 23, 0, 0), promptTokens: 500, completionTokens: 0, costUsd: 0 }));
    // this month (June 1)
    ctrl.recordConsumption(makeConsumption({ ts: Date.UTC(2024, 5, 1, 0, 0, 0), promptTokens: 300, completionTokens: 0, costUsd: 0 }));

    const usage = ctrl.usageFor({ id: 'mon', scope: 'global', window: 'month', maxTokens: 10_000 });
    expect(usage.tokens).toBe(300);
  });

  it('total window: counts all consumptions regardless of age', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2024, 5, 15));

    const ctrl = createTokenBudgetController({
      storePath: storePath('w4'),
      flushDebounceMs: 99_999,
      clock: () => Date.now(),
    });
    ctrl.addRule(makeRule({ id: 'tot', window: 'total', maxTokens: 99_999 }));

    ctrl.recordConsumption(makeConsumption({ ts: 0, promptTokens: 1000, completionTokens: 0, costUsd: 0 }));
    ctrl.recordConsumption(makeConsumption({ ts: Date.now(), promptTokens: 500, completionTokens: 0, costUsd: 0 }));

    const usage = ctrl.usageFor({ id: 'tot', scope: 'global', window: 'total', maxTokens: 99_999 });
    expect(usage.tokens).toBe(1500);
  });

  it('hour window canConsume blocks when accumulated tokens within window exceed limit', () => {
    vi.useFakeTimers();
    const NOW = Date.UTC(2024, 5, 15, 14, 0, 0);
    vi.setSystemTime(NOW);

    let now = NOW;
    const ctrl = createTokenBudgetController({
      storePath: storePath('w5'),
      flushDebounceMs: 99_999,
      clock: () => now,
    });
    ctrl.addRule(makeRule({ id: 'hr2', window: 'hour', maxTokens: 200 }));

    ctrl.recordConsumption(makeConsumption({ ts: NOW - 1800_000, promptTokens: 150, completionTokens: 0, costUsd: 0 }));
    const res = ctrl.canConsume({ scope: 'global', estPromptTokens: 80, estCompletionTokens: 0, estCostUsd: 0 });
    expect(res.allowed).toBe(false);
  });

  it('day window: windowStart matches UTC midnight', () => {
    vi.useFakeTimers();
    const midday = Date.UTC(2024, 5, 15, 14, 30, 0);
    vi.setSystemTime(midday);

    const ctrl = createTokenBudgetController({
      storePath: storePath('w6'),
      flushDebounceMs: 99_999,
      clock: () => Date.now(),
    });
    const usage = ctrl.usageFor({ id: 'x', scope: 'global', window: 'day' });
    expect(usage.windowStart).toBe(Date.UTC(2024, 5, 15, 0, 0, 0));
  });

  it('month window: windowStart matches first of month UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2024, 5, 15, 14, 0, 0));

    const ctrl = createTokenBudgetController({
      storePath: storePath('w7'),
      flushDebounceMs: 99_999,
      clock: () => Date.now(),
    });
    const usage = ctrl.usageFor({ id: 'x', scope: 'global', window: 'month' });
    expect(usage.windowStart).toBe(Date.UTC(2024, 5, 1, 0, 0, 0));
  });
});

// ── Persistence ───────────────────────────────────────────────────────────────

describe('flush + persistence', () => {
  it('flush writes a readable JSON file', async () => {
    const p = storePath('p1');
    const ctrl = createTokenBudgetController({ storePath: p, flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'persist-rule' }));
    ctrl.recordConsumption(makeConsumption({ promptTokens: 50, completionTokens: 25, costUsd: 0.01 }));
    await ctrl.flush();
    expect(existsSync(p)).toBe(true);
  });

  it('load round-trip: rules and consumptions survive restart', async () => {
    const p = storePath('p2');
    const ctrl1 = createTokenBudgetController({ storePath: p, flushDebounceMs: 0 });
    ctrl1.addRule(makeRule({ id: 'loaded-rule' }));
    ctrl1.recordConsumption(makeConsumption({ promptTokens: 111, completionTokens: 22, costUsd: 0.07 }));
    await ctrl1.flush();

    const ctrl2 = createTokenBudgetController({ storePath: p, flushDebounceMs: 0 });
    const snap = ctrl2.reportSnapshot();
    expect(snap.totalConsumption).toBe(133);
    expect(ctrl2.listRules().map((r) => r.id)).toContain('loaded-rule');
  });

  it('construction rules override persisted rules with same id', async () => {
    const p = storePath('p3');
    const ctrl1 = createTokenBudgetController({ storePath: p, flushDebounceMs: 0 });
    ctrl1.addRule(makeRule({ id: 'conflict', maxTokens: 100 }));
    await ctrl1.flush();

    const ctrl2 = createTokenBudgetController({
      storePath: p,
      rules: [makeRule({ id: 'conflict', maxTokens: 9999 })],
      flushDebounceMs: 0,
    });
    const rule = ctrl2.listRules().find((r) => r.id === 'conflict');
    expect(rule?.maxTokens).toBe(9999);
  });

  it('corrupt JSON file → starts fresh and logs warning', () => {
    const p = storePath('p4');
    writeFileSync(p, 'NOT_JSON', 'utf8');
    const logs: string[] = [];
    const ctrl = createTokenBudgetController({
      storePath: p,
      logger: (msg) => logs.push(msg),
      flushDebounceMs: 0,
    });
    expect(ctrl.listRules()).toHaveLength(0);
    expect(ctrl.reportSnapshot().totalConsumption).toBe(0);
    expect(logs.some((l) => l.includes('corrupt'))).toBe(true);
  });

  it('missing file → starts with empty state, no error thrown', () => {
    const p = storePath('p5');
    expect(() =>
      createTokenBudgetController({ storePath: p, flushDebounceMs: 0 }),
    ).not.toThrow();
  });

  it('flush is atomic: no partial writes visible', async () => {
    const p = storePath('p6');
    const ctrl = createTokenBudgetController({ storePath: p, flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'atomic' }));
    await ctrl.flush();
    // Verify no .tmp file left behind
    expect(existsSync(`${p}.tmp-`)).toBe(false);
    expect(existsSync(p)).toBe(true);
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('reset() with no arg clears all consumptions', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('r1'), flushDebounceMs: 0 });
    ctrl.recordConsumption(makeConsumption({ scope: 'global', promptTokens: 100, completionTokens: 0, costUsd: 0 }));
    ctrl.recordConsumption(makeConsumption({ scope: 'task', promptTokens: 200, completionTokens: 0, costUsd: 0 }));
    ctrl.reset();
    expect(ctrl.reportSnapshot().totalConsumption).toBe(0);
  });

  it('reset(scope) clears only that scope', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('r2'), flushDebounceMs: 0 });
    ctrl.recordConsumption(makeConsumption({ scope: 'global', promptTokens: 100, completionTokens: 0, costUsd: 0 }));
    ctrl.recordConsumption(makeConsumption({ scope: 'task', promptTokens: 200, completionTokens: 0, costUsd: 0 }));
    ctrl.reset('task');
    const snap = ctrl.reportSnapshot();
    // global 100 tokens remain
    expect(snap.totalConsumption).toBe(100);
  });

  it('reset re-enables warn threshold for the scope', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('r3'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'w-reset', maxTokens: 100, warnAtPercent: 80 }));
    const warnings: unknown[] = [];
    ctrl.on('warn', (p) => warnings.push(p));

    // Trigger warning
    ctrl.recordConsumption(makeConsumption({ promptTokens: 85, completionTokens: 0, costUsd: 0 }));
    expect(warnings).toHaveLength(1);

    // Reset global scope — should clear warned state
    ctrl.reset('global');
    ctrl.recordConsumption(makeConsumption({ promptTokens: 85, completionTokens: 0, costUsd: 0 }));
    expect(warnings).toHaveLength(2);
  });
});

// ── usageFor ──────────────────────────────────────────────────────────────────

describe('usageFor', () => {
  it('returns correct token and cost totals', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('u1'), flushDebounceMs: 0 });
    ctrl.recordConsumption(makeConsumption({ promptTokens: 100, completionTokens: 50, costUsd: 0.02 }));
    ctrl.recordConsumption(makeConsumption({ promptTokens: 200, completionTokens: 100, costUsd: 0.03 }));
    const usage = ctrl.usageFor(makeRule({ window: 'total' }));
    expect(usage.tokens).toBe(450);
    expect(usage.costUsd).toBeCloseTo(0.05, 5);
  });

  it('returns windowStart and windowEnd', () => {
    vi.useFakeTimers();
    const now = Date.UTC(2024, 5, 15, 10, 0, 0);
    vi.setSystemTime(now);
    const ctrl = createTokenBudgetController({
      storePath: storePath('u2'),
      flushDebounceMs: 99_999,
      clock: () => Date.now(),
    });
    const usage = ctrl.usageFor(makeRule({ window: 'hour' }));
    expect(usage.windowStart).toBe(now - 3_600_000);
    expect(usage.windowEnd).toBe(now);
  });

  it('does not count consumptions from other scopes', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('u3'), flushDebounceMs: 0 });
    ctrl.recordConsumption(makeConsumption({ scope: 'task', targetId: 'T1', promptTokens: 300, completionTokens: 0, costUsd: 0 }));
    ctrl.recordConsumption(makeConsumption({ scope: 'global', promptTokens: 100, completionTokens: 0, costUsd: 0 }));
    const usage = ctrl.usageFor(makeRule({ id: 'x', scope: 'task', window: 'total', targetId: 'T1' }));
    expect(usage.tokens).toBe(300);
  });
});

// ── reportSnapshot ────────────────────────────────────────────────────────────

describe('reportSnapshot', () => {
  it('includes percentUsed for each rule', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('s1'), flushDebounceMs: 0 });
    ctrl.addRule(makeRule({ id: 'pct', maxTokens: 1000 }));
    ctrl.recordConsumption(makeConsumption({ promptTokens: 300, completionTokens: 200, costUsd: 0 }));
    const snap = ctrl.reportSnapshot();
    const r = snap.rules.find((x) => x.rule.id === 'pct')!;
    expect(r.percentUsed).toBeCloseTo(50, 1);
  });

  it('sums totalCostUsd across all consumptions', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('s2'), flushDebounceMs: 0 });
    ctrl.recordConsumption(makeConsumption({ promptTokens: 0, completionTokens: 0, costUsd: 0.10 }));
    ctrl.recordConsumption(makeConsumption({ promptTokens: 0, completionTokens: 0, costUsd: 0.25 }));
    const snap = ctrl.reportSnapshot();
    expect(snap.totalCostUsd).toBeCloseTo(0.35, 5);
  });
});

// ── on / unsubscribe ──────────────────────────────────────────────────────────

describe('on / unsubscribe', () => {
  it('unsubscribe removes the listener', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('e1'), flushDebounceMs: 0 });
    const calls: unknown[] = [];
    const unsub = ctrl.on('consume', (p) => calls.push(p));
    ctrl.recordConsumption(makeConsumption());
    unsub();
    ctrl.recordConsumption(makeConsumption());
    expect(calls).toHaveLength(1);
  });

  it('multiple listeners on same event all fire', () => {
    const ctrl = createTokenBudgetController({ storePath: storePath('e2'), flushDebounceMs: 0 });
    const a: unknown[] = [];
    const b: unknown[] = [];
    ctrl.on('consume', (p) => a.push(p));
    ctrl.on('consume', (p) => b.push(p));
    ctrl.recordConsumption(makeConsumption());
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});
