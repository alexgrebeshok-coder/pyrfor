// @vitest-environment node
/**
 * cost-tracker.test.ts — tests for CostTracker (K7 module).
 *
 * All tests are pure in-memory — no I/O, no filesystem access.
 * Clock is injected to control timestamps deterministically.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createCostTracker,
  defaultProviderRates,
} from './cost-tracker.js';
import type {
  ProviderRates,
  CostTrackerOptions,
  BackpressureSignal,
} from './cost-tracker.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ANTHROPIC_RATES: ProviderRates = { inputUsdPerMTok: 3.0, outputUsdPerMTok: 15.0 };
const OPENAI_RATES: ProviderRates = { inputUsdPerMTok: 5.0, outputUsdPerMTok: 15.0 };

function makeTracker(opts: CostTrackerOptions = {}) {
  return createCostTracker({ clock: () => 1_000, ...opts });
}

function llmEvent(
  overrides: Partial<Parameters<ReturnType<typeof createCostTracker>['recordUsage']>[0]> = {},
) {
  return {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    usage: { tokensIn: 1_000, tokensOut: 500, costUsd: 0 },
    source: 'llm' as const,
    ...overrides,
  };
}

// ── 1. computeCost basic math ──────────────────────────────────────────────────

describe('computeCost', () => {
  it('calculates USD cost from token counts and rates', () => {
    const tracker = makeTracker();
    // 1M in * $3 + 0.5M out * $15 = $3 + $7.5 = $10.5
    const cost = tracker.computeCost({ tokensIn: 1_000_000, tokensOut: 500_000 }, ANTHROPIC_RATES);
    expect(cost).toBeCloseTo(10.5, 6);
  });

  it('returns 0 when both token counts are 0', () => {
    const tracker = makeTracker();
    expect(tracker.computeCost({ tokensIn: 0, tokensOut: 0 }, ANTHROPIC_RATES)).toBe(0);
  });

  it('clamps negative tokens to 0 in computeCost', () => {
    const tracker = makeTracker();
    const cost = tracker.computeCost({ tokensIn: -100, tokensOut: -200 }, ANTHROPIC_RATES);
    expect(cost).toBe(0);
  });
});

// ── 2. recordUsage — cost resolution ─────────────────────────────────────────

describe('recordUsage cost resolution', () => {
  it('uses provided costUsd if > 0', () => {
    const tracker = makeTracker();
    tracker.recordUsage(llmEvent({ usage: { tokensIn: 1000, tokensOut: 500, costUsd: 0.42 } }));
    const { session } = tracker.totals();
    expect(session.costUsd).toBeCloseTo(0.42, 6);
  });

  it('falls back to provider:model rates when costUsd = 0', () => {
    const tracker = makeTracker({
      rates: { 'anthropic:claude-3-5-sonnet-20241022': ANTHROPIC_RATES },
    });
    // 1000 in * 3/1e6 + 500 out * 15/1e6 = 0.003 + 0.0075 = 0.0105
    tracker.recordUsage(llmEvent({ usage: { tokensIn: 1000, tokensOut: 500, costUsd: 0 } }));
    expect(tracker.totals().session.costUsd).toBeCloseTo(0.0105, 6);
  });

  it('falls back to provider-level rates when no provider:model match', () => {
    const tracker = makeTracker({
      rates: { anthropic: ANTHROPIC_RATES },
    });
    tracker.recordUsage(
      llmEvent({
        model: 'unknown-model',
        usage: { tokensIn: 1000, tokensOut: 0, costUsd: 0 },
      }),
    );
    // 1000 * 3/1e6 = 0.003
    expect(tracker.totals().session.costUsd).toBeCloseTo(0.003, 6);
  });

  it('falls back to defaultRates when no explicit rate found', () => {
    const tracker = makeTracker({ defaultRates: OPENAI_RATES });
    // provider "mystery" has no entry in rates table
    tracker.recordUsage(
      llmEvent({
        provider: 'mystery',
        model: 'x1',
        usage: { tokensIn: 1_000_000, tokensOut: 0, costUsd: 0 },
      }),
    );
    expect(tracker.totals().session.costUsd).toBeCloseTo(5.0, 6);
  });

  it('returns cost=0 for unknown provider with no defaultRates', () => {
    const tracker = makeTracker();
    tracker.recordUsage(
      llmEvent({
        provider: 'totally-unknown',
        model: 'mystery',
        usage: { tokensIn: 999_999, tokensOut: 999_999, costUsd: 0 },
      }),
    );
    expect(tracker.totals().session.costUsd).toBe(0);
  });
});

// ── 3. Totals accumulation ─────────────────────────────────────────────────────

describe('totals accumulation', () => {
  it('session totals accumulate across multiple recordUsage calls', () => {
    const tracker = makeTracker({ defaultRates: ANTHROPIC_RATES });
    tracker.recordUsage(llmEvent({ usage: { tokensIn: 100, tokensOut: 50, costUsd: 0.001 } }));
    tracker.recordUsage(llmEvent({ usage: { tokensIn: 200, tokensOut: 100, costUsd: 0.002 } }));
    const { session } = tracker.totals();
    expect(session.tokensIn).toBe(300);
    expect(session.tokensOut).toBe(150);
    expect(session.costUsd).toBeCloseTo(0.003, 6);
  });

  it('task totals are isolated per taskId', () => {
    const tracker = makeTracker({ defaultRates: ANTHROPIC_RATES });
    tracker.startTask('t1');
    tracker.startTask('t2');
    tracker.recordUsage(llmEvent({ taskId: 't1', usage: { tokensIn: 100, tokensOut: 0, costUsd: 0.001 } }));
    tracker.recordUsage(llmEvent({ taskId: 't2', usage: { tokensIn: 200, tokensOut: 0, costUsd: 0.002 } }));

    const { task } = tracker.totals();
    expect(task['t1'].costUsd).toBeCloseTo(0.001, 6);
    expect(task['t2'].costUsd).toBeCloseTo(0.002, 6);
    expect(task['t1'].tokensIn).toBe(100);
    expect(task['t2'].tokensIn).toBe(200);
  });
});

// ── 4. startTask / endTask ────────────────────────────────────────────────────

describe('startTask / endTask', () => {
  it('endTask marks task inactive but totals remain accessible', () => {
    const tracker = makeTracker({ defaultRates: ANTHROPIC_RATES });
    tracker.startTask('task-a');
    tracker.recordUsage(llmEvent({ taskId: 'task-a', usage: { tokensIn: 500, tokensOut: 250, costUsd: 0.005 } }));
    tracker.endTask('task-a');

    const { task } = tracker.totals();
    expect(task['task-a']).toBeDefined();
    expect(task['task-a'].tokensIn).toBe(500);
    expect(task['task-a'].costUsd).toBeCloseTo(0.005, 6);
  });

  it('startTask is idempotent for already-active tasks', () => {
    const tracker = makeTracker();
    tracker.startTask('dup');
    tracker.recordUsage(llmEvent({ taskId: 'dup', usage: { tokensIn: 10, tokensOut: 0, costUsd: 0.001 } }));
    tracker.startTask('dup'); // no-op — should not reset totals
    expect(tracker.totals().task['dup'].tokensIn).toBe(10);
  });
});

// ── 5. Ring buffer ────────────────────────────────────────────────────────────

describe('ring buffer', () => {
  it('caps stored events at maxEvents and drops oldest', () => {
    const tracker = makeTracker({ maxEvents: 3, defaultRates: ANTHROPIC_RATES });
    for (let i = 0; i < 5; i++) {
      tracker.recordUsage(
        llmEvent({ model: `m${i}`, usage: { tokensIn: i, tokensOut: 0, costUsd: 0 } }),
      );
    }
    const evs = tracker.events();
    expect(evs).toHaveLength(3);
    // oldest two (m0, m1) dropped; newest three (m2, m3, m4) remain
    expect(evs.map((e) => e.model)).toEqual(['m2', 'm3', 'm4']);
  });

  it('maxEvents=0 → events() always empty but totals are tracked', () => {
    const tracker = makeTracker({ maxEvents: 0, defaultRates: ANTHROPIC_RATES });
    tracker.recordUsage(llmEvent({ usage: { tokensIn: 1000, tokensOut: 500, costUsd: 0.05 } }));
    expect(tracker.events()).toHaveLength(0);
    expect(tracker.totals().session.tokensIn).toBe(1000);
    expect(tracker.totals().session.costUsd).toBeCloseTo(0.05, 6);
  });
});

// ── 6. Backpressure signals ───────────────────────────────────────────────────

describe('backpressure signals', () => {
  it('returns [] when no budget is set', () => {
    const tracker = makeTracker(); // no budget
    const sigs = tracker.recordUsage(llmEvent({ usage: { tokensIn: 1e6, tokensOut: 1e6, costUsd: 999 } }));
    expect(sigs).toHaveLength(0);
  });

  it('ok — below warn threshold emits no signals', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0 } });
    // 0.79 < 0.8 threshold
    const sigs = tracker.recordUsage(
      llmEvent({ usage: { tokensIn: 0, tokensOut: 0, costUsd: 0.79 } }),
    );
    expect(sigs).toHaveLength(0);
  });

  it('warn — at 80% of session USD limit', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0 } });
    const sigs = tracker.recordUsage(
      llmEvent({ usage: { tokensIn: 0, tokensOut: 0, costUsd: 0.8 } }),
    );
    expect(sigs).toHaveLength(1);
    expect(sigs[0].level).toBe('warn');
    expect(sigs[0].scope).toBe('session');
    expect(sigs[0].metric).toBe('usd');
  });

  it('block — at 100% of session USD limit', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0 } });
    const sigs = tracker.recordUsage(
      llmEvent({ usage: { tokensIn: 0, tokensOut: 0, costUsd: 1.0 } }),
    );
    expect(sigs).toHaveLength(1);
    expect(sigs[0].level).toBe('block');
  });

  it('hard_stop — at default 3× session USD limit', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0 } });
    const sigs = tracker.recordUsage(
      llmEvent({ usage: { tokensIn: 0, tokensOut: 0, costUsd: 3.0 } }),
    );
    expect(sigs).toHaveLength(1);
    expect(sigs[0].level).toBe('hard_stop');
    expect(sigs[0].ratio).toBeCloseTo(3.0, 5);
  });

  it('custom hardStopMultiplier is respected', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0, hardStopMultiplier: 2 } });
    // 2.0 USD with 2× multiplier → hard_stop
    const sigs = tracker.recordUsage(
      llmEvent({ usage: { tokensIn: 0, tokensOut: 0, costUsd: 2.0 } }),
    );
    expect(sigs[0].level).toBe('hard_stop');
  });

  it('custom warnAtPct is respected', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0, warnAtPct: 0.5 } });
    // 0.6 > 0.5 warn threshold → warn (not ok)
    const sigs = tracker.recordUsage(
      llmEvent({ usage: { tokensIn: 0, tokensOut: 0, costUsd: 0.6 } }),
    );
    expect(sigs[0].level).toBe('warn');
  });

  it('task and session signals are independent', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 10.0, taskUsd: 1.0 } });
    tracker.startTask('t1');
    // task hits 100% (block) but session still < 80% (ok)
    const sigs = tracker.recordUsage(
      llmEvent({ taskId: 't1', usage: { tokensIn: 0, tokensOut: 0, costUsd: 1.0 } }),
    );
    expect(sigs).toHaveLength(1);
    expect(sigs[0].scope).toBe('task');
    expect(sigs[0].level).toBe('block');
  });

  it('returns only one signal per scope (worst wins)', () => {
    // Both USD and tokens are over budget; only the worst is returned per scope
    const tracker = makeTracker({
      budget: { sessionUsd: 1.0, sessionTokens: 100 },
    });
    // USD: 2× → block; tokens: 50 of 100 → ok (50%)
    const sigs = tracker.recordUsage(
      llmEvent({ usage: { tokensIn: 50, tokensOut: 0, costUsd: 2.0 } }),
    );
    const sessionSigs = sigs.filter((s) => s.scope === 'session');
    // Only one session signal, and it must be the worst (block from usd)
    expect(sessionSigs).toHaveLength(1);
    expect(sessionSigs[0].level).toBe('block');
    expect(sessionSigs[0].metric).toBe('usd');
  });

  it('only session budget set → no task signals emitted', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0 } });
    tracker.startTask('t');
    const sigs = tracker.recordUsage(
      llmEvent({ taskId: 't', usage: { tokensIn: 0, tokensOut: 0, costUsd: 5.0 } }),
    );
    expect(sigs.every((s) => s.scope === 'session')).toBe(true);
  });
});

// ── 7. onSignal callback ──────────────────────────────────────────────────────

describe('onSignal callback', () => {
  it('fires for non-ok signals', () => {
    const fired: BackpressureSignal[] = [];
    const tracker = makeTracker({
      budget: { sessionUsd: 1.0 },
      onSignal: (s) => fired.push(s),
    });
    tracker.recordUsage(llmEvent({ usage: { tokensIn: 0, tokensOut: 0, costUsd: 0.9 } }));
    expect(fired).toHaveLength(1);
    expect(fired[0].level).toBe('warn');
  });

  it('does NOT fire for ok signals', () => {
    const fired: BackpressureSignal[] = [];
    const tracker = makeTracker({
      budget: { sessionUsd: 1.0 },
      onSignal: (s) => fired.push(s),
    });
    tracker.recordUsage(llmEvent({ usage: { tokensIn: 0, tokensOut: 0, costUsd: 0.1 } }));
    expect(fired).toHaveLength(0);
  });
});

// ── 8. pressure() snapshot ────────────────────────────────────────────────────

describe('pressure()', () => {
  it('returns current backpressure snapshot without recording', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0, taskUsd: 0.5 } });
    tracker.startTask('snap');
    tracker.recordUsage(
      llmEvent({ taskId: 'snap', usage: { tokensIn: 0, tokensOut: 0, costUsd: 0.9 } }),
    );

    const p = tracker.pressure();
    expect(p.session).toHaveLength(1);
    expect(p.session[0].level).toBe('warn'); // 0.9/1.0 = 90% → warn
    expect(p.task).toBeDefined();
    expect(p.task![0].level).toBe('block'); // 0.9/0.5 = 180% → block
  });

  it('returns empty session array when no budget is set', () => {
    const tracker = makeTracker();
    const p = tracker.pressure();
    expect(p.session).toHaveLength(0);
    expect(p.task).toBeUndefined();
  });

  it('task is undefined when no active tasks', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0, taskUsd: 0.5 } });
    const p = tracker.pressure();
    expect(p.task).toBeUndefined();
  });
});

// ── 9. setBudget / getBudget ──────────────────────────────────────────────────

describe('setBudget / getBudget', () => {
  it('setBudget replaces existing budget and getBudget returns it', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 5.0 } });
    tracker.setBudget({ sessionUsd: 10.0, taskUsd: 2.0, warnAtPct: 0.7 });
    const b = tracker.getBudget();
    expect(b.sessionUsd).toBe(10.0);
    expect(b.taskUsd).toBe(2.0);
    expect(b.warnAtPct).toBe(0.7);
    // Old sessionUsd 5.0 is gone
    expect(b.sessionUsd).not.toBe(5.0);
  });

  it('getBudget returns a copy (mutations do not affect internal state)', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 1.0 } });
    const b = tracker.getBudget();
    b.sessionUsd = 9999;
    expect(tracker.getBudget().sessionUsd).toBe(1.0);
  });
});

// ── 10. reset() ──────────────────────────────────────────────────────────────

describe('reset()', () => {
  it('clears events, totals, and active tasks but preserves budget', () => {
    const tracker = makeTracker({ budget: { sessionUsd: 5.0 } });
    tracker.startTask('tx');
    tracker.recordUsage(llmEvent({ taskId: 'tx', usage: { tokensIn: 100, tokensOut: 50, costUsd: 0.1 } }));

    tracker.reset();

    expect(tracker.events()).toHaveLength(0);
    expect(tracker.totals().session.costUsd).toBe(0);
    expect(tracker.totals().task).toEqual({});
    // Budget survives reset
    expect(tracker.getBudget().sessionUsd).toBe(5.0);
    // Active task was cleared
    expect(tracker.pressure().task).toBeUndefined();
  });
});

// ── 11. defaultProviderRates ──────────────────────────────────────────────────

describe('defaultProviderRates()', () => {
  it('contains keys for all four required providers', () => {
    const rates = defaultProviderRates();
    expect(rates['anthropic']).toBeDefined();
    expect(rates['openai']).toBeDefined();
    expect(rates['zhipu']).toBeDefined();
    expect(rates['ollama']).toBeDefined();
  });

  it('ollama has zero cost (local model)', () => {
    const rates = defaultProviderRates();
    expect(rates['ollama'].inputUsdPerMTok).toBe(0);
    expect(rates['ollama'].outputUsdPerMTok).toBe(0);
  });

  it('anthropic provider-level fallback rates are non-zero', () => {
    const rates = defaultProviderRates();
    expect(rates['anthropic'].inputUsdPerMTok).toBeGreaterThan(0);
    expect(rates['anthropic'].outputUsdPerMTok).toBeGreaterThan(0);
  });

  it('contains named anthropic and openai model keys', () => {
    const rates = defaultProviderRates();
    expect(rates['anthropic:claude-3-5-sonnet-20241022']).toBeDefined();
    expect(rates['openai:gpt-4o']).toBeDefined();
  });
});

// ── 12. Clock injection ───────────────────────────────────────────────────────

describe('clock injection', () => {
  it('uses injected clock for event timestamps', () => {
    let tick = 42_000;
    const tracker = createCostTracker({
      clock: () => tick,
      defaultRates: ANTHROPIC_RATES,
    });

    tracker.recordUsage(llmEvent());
    tick = 99_000;
    tracker.recordUsage(llmEvent());

    const evs = tracker.events();
    expect(evs[0].ts).toBe(42_000);
    expect(evs[1].ts).toBe(99_000);
  });
});

// ── 13. Negative token clamping ───────────────────────────────────────────────

describe('negative token clamping', () => {
  it('clamps negative tokensIn/Out to 0 in recordUsage', () => {
    const tracker = makeTracker({ defaultRates: ANTHROPIC_RATES });
    tracker.recordUsage(
      llmEvent({ usage: { tokensIn: -500, tokensOut: -200, costUsd: 0 } }),
    );
    const { session } = tracker.totals();
    expect(session.tokensIn).toBe(0);
    expect(session.tokensOut).toBe(0);
    expect(session.costUsd).toBe(0);
  });

  it('negative tokens with provided costUsd still record the costUsd', () => {
    const tracker = makeTracker();
    tracker.recordUsage(
      llmEvent({ usage: { tokensIn: -1000, tokensOut: -500, costUsd: 0.05 } }),
    );
    const { session } = tracker.totals();
    expect(session.tokensIn).toBe(0);
    expect(session.tokensOut).toBe(0);
    expect(session.costUsd).toBeCloseTo(0.05, 6);
  });
});

// ── 14. events() filtering ────────────────────────────────────────────────────

describe('events() filtering', () => {
  it('filters by taskId', () => {
    const tracker = makeTracker();
    tracker.recordUsage(llmEvent({ taskId: 'alpha' }));
    tracker.recordUsage(llmEvent({ taskId: 'beta' }));
    tracker.recordUsage(llmEvent({ taskId: 'alpha' }));

    const alphaEvs = tracker.events({ taskId: 'alpha' });
    expect(alphaEvs).toHaveLength(2);
    expect(alphaEvs.every((e) => e.taskId === 'alpha')).toBe(true);
  });

  it('filters by sinceMs (inclusive)', () => {
    let tick = 1000;
    const tracker = createCostTracker({ clock: () => tick });
    tracker.recordUsage(llmEvent()); // ts=1000
    tick = 2000;
    tracker.recordUsage(llmEvent()); // ts=2000
    tick = 3000;
    tracker.recordUsage(llmEvent()); // ts=3000

    const result = tracker.events({ sinceMs: 2000 });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.ts >= 2000)).toBe(true);
  });
});

// ── 15. Multiple simultaneous tasks ──────────────────────────────────────────

describe('multiple simultaneous tasks', () => {
  it('tracks multiple active tasks concurrently', () => {
    const tracker = makeTracker({ budget: { taskUsd: 1.0 }, defaultRates: ANTHROPIC_RATES });
    tracker.startTask('taskA');
    tracker.startTask('taskB');

    tracker.recordUsage(llmEvent({ taskId: 'taskA', usage: { tokensIn: 0, tokensOut: 0, costUsd: 0.5 } }));
    tracker.recordUsage(llmEvent({ taskId: 'taskB', usage: { tokensIn: 0, tokensOut: 0, costUsd: 0.9 } }));

    const { task } = tracker.totals();
    expect(task['taskA'].costUsd).toBeCloseTo(0.5, 6);
    expect(task['taskB'].costUsd).toBeCloseTo(0.9, 6);

    // pressure() shows task B at 90% (warn) — worst across active tasks
    const p = tracker.pressure();
    expect(p.task).toBeDefined();
    // Both tasks are active; worst is B at block level (0.9 ≥ 0.8 → warn, < 1.0)
    const blockOrWarn = p.task!.some((s) => s.level === 'warn');
    expect(blockOrWarn).toBe(true);
  });
});
