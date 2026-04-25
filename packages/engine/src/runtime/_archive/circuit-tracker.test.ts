// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { createCircuitTracker } from './circuit-tracker';
import type { CircuitTracker, StateChangeEvent } from './circuit-tracker';

// ─── Clock + timer helpers ────────────────────────────────────────────────────

function makeEnv() {
  let now = 1_000_000;
  const timers: Array<{ id: number; fireAt: number; cb: () => void; cancelled: boolean }> = [];
  let nextId = 1;

  const clock = () => now;
  const setTimer = (cb: () => void, ms: number): number => {
    const id = nextId++;
    timers.push({ id, fireAt: now + ms, cb, cancelled: false });
    return id;
  };
  const clearTimer = (h: unknown) => {
    const t = timers.find((t) => t.id === (h as number));
    if (t) t.cancelled = true;
  };

  const advance = (ms: number) => {
    const target = now + ms;
    // fire in order
    const pending = timers
      .filter((t) => !t.cancelled && t.fireAt <= target)
      .sort((a, b) => a.fireAt - b.fireAt);
    for (const t of pending) {
      if (t.cancelled) continue;
      now = t.fireAt;
      t.cancelled = true; // fire once
      t.cb();
    }
    now = target;
  };

  return { clock, setTimer, clearTimer, advance, getTime: () => now };
}

