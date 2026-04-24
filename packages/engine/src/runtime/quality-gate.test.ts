// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createQualityGate,
  defaultInjectionTemplate,
  strongestVerdict,
} from './quality-gate.js';
import type { ValidatorResult, InjectionContext } from './quality-gate.js';
import type { AcpEvent } from './acp-client.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvent(overrides?: Partial<AcpEvent>): AcpEvent {
  return {
    sessionId: 'sess-1',
    type: 'tool_call',
    data: { tool: 'edit', file: 'foo.ts' },
    ts: 1_700_000_000_000,
    ...overrides,
  };
}

function result(
  verdict: ValidatorResult['verdict'],
  extra?: Partial<ValidatorResult>,
): ValidatorResult {
  return {
    validator: 'test-validator',
    verdict,
    message: `verdict is ${verdict}`,
    durationMs: 10,
    ...extra,
  };
}

const EVENT_A = makeEvent({ ts: 1 });
const EVENT_B = makeEvent({ ts: 2, data: { tool: 'read', file: 'bar.ts' } });

// ── Helper: gate with fresh state ─────────────────────────────────────────────

function gate(cfg: Parameters<typeof createQualityGate>[0] = { sessionId: 'sess-1' }) {
  return createQualityGate({ sessionId: 'sess-1', ...cfg });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. strongestVerdict utility
// ─────────────────────────────────────────────────────────────────────────────

describe('strongestVerdict', () => {
  it('returns pass for empty list', () => {
    expect(strongestVerdict([])).toBe('pass');
  });

  it('returns the highest severity verdict', () => {
    expect(strongestVerdict(['pass', 'warn', 'correct'])).toBe('correct');
    expect(strongestVerdict(['pass', 'block'])).toBe('block');
    expect(strongestVerdict(['warn', 'correct', 'block'])).toBe('block');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Pass verdict → continue
// ─────────────────────────────────────────────────────────────────────────────

describe('pass verdict', () => {
  it('returns continue action', async () => {
    const g = gate();
    const d = await g.evaluate(EVENT_A, [result('pass')]);
    expect(d.action).toBe('continue');
    expect(d.attempt).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Warn verdict (default, no warnIsCorrection)
// ─────────────────────────────────────────────────────────────────────────────

describe('warn verdict', () => {
  it('returns continue by default', async () => {
    const g = gate();
    const d = await g.evaluate(EVENT_A, [result('warn')]);
    expect(d.action).toBe('continue');
  });

  it('returns inject_correction when warnIsCorrection=true', async () => {
    const g = gate({ sessionId: 'sess-1', warnIsCorrection: true });
    const d = await g.evaluate(EVENT_A, [result('warn')]);
    expect(d.action).toBe('inject_correction');
    expect(d.attempt).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Correct verdict — basic flow
// ─────────────────────────────────────────────────────────────────────────────

describe('correct verdict', () => {
  it('returns inject_correction with attempt=1 on first call', async () => {
    const g = gate();
    const d = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    expect(d.action).toBe('inject_correction');
    expect(d.attempt).toBe(1);
    expect(d.injection).toBeTruthy();
  });

  it('2nd correct same eventId → attempt=2, still inject_correction', async () => {
    const g = gate();
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    const d = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    expect(d.action).toBe('inject_correction');
    expect(d.attempt).toBe(2);
  });

  it('3rd correct same eventId → attempt=3 still injection; 4th → block (per-event exceeded)', async () => {
    const g = gate({ sessionId: 'sess-1', maxCorrectAttemptsPerEvent: 3 });
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    const third = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    expect(third.action).toBe('inject_correction');
    expect(third.attempt).toBe(3);

    const fourth = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    expect(fourth.action).toBe('block');
    expect(fourth.reason).toContain('exceeded auto-fix budget');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Block verdict from validator
// ─────────────────────────────────────────────────────────────────────────────

describe('block verdict from validator', () => {
  it('immediately sets blocked and returns block action', async () => {
    const g = gate();
    const d = await g.evaluate(EVENT_A, [result('block')]);
    expect(d.action).toBe('block');
    expect(g.state().blocked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Session-wide cap
// ─────────────────────────────────────────────────────────────────────────────

describe('session-wide correction cap', () => {
  it('blocks when maxCorrectAttemptsPerSession reached across different events', async () => {
    const g = gate({ sessionId: 'sess-1', maxCorrectAttemptsPerSession: 2 });
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-1' });
    await g.evaluate(EVENT_B, [result('correct')], { eventId: 'ev-2' });
    // third correction — different event, but session cap=2
    const d = await g.evaluate(makeEvent({ ts: 3 }), [result('correct')], { eventId: 'ev-3' });
    expect(d.action).toBe('block');
    expect(g.state().blocked).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Token budget
// ─────────────────────────────────────────────────────────────────────────────

describe('token budget', () => {
  it('blocks when tokensUsed >= budgetTokens', async () => {
    const g = gate({ sessionId: 'sess-1', budgetTokens: 500 });
    // Accumulate tokens via opts
    const d = await g.evaluate(EVENT_A, [result('correct')], {
      eventId: 'ev-a',
      tokensUsed: 600,
    });
    // First correction attempt but budget exceeded on this same call
    // tokensUsed is updated BEFORE budget check
    expect(d.action).toBe('block');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. defaultInjectionTemplate
// ─────────────────────────────────────────────────────────────────────────────

describe('defaultInjectionTemplate', () => {
  it('includes attempt number', () => {
    const ctx: InjectionContext = {
      event: EVENT_A,
      results: [result('correct', { message: 'lint error', remediation: 'fix it' })],
      attempt: 2,
    };
    const out = defaultInjectionTemplate(ctx);
    expect(out).toContain('attempt 2');
    expect(out).toContain('lint error');
    expect(out).toContain('fix it');
  });

  it('does not include pass/warn results', () => {
    const ctx: InjectionContext = {
      event: EVENT_A,
      results: [result('pass', { message: 'ok' }), result('correct', { message: 'bad' })],
      attempt: 1,
    };
    const out = defaultInjectionTemplate(ctx);
    expect(out).not.toContain('[test-validator] ok');
    expect(out).toContain('[test-validator] bad');
  });

  it('includes ceoContext block when provided', () => {
    const ctx: InjectionContext = {
      event: EVENT_A,
      results: [result('correct')],
      attempt: 1,
      ceoContext: 'repo: ceoclaw-dev',
    };
    const out = defaultInjectionTemplate(ctx);
    expect(out).toContain('repo: ceoclaw-dev');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Custom injectionTemplate
// ─────────────────────────────────────────────────────────────────────────────

describe('custom injectionTemplate', () => {
  it('uses provided template instead of default', async () => {
    const customFn = vi.fn((_ctx: InjectionContext) => 'CUSTOM_PROMPT');
    const g = gate({ sessionId: 'sess-1', injectionTemplate: customFn });
    const d = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    expect(d.injection).toBe('CUSTOM_PROMPT');
    expect(customFn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. ceoClawContext — sync + async
// ─────────────────────────────────────────────────────────────────────────────

describe('ceoClawContext', () => {
  it('sync ceoClawContext is inserted into injection', async () => {
    const g = gate({
      sessionId: 'sess-1',
      ceoClawContext: () => 'sync-context',
    });
    const d = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    expect(d.injection).toContain('sync-context');
  });

  it('async ceoClawContext is inserted into injection', async () => {
    const g = gate({
      sessionId: 'sess-1',
      ceoClawContext: async () => 'async-context',
    });
    const d = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    expect(d.injection).toContain('async-context');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. llmFn enrichment
// ─────────────────────────────────────────────────────────────────────────────

describe('llmFn enrichment', () => {
  it('is called when at least one correct result lacks remediation', async () => {
    const llmFn = vi.fn(async (_p: string) => 'LLM_ENRICHED');
    const g = gate({ sessionId: 'sess-1', llmFn });
    // result with no remediation
    const d = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    expect(llmFn).toHaveBeenCalledOnce();
    expect(d.injection).toBe('LLM_ENRICHED');
  });

  it('is NOT called when all correct results already have remediation', async () => {
    const llmFn = vi.fn(async (_p: string) => 'LLM_ENRICHED');
    const g = gate({ sessionId: 'sess-1', llmFn });
    const r = result('correct', { remediation: 'already provided' });
    await g.evaluate(EVENT_A, [r], { eventId: 'ev-a' });
    expect(llmFn).not.toHaveBeenCalled();
  });

  it('llmFn throws → no propagation, uses template injection', async () => {
    const llmFn = vi.fn(async () => {
      throw new Error('LLM unavailable');
    });
    const g = gate({ sessionId: 'sess-1', llmFn });
    const d = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-a' });
    expect(d.action).toBe('inject_correction');
    // injection falls back to template (not LLM output)
    expect(d.injection).toContain('PYRFOR QUALITY GATE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. requireUser flag
// ─────────────────────────────────────────────────────────────────────────────

describe('requireUser flag', () => {
  it('returns request_user when any result has details.requireUser=true', async () => {
    const g = gate();
    const r = result('correct', { details: { requireUser: true } });
    const d = await g.evaluate(EVENT_A, [r]);
    expect(d.action).toBe('request_user');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Empty results
// ─────────────────────────────────────────────────────────────────────────────

describe('empty results', () => {
  it('returns continue with reason "no validators applied"', async () => {
    const g = gate();
    const d = await g.evaluate(EVENT_A, []);
    expect(d.action).toBe('continue');
    expect(d.reason).toBe('no validators applied');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. Once blocked, further evaluate calls return block
// ─────────────────────────────────────────────────────────────────────────────

describe('blocked state persistence', () => {
  it('returns block for all subsequent evaluations after first block', async () => {
    const g = gate();
    await g.evaluate(EVENT_A, [result('block')]);
    const d2 = await g.evaluate(EVENT_B, [result('pass')]);
    expect(d2.action).toBe('block');
    const d3 = await g.evaluate(EVENT_B, [result('correct')]);
    expect(d3.action).toBe('block');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. override('unblock')
// ─────────────────────────────────────────────────────────────────────────────

describe('override unblock', () => {
  it('re-enables evaluation after block', async () => {
    const g = gate();
    await g.evaluate(EVENT_A, [result('block')]);
    expect(g.state().blocked).toBe(true);
    g.override('unblock');
    expect(g.state().blocked).toBe(false);
    const d = await g.evaluate(EVENT_B, [result('pass')]);
    expect(d.action).toBe('continue');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. override('reset_event_attempts')
// ─────────────────────────────────────────────────────────────────────────────

describe('override reset_event_attempts', () => {
  it('lowers per-event count so correction can happen again', async () => {
    const g = gate({ sessionId: 'sess-1', maxCorrectAttemptsPerEvent: 2 });
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-x' });
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-x' });
    // Next would block (2 attempts used = maxPerEvent)
    const blocked = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-x' });
    expect(blocked.action).toBe('block');

    // Unblock + reset per-event
    g.override('unblock');
    g.override('reset_event_attempts', { eventId: 'ev-x' });

    expect(g.state().perEventAttempts.has('ev-x')).toBe(false);
    // Should now be injectable again (session total still counts, but < cap)
    const d = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-x' });
    expect(d.action).toBe('inject_correction');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. state() returns snapshot with counters
// ─────────────────────────────────────────────────────────────────────────────

describe('state()', () => {
  it('returns shallow snapshot reflecting current counters', async () => {
    const g = gate({ sessionId: 'sess-99' });
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-s' });
    const s = g.state();
    expect(s.sessionId).toBe('sess-99'); // passed sessionId wins over helper default
    expect(s.totalCorrections).toBe(1);
    expect(s.perEventAttempts.get('ev-s')).toBe(1);
    expect(s.blocked).toBe(false);
  });

  it('state() returns a copy — mutations do not affect internal state', async () => {
    const g = gate();
    const s = g.state();
    s.totalCorrections = 999;
    expect(g.state().totalCorrections).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. reset() zeroes all state
// ─────────────────────────────────────────────────────────────────────────────

describe('reset()', () => {
  it('zeroes counters, history, and unblocks', async () => {
    const g = gate();
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-r' });
    await g.evaluate(EVENT_A, [result('block')]);
    g.reset();
    const s = g.state();
    expect(s.totalCorrections).toBe(0);
    expect(s.blocked).toBe(false);
    expect(s.history).toHaveLength(0);
    expect(s.perEventAttempts.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. History capped at 100
// ─────────────────────────────────────────────────────────────────────────────

describe('history cap', () => {
  it('never exceeds 100 entries', async () => {
    const g = gate({ sessionId: 'sess-1', maxCorrectAttemptsPerSession: 9999, maxCorrectAttemptsPerEvent: 9999 });
    for (let i = 0; i < 110; i++) {
      await g.evaluate(makeEvent({ ts: i, data: { i } }), [result('pass')]);
    }
    expect(g.state().history.length).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. remainingPerEvent / remainingPerSession counters
// ─────────────────────────────────────────────────────────────────────────────

describe('remaining counters', () => {
  it('decrements correctly after each injection', async () => {
    const g = gate({
      sessionId: 'sess-1',
      maxCorrectAttemptsPerEvent: 3,
      maxCorrectAttemptsPerSession: 10,
    });
    const d1 = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-c' });
    expect(d1.remainingPerEvent).toBe(2);
    expect(d1.remainingPerSession).toBe(9);

    const d2 = await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-c' });
    expect(d2.remainingPerEvent).toBe(1);
    expect(d2.remainingPerSession).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. Stable auto-derived eventId (hash)
// ─────────────────────────────────────────────────────────────────────────────

describe('auto-derived eventId hashing', () => {
  it('same event produces same eventId across multiple calls', async () => {
    const g = gate({ sessionId: 'sess-1', maxCorrectAttemptsPerEvent: 5 });
    // Two identical events without providing explicit eventId
    const ev = makeEvent({ ts: 42_000, type: 'diff', data: { patch: 'abc' } });
    await g.evaluate(ev, [result('correct')]);
    const d2 = await g.evaluate(ev, [result('correct')]);
    // attempt 2 means the same key was resolved both times
    expect(d2.attempt).toBe(2);
  });

  it('different events hash to different ids', async () => {
    const g = gate({ sessionId: 'sess-1', maxCorrectAttemptsPerEvent: 5 });
    const evA = makeEvent({ ts: 1, data: { x: 1 } });
    const evB = makeEvent({ ts: 2, data: { x: 2 } });
    const dA = await g.evaluate(evA, [result('correct')]);
    const dB = await g.evaluate(evB, [result('correct')]);
    expect(dA.attempt).toBe(1);
    expect(dB.attempt).toBe(1); // different event → fresh count
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. logger is called on relevant events
// ─────────────────────────────────────────────────────────────────────────────

describe('logger integration', () => {
  it('calls logger on injection and block', async () => {
    const logger = vi.fn();
    const g = gate({ sessionId: 'sess-1', logger, maxCorrectAttemptsPerEvent: 1 });
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-log' });
    expect(logger).toHaveBeenCalledWith('info', expect.stringContaining('injecting'), expect.anything());
    // Next call should exceed budget and block
    await g.evaluate(EVENT_A, [result('correct')], { eventId: 'ev-log' });
    expect(logger).toHaveBeenCalledWith('warn', expect.stringContaining('quality-gate'), expect.anything());
  });
});