function makeTracker(opts: Parameters<typeof createCircuitTracker>[0] = {}) {
  const env = makeEnv();
  const tracker = createCircuitTracker({
    failureThreshold: 3,
    successThreshold: 2,
    openMs: 10_000,
    halfOpenMaxConcurrent: 1,
    windowMs: 30_000,
    ...opts,
    clock: opts.clock ?? env.clock,
    setTimer: opts.setTimer ?? env.setTimer,
    clearTimer: opts.clearTimer ?? env.clearTimer,
  });
  return { tracker, env };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('closed → open after threshold failures', () => {
  it('trips to open after failureThreshold failures', () => {
    const { tracker } = makeTracker();
    tracker.record('svc', 'failure');
    tracker.record('svc', 'failure');
    expect(tracker.state('svc').state).toBe('closed');
    tracker.record('svc', 'failure');
    expect(tracker.state('svc').state).toBe('open');
  });

  it('counts timeout outcomes toward failure threshold', () => {
    const { tracker } = makeTracker();
    tracker.record('svc', 'timeout');
    tracker.record('svc', 'timeout');
    tracker.record('svc', 'timeout');
    expect(tracker.state('svc').state).toBe('open');
  });

  it('does not trip when successes interleave below threshold', () => {
    const { tracker } = makeTracker();
    tracker.record('svc', 'failure');
    tracker.record('svc', 'success');
    tracker.record('svc', 'failure');
    tracker.record('svc', 'success');
    expect(tracker.state('svc').state).toBe('closed');
  });
});

describe('sliding window: ignores failures outside windowMs', () => {
  it('evicts old failures that fall outside the window', () => {
    const { tracker, env } = makeTracker({ failureThreshold: 3, windowMs: 30_000 });
    tracker.record('svc', 'failure');
    tracker.record('svc', 'failure');
    env.advance(31_000); // old failures now outside the window
    tracker.record('svc', 'failure'); // only 1 in window now
    expect(tracker.state('svc').state).toBe('closed');
  });

  it('trips if threshold failures all fall within windowMs', () => {
    const { tracker, env } = makeTracker({ failureThreshold: 3, windowMs: 30_000 });
    tracker.record('svc', 'failure');
    env.advance(5_000);
    tracker.record('svc', 'failure');
    env.advance(5_000);
    tracker.record('svc', 'failure');
    expect(tracker.state('svc').state).toBe('open');
  });
});

describe('half_open after openMs', () => {
  it('transitions open → half_open after openMs elapses', () => {
    const { tracker, env } = makeTracker({ openMs: 10_000 });
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    expect(tracker.state('svc').state).toBe('open');
    env.advance(10_000);
    expect(tracker.state('svc').state).toBe('half_open');
  });

  it('does not transition before openMs', () => {
    const { tracker, env } = makeTracker({ openMs: 10_000 });
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(9_999);
    expect(tracker.state('svc').state).toBe('open');
  });
});

describe('half_open: limits concurrent calls', () => {
  it('allows up to halfOpenMaxConcurrent=1 calls', () => {
    const { tracker, env } = makeTracker({ halfOpenMaxConcurrent: 1 });
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    expect(tracker.canExecute('svc')).toEqual({ ok: true });
  });

  it('blocks second concurrent call in half_open', () => {
    const { tracker, env } = makeTracker({ halfOpenMaxConcurrent: 1 });
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    // simulate first call in flight: directly bump inFlight via wrap not resolving yet
    const p = tracker.wrap('svc', () => new Promise(() => {})); // never resolves
    expect(tracker.canExecute('svc')).toEqual({ ok: false, reason: 'half_open_full' });
    void p; // suppress unhandled
  });

  it('allows halfOpenMaxConcurrent=2', () => {
    const { tracker, env } = makeTracker({ halfOpenMaxConcurrent: 2 });
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    void tracker.wrap('svc', () => new Promise(() => {}));
    expect(tracker.canExecute('svc')).toEqual({ ok: true });
    void tracker.wrap('svc', () => new Promise(() => {}));
    expect(tracker.canExecute('svc')).toEqual({ ok: false, reason: 'half_open_full' });
  });
});

describe('half_open → closed after successThreshold consecutive successes', () => {
  it('closes after successThreshold successes', () => {
    const { tracker, env } = makeTracker({ successThreshold: 2 });
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    expect(tracker.state('svc').state).toBe('half_open');
    tracker.record('svc', 'success');
    expect(tracker.state('svc').state).toBe('half_open');
    tracker.record('svc', 'success');
    expect(tracker.state('svc').state).toBe('closed');
  });

  it('resets consecutive successes after single failure in half_open', () => {
    const { tracker, env } = makeTracker({ successThreshold: 2 });
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    tracker.record('svc', 'success');
    tracker.record('svc', 'failure'); // re-opens
    expect(tracker.state('svc').state).toBe('open');
  });
});

describe('half_open → open immediately on failure', () => {
  it('one failure in half_open reopens the circuit', () => {
    const { tracker, env } = makeTracker();
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    tracker.record('svc', 'failure');
    expect(tracker.state('svc').state).toBe('open');
  });

  it('emits open event when half_open → open', () => {
    const { tracker, env } = makeTracker();
    const events: StateChangeEvent[] = [];
    tracker.onStateChange((e) => events.push(e));
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    tracker.record('svc', 'failure');
    const last = events[events.length - 1];
    expect(last.from).toBe('half_open');
    expect(last.to).toBe('open');
  });
});

describe('forceOpen + forceClose', () => {
  it('forceOpen opens a closed circuit', () => {
    const { tracker } = makeTracker();
    tracker.forceOpen('svc');
    expect(tracker.state('svc').state).toBe('open');
  });

  it('forceOpen with custom ms transitions to half_open after that ms', () => {
    const { tracker, env } = makeTracker();
    tracker.forceOpen('svc', 5_000);
    env.advance(5_000);
    expect(tracker.state('svc').state).toBe('half_open');
  });

  it('forceClose closes an open circuit', () => {
    const { tracker, env } = makeTracker();
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    expect(tracker.state('svc').state).toBe('half_open');
    tracker.forceClose('svc');
    expect(tracker.state('svc').state).toBe('closed');
  });

  it('forceClose emits state change event', () => {
    const { tracker } = makeTracker();
    const events: StateChangeEvent[] = [];
    tracker.onStateChange((e) => events.push(e));
    tracker.forceOpen('svc');
    tracker.forceClose('svc');
    expect(events[events.length - 1].to).toBe('closed');
  });
});

describe('reset', () => {
  it('reset(key) clears state for that key', () => {
    const { tracker } = makeTracker();
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    expect(tracker.state('svc').state).toBe('open');
    tracker.reset('svc');
    expect(tracker.state('svc').state).toBe('closed');
    expect(tracker.state('svc').failures).toBe(0);
  });

  it('reset() clears all keys', () => {
    const { tracker } = makeTracker();
    for (let i = 0; i < 3; i++) {
      tracker.record('a', 'failure');
      tracker.record('b', 'failure');
    }
    tracker.reset();
    expect(tracker.state('a').state).toBe('closed');
    expect(tracker.state('b').state).toBe('closed');
  });

  it('reset does not affect other keys', () => {
    const { tracker } = makeTracker();
    for (let i = 0; i < 3; i++) {
      tracker.record('a', 'failure');
      tracker.record('b', 'failure');
    }
    tracker.reset('a');
    expect(tracker.state('a').state).toBe('closed');
    expect(tracker.state('b').state).toBe('open');
  });
});

describe('onStateChange', () => {
  it('fires on closed → open', () => {
    const { tracker } = makeTracker();
    const events: StateChangeEvent[] = [];
    tracker.onStateChange((e) => events.push(e));
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ key: 'svc', from: 'closed', to: 'open' });
  });

  it('fires on open → half_open', () => {
    const { tracker, env } = makeTracker();
    const events: StateChangeEvent[] = [];
    tracker.onStateChange((e) => events.push(e));
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    expect(events[events.length - 1]).toMatchObject({ from: 'open', to: 'half_open' });
  });

  it('fires on half_open → closed', () => {
    const { tracker, env } = makeTracker({ successThreshold: 2 });
    const events: StateChangeEvent[] = [];
    tracker.onStateChange((e) => events.push(e));
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    env.advance(10_000);
    tracker.record('svc', 'success');
    tracker.record('svc', 'success');
    expect(events[events.length - 1]).toMatchObject({ from: 'half_open', to: 'closed' });
  });

  it('unsubscribe stops receiving events', () => {
    const { tracker } = makeTracker();
    const events: StateChangeEvent[] = [];
    const unsub = tracker.onStateChange((e) => events.push(e));
    unsub();
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    expect(events).toHaveLength(0);
  });

  it('includes correct at timestamp', () => {
    const { tracker, env } = makeTracker();
    const events: StateChangeEvent[] = [];
    tracker.onStateChange((e) => events.push(e));
    env.advance(1_000);
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    expect(events[0].at).toBe(env.getTime());
  });
});

describe('p50/p95 latency', () => {
  it('calculates p50 and p95 from samples', () => {
    const { tracker } = makeTracker();
    for (let i = 1; i <= 100; i++) tracker.record('svc', 'success', { latencyMs: i });
    const s = tracker.state('svc');
    expect(s.p50LatencyMs).toBe(50);
    expect(s.p95LatencyMs).toBe(95);
  });

  it('undefined when no latency samples recorded', () => {
    const { tracker } = makeTracker();
    tracker.record('svc', 'success');
    const s = tracker.state('svc');
    expect(s.p50LatencyMs).toBeUndefined();
    expect(s.p95LatencyMs).toBeUndefined();
  });

  it('keeps only last 100 samples (evicts oldest)', () => {
    const { tracker } = makeTracker();
    // first 10 samples: value 1 (will be evicted when capped to 100)
    // next 100 samples: last 10 (i=100..109) are 9999, rest are 1
    // after eviction: 90 samples of 1, 10 samples of 9999 → p95 = 9999
    for (let i = 0; i < 110; i++) tracker.record('svc', 'success', { latencyMs: i >= 100 ? 9999 : 1 });
    const s = tracker.state('svc');
    expect(s.p95LatencyMs).toBe(9999);
  });
});

describe('wrap()', () => {
  it('rejects with circuit_open when circuit is open', async () => {
    const { tracker } = makeTracker();
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    await expect(tracker.wrap('svc', async () => 'val')).rejects.toThrow('circuit_open');
  });

  it('records success on resolve', async () => {
    const { tracker } = makeTracker();
    await tracker.wrap('svc', async () => 42);
    expect(tracker.state('svc').successes).toBe(1);
  });

  it('records failure on reject', async () => {
    const { tracker } = makeTracker();
    await expect(tracker.wrap('svc', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(tracker.state('svc').failures).toBe(1);
  });

  it('returns resolved value', async () => {
    const { tracker } = makeTracker();
    const result = await tracker.wrap('svc', async () => 'hello');
    expect(result).toBe('hello');
  });
});

describe('mixed keys are isolated', () => {
  it('tripping one key does not affect another', () => {
    const { tracker } = makeTracker();
    for (let i = 0; i < 3; i++) tracker.record('svc-a', 'failure');
    expect(tracker.state('svc-a').state).toBe('open');
    expect(tracker.state('svc-b').state).toBe('closed');
  });

  it('canExecute respects per-key state', () => {
    const { tracker } = makeTracker();
    for (let i = 0; i < 3; i++) tracker.record('svc-a', 'failure');
    expect(tracker.canExecute('svc-a').ok).toBe(false);
    expect(tracker.canExecute('svc-b').ok).toBe(true);
  });
});

describe('snapshot()', () => {
  it('returns state for all recorded keys', () => {
    const { tracker } = makeTracker();
    tracker.record('alpha', 'success');
    tracker.record('beta', 'failure');
    const snap = tracker.snapshot();
    expect(Object.keys(snap)).toContain('alpha');
    expect(Object.keys(snap)).toContain('beta');
  });

  it('returns a deep copy (mutations do not affect internal state)', () => {
    const { tracker } = makeTracker();
    tracker.record('svc', 'success');
    const snap = tracker.snapshot();
    (snap['svc'] as { state: string }).state = 'open';
    expect(tracker.state('svc').state).toBe('closed');
  });

  it('snapshot state matches individual state() calls', () => {
    const { tracker } = makeTracker();
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    const snap = tracker.snapshot();
    expect(snap['svc']?.state).toBe(tracker.state('svc').state);
  });
});

describe('canExecute', () => {
  it('returns ok:true for unknown key (defaults closed)', () => {
    const { tracker } = makeTracker();
    expect(tracker.canExecute('brand-new')).toEqual({ ok: true });
  });

  it('returns open reason when circuit is open', () => {
    const { tracker } = makeTracker();
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    expect(tracker.canExecute('svc')).toEqual({ ok: false, reason: 'open' });
  });
});

describe('state()', () => {
  it('nextRetryAt is openedAt + openMs while open', () => {
    const { tracker, env } = makeTracker({ openMs: 10_000 });
    for (let i = 0; i < 3; i++) tracker.record('svc', 'failure');
    const s = tracker.state('svc');
    expect(s.nextRetryAt).toBe(s.openedAt! + 10_000);
  });

  it('nextRetryAt is undefined when closed', () => {
    const { tracker } = makeTracker();
    expect(tracker.state('svc').nextRetryAt).toBeUndefined();
  });
});
