// @vitest-environment node
/**
 * llm-provider-router.test.ts — ≥ 40 tests for createProviderRouter.
 *
 * Uses an injected `clock` for deterministic timing throughout.
 * vi.useFakeTimers() is NOT required because all timing is controlled via the
 * `clock` option.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProviderRouter } from './llm-provider-router.js';
import type {
  LlmRequest,
  LlmResponse,
  ProviderConfig,
  RouterOptions,
} from './llm-provider-router.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeReq(overrides?: Partial<LlmRequest>): LlmRequest {
  return { messages: [{ role: 'user', content: 'hello' }], ...overrides };
}

/** Minimal passing provider. Override any field via `overrides`. */
function makeProvider(id: string, overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id,
    capabilities: ['chat'],
    call: vi.fn(async () => ({
      provider: id,
      text: `response-${id}`,
      latencyMs: 0,
    } as LlmResponse)),
    ...overrides,
  };
}

/** Provider whose call always throws `error`. */
function makeFailingProvider(
  id: string,
  error: Error = new Error(`${id} failed`),
  overrides?: Partial<ProviderConfig>,
): ProviderConfig {
  return makeProvider(id, {
    call: vi.fn(async () => { throw error; }),
    ...overrides,
  });
}

/** Controllable clock. */
function makeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

function makeRouter(opts?: RouterOptions) {
  return createProviderRouter(opts);
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 1 — register / unregister / listProviders
// ══════════════════════════════════════════════════════════════════════════════

describe('register / unregister / listProviders', () => {
  it('listProviders returns [] for an empty router', () => {
    expect(makeRouter().listProviders()).toEqual([]);
  });

  it('register adds provider; it appears in listProviders', () => {
    const router = makeRouter();
    router.register(makeProvider('p1'));
    expect(router.listProviders()).toHaveLength(1);
    expect(router.listProviders()[0].id).toBe('p1');
  });

  it('listProviders returns correct ProviderStatus shape', () => {
    const router = makeRouter();
    router.register(makeProvider('p1'));
    const [p] = router.listProviders();
    expect(p).toMatchObject({
      id: 'p1',
      healthy: true,
      successRate: 1,
      avgLatencyMs: 0,
      activeCalls: 0,
    });
    expect(p.circuitOpenUntil).toBeUndefined();
  });

  it('unregister removes the provider from listProviders', () => {
    const router = makeRouter();
    router.register(makeProvider('p1'));
    router.unregister('p1');
    expect(router.listProviders()).toEqual([]);
  });

  it('unregister an unknown id is a no-op (does not throw)', () => {
    expect(() => makeRouter().unregister('ghost')).not.toThrow();
  });

  it('registering the same id twice throws', () => {
    const router = makeRouter();
    router.register(makeProvider('dup'));
    expect(() => router.register(makeProvider('dup'))).toThrow(/already registered/i);
  });

  it('multiple providers all appear in listProviders', () => {
    const router = makeRouter();
    router.register(makeProvider('a'));
    router.register(makeProvider('b'));
    router.register(makeProvider('c'));
    const ids = router.listProviders().map(p => p.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 2 — basic call
// ══════════════════════════════════════════════════════════════════════════════

describe('basic call', () => {
  it('returns response from a single healthy provider', async () => {
    const router = makeRouter();
    router.register(makeProvider('p1', {
      call: vi.fn(async () => ({ provider: 'p1', text: 'hello world', latencyMs: 0 } as LlmResponse)),
    }));
    const resp = await router.call(makeReq());
    expect(resp.text).toBe('hello world');
  });

  it('response.provider is set to the provider id', async () => {
    const router = makeRouter();
    router.register(makeProvider('zhipu'));
    const resp = await router.call(makeReq());
    expect(resp.provider).toBe('zhipu');
  });

  it('response.latencyMs reflects the injected clock delta', async () => {
    const { now, advance } = makeClock();
    const router = makeRouter({ clock: now });
    router.register(makeProvider('p1', {
      call: vi.fn(async () => {
        advance(42);
        return { provider: 'p1', text: 'hi', latencyMs: 0 } as LlmResponse;
      }),
    }));
    const resp = await router.call(makeReq());
    expect(resp.latencyMs).toBe(42);
  });

  it('forwards usage from the provider response', async () => {
    const router = makeRouter();
    router.register(makeProvider('p1', {
      call: vi.fn(async () => ({
        provider: 'p1', text: 'hi', latencyMs: 0,
        usage: { promptTokens: 10, completionTokens: 5 },
      } as LlmResponse)),
    }));
    const resp = await router.call(makeReq());
    expect(resp.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('forwards toolCalls from the provider response', async () => {
    const tools = [{ name: 'calc', args: {} }];
    const router = makeRouter();
    router.register(makeProvider('p1', {
      call: vi.fn(async () => ({
        provider: 'p1', text: '', latencyMs: 0, toolCalls: tools,
      } as LlmResponse)),
    }));
    const resp = await router.call(makeReq());
    expect(resp.toolCalls).toEqual(tools);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 3 — fallback on failure
// ══════════════════════════════════════════════════════════════════════════════

describe('fallback on failure', () => {
  it('throws when the single provider fails', async () => {
    const router = makeRouter();
    router.register(makeFailingProvider('p1', new Error('boom')));
    await expect(router.call(makeReq())).rejects.toThrow('boom');
  });

  it('falls back to the second provider when the first fails', async () => {
    const router = makeRouter();
    router.register(makeFailingProvider('p1'));
    router.register(makeProvider('p2', {
      call: vi.fn(async () => ({ provider: 'p2', text: 'ok', latencyMs: 0 } as LlmResponse)),
    }));
    const resp = await router.call(makeReq(), { order: ['p1', 'p2'] });
    expect(resp.provider).toBe('p2');
    expect(resp.text).toBe('ok');
  });

  it('tries providers in order until one succeeds', async () => {
    const router = makeRouter();
    router.register(makeFailingProvider('p1', new Error('e1')));
    router.register(makeFailingProvider('p2', new Error('e2')));
    router.register(makeProvider('p3', {
      call: vi.fn(async () => ({ provider: 'p3', text: 'third', latencyMs: 0 } as LlmResponse)),
    }));
    const resp = await router.call(makeReq(), { order: ['p1', 'p2', 'p3'] });
    expect(resp.provider).toBe('p3');
  });

  it('throws the last provider error when all fail', async () => {
    const router = makeRouter();
    router.register(makeFailingProvider('p1', new Error('err1')));
    router.register(makeFailingProvider('p2', new Error('err2')));
    await expect(router.call(makeReq(), { order: ['p1', 'p2'] })).rejects.toThrow('err2');
  });

  it('respects maxAttempts and does not try beyond the limit', async () => {
    const router = makeRouter();
    const p2 = makeProvider('p2');
    router.register(makeFailingProvider('p1', new Error('fail')));
    router.register(p2);
    await expect(
      router.call(makeReq(), { order: ['p1', 'p2'], maxAttempts: 1 }),
    ).rejects.toThrow('fail');
    expect((p2.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('throws "no available providers" when provider list is empty', async () => {
    await expect(makeRouter().call(makeReq())).rejects.toThrow(/no available providers/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 4 — capability filtering
// ══════════════════════════════════════════════════════════════════════════════

describe('capability filtering', () => {
  it('needs=[tools] excludes providers without tools capability', async () => {
    const router = makeRouter();
    const p1 = makeProvider('p1', { capabilities: ['chat'] });
    const p2 = makeProvider('p2', { capabilities: ['chat', 'tools'] });
    router.register(p1);
    router.register(p2);
    const resp = await router.call(makeReq({ needs: ['tools'] }));
    expect(resp.provider).toBe('p2');
    expect((p1.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('throws when no provider supports the required capability', async () => {
    const router = makeRouter();
    router.register(makeProvider('p1', { capabilities: ['chat'] }));
    await expect(router.call(makeReq({ needs: ['vision'] }))).rejects.toThrow(/no available providers/i);
  });

  it('provider with empty capabilities array is excluded when needs are specified', async () => {
    const router = makeRouter();
    router.register(makeProvider('p1', { capabilities: [] }));
    await expect(router.call(makeReq({ needs: ['chat'] }))).rejects.toThrow(/no available providers/i);
  });

  it('ALL listed needs must be met by a provider', async () => {
    const router = makeRouter();
    const p1 = makeProvider('p1', { capabilities: ['chat', 'tools'] }); // missing vision
    const p2 = makeProvider('p2', { capabilities: ['chat', 'tools', 'vision'] });
    router.register(p1);
    router.register(p2);
    const resp = await router.call(makeReq({ needs: ['chat', 'tools', 'vision'] }));
    expect(resp.provider).toBe('p2');
  });

  it('no needs → all registered providers are considered', async () => {
    const router = makeRouter();
    router.register(makeProvider('p1', { capabilities: [] }));
    const resp = await router.call(makeReq()); // no needs
    expect(resp.provider).toBe('p1');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 5 — cost-aware routing
// ══════════════════════════════════════════════════════════════════════════════

describe('cost-aware routing', () => {
  it('preferCheapFor=simple picks the lowest-cost provider first', async () => {
    const router = makeRouter();
    router.register(makeProvider('expensive', { costPerKToken: 10 }));
    router.register(makeProvider('cheap', { costPerKToken: 1 }));
    router.register(makeProvider('mid', { costPerKToken: 5 }));
    const resp = await router.call(makeReq({ preferCheapFor: 'simple' }));
    expect(resp.provider).toBe('cheap');
  });

  it('preferCheapFor=simple puts undefined-cost providers after explicitly priced ones', async () => {
    const router = makeRouter();
    router.register(makeProvider('priceless')); // no costPerKToken
    router.register(makeProvider('cheap', { costPerKToken: 0.5 }));
    const resp = await router.call(makeReq({ preferCheapFor: 'simple' }));
    expect(resp.provider).toBe('cheap');
  });

  it('preferCheapFor=complex does not sort by cost; uses health rank', async () => {
    const router = makeRouter();
    router.register(makeProvider('expensive', { costPerKToken: 100 }));
    router.register(makeProvider('cheap', { costPerKToken: 1 }));
    // Give 'expensive' a clearly better health record.
    for (let i = 0; i < 5; i++) router.recordExternal('expensive', true, 10);
    for (let i = 0; i < 5; i++) router.recordExternal('cheap', false, 10);
    const resp = await router.call(makeReq({ preferCheapFor: 'complex' }));
    expect(resp.provider).toBe('expensive');
  });

  it('undefined preferCheapFor uses health-based order regardless of cost', async () => {
    const router = makeRouter();
    router.register(makeProvider('p1', { costPerKToken: 1 }));
    router.register(makeProvider('p2', { costPerKToken: 100 }));
    // p2 has a much better health score.
    for (let i = 0; i < 10; i++) router.recordExternal('p2', true, 1);
    for (let i = 0; i < 5; i++) router.recordExternal('p1', false, 500);
    const resp = await router.call(makeReq());
    expect(resp.provider).toBe('p2');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 6 — circuit breaker
// ══════════════════════════════════════════════════════════════════════════════

describe('circuit breaker', () => {
  it('opens circuit after N consecutive failures', async () => {
    const { now } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 3 });
    router.register(makeFailingProvider('p1'));
    for (let i = 0; i < 3; i++) {
      await expect(router.call(makeReq())).rejects.toThrow();
    }
    expect(router.listProviders()[0].healthy).toBe(false);
    expect(router.listProviders()[0].circuitOpenUntil).toBeGreaterThan(0);
  });

  it('circuit-open provider is skipped during call', async () => {
    const { now } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 2, circuitCooldownMs: 60_000 });
    const p1 = makeFailingProvider('p1');
    const p2 = makeProvider('p2');
    router.register(p1);
    router.register(p2);
    // Open p1's circuit (maxAttempts=1 so p2 isn't tried yet).
    for (let i = 0; i < 2; i++) {
      await expect(router.call(makeReq(), { order: ['p1', 'p2'], maxAttempts: 1 })).rejects.toThrow();
    }
    // Now p1 is open; call should skip it and succeed via p2.
    const resp = await router.call(makeReq(), { order: ['p1', 'p2'] });
    expect(resp.provider).toBe('p2');
    expect((p1.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('open circuit shows healthy=false in listProviders', async () => {
    const { now } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 1 });
    router.register(makeFailingProvider('p1'));
    await expect(router.call(makeReq())).rejects.toThrow();
    expect(router.listProviders()[0].healthy).toBe(false);
  });

  it('circuitOpenUntil is populated in listProviders when circuit is open', async () => {
    const { now } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 1, circuitCooldownMs: 5_000 });
    router.register(makeFailingProvider('p1'));
    await expect(router.call(makeReq())).rejects.toThrow();
    const [p] = router.listProviders();
    expect(p.circuitOpenUntil).toBeDefined();
    expect(p.circuitOpenUntil!).toBeGreaterThan(now());
  });

  it('half-open trial succeeds → circuit closes', async () => {
    const { now, advance } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 2, circuitCooldownMs: 1_000 });
    let shouldFail = true;
    router.register(makeProvider('p1', {
      call: vi.fn(async () => {
        if (shouldFail) throw new Error('fail');
        return { provider: 'p1', text: 'ok', latencyMs: 0 } as LlmResponse;
      }),
    }));
    // Open the circuit.
    for (let i = 0; i < 2; i++) {
      await expect(router.call(makeReq())).rejects.toThrow();
    }
    expect(router.listProviders()[0].healthy).toBe(false);
    // Advance past cooldown and allow the trial to succeed.
    advance(1_001);
    shouldFail = false;
    const resp = await router.call(makeReq());
    expect(resp.provider).toBe('p1');
    const [p] = router.listProviders();
    expect(p.healthy).toBe(true);
    expect(p.circuitOpenUntil).toBeUndefined();
  });

  it('half-open trial fails → circuit re-opens', async () => {
    const { now, advance } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 1, circuitCooldownMs: 1_000 });
    router.register(makeFailingProvider('p1'));
    // Open.
    await expect(router.call(makeReq())).rejects.toThrow();
    advance(1_001); // past cooldown → half-open
    // Trial fails → re-open.
    await expect(router.call(makeReq())).rejects.toThrow();
    const [p] = router.listProviders();
    expect(p.healthy).toBe(false);
    expect(p.circuitOpenUntil!).toBeGreaterThan(now());
  });

  it('circuitOpen event fires with providerId when circuit opens', async () => {
    const { now } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 1 });
    router.register(makeFailingProvider('p1'));
    const opens: any[] = [];
    router.on('circuitOpen', meta => opens.push(meta));
    await expect(router.call(makeReq())).rejects.toThrow();
    expect(opens).toHaveLength(1);
    expect(opens[0].providerId).toBe('p1');
  });

  it('circuitClose event fires when half-open trial succeeds', async () => {
    const { now, advance } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 1, circuitCooldownMs: 500 });
    let fail = true;
    router.register(makeProvider('p1', {
      call: vi.fn(async () => {
        if (fail) throw new Error('fail');
        return { provider: 'p1', text: 'ok', latencyMs: 0 } as LlmResponse;
      }),
    }));
    const closes: any[] = [];
    router.on('circuitClose', meta => closes.push(meta));
    await expect(router.call(makeReq())).rejects.toThrow();
    advance(600);
    fail = false;
    await router.call(makeReq());
    expect(closes).toHaveLength(1);
    expect(closes[0].providerId).toBe('p1');
  });

  it('circuit breaker uses consecutive failures, not window failures', async () => {
    const { now } = makeClock();
    // Window = 3 but circuitFailures = 5 → needs 5 in a row.
    const router = makeRouter({ clock: now, healthWindow: 3, circuitFailures: 5 });
    let callCount = 0;
    router.register(makeProvider('p1', {
      call: vi.fn(async () => {
        callCount++;
        // Succeed on calls 2 and 4, fail otherwise.
        if (callCount === 2 || callCount === 4) {
          return { provider: 'p1', text: 'ok', latencyMs: 0 } as LlmResponse;
        }
        throw new Error('fail');
      }),
    }));
    // Fail, succeed, fail, succeed, fail → consecutive resets on success → never opens.
    for (let i = 0; i < 5; i++) {
      await router.call(makeReq()).catch(() => {});
    }
    // Should still be healthy because consecutive streak was broken.
    expect(router.listProviders()[0].healthy).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 7 — maxConcurrent
// ══════════════════════════════════════════════════════════════════════════════

describe('maxConcurrent', () => {
  it('tracks activeCalls=1 while a call is in-flight', async () => {
    const router = makeRouter();
    let resolve!: () => void;
    const block = new Promise<void>(r => { resolve = r; });
    router.register(makeProvider('p1', {
      call: vi.fn(async () => {
        await block;
        return { provider: 'p1', text: 'done', latencyMs: 0 } as LlmResponse;
      }),
    }));
    const pending = router.call(makeReq());
    // activeCalls incremented synchronously before the first await inside call().
    expect(router.listProviders()[0].activeCalls).toBe(1);
    resolve();
    await pending;
    expect(router.listProviders()[0].activeCalls).toBe(0);
  });

  it('at maxConcurrent cap routes subsequent calls to the next provider', async () => {
    const router = makeRouter();
    let resolveA!: () => void;
    const blockA = new Promise<void>(r => { resolveA = r; });
    const pA = makeProvider('a', {
      maxConcurrent: 1,
      call: vi.fn(async () => {
        await blockA;
        return { provider: 'a', text: 'a', latencyMs: 0 } as LlmResponse;
      }),
    });
    const pB = makeProvider('b');
    router.register(pA);
    router.register(pB);

    // First call occupies slot on A (synchronous increment before first await).
    const first = router.call(makeReq(), { order: ['a', 'b'] });
    // A is now saturated; second call should fall through to B immediately.
    const second = await router.call(makeReq(), { order: ['a', 'b'] });
    expect(second.provider).toBe('b');
    resolveA();
    const firstResult = await first;
    expect(firstResult.provider).toBe('a');
  });

  it('activeCalls decrements to 0 after a successful call', async () => {
    const router = makeRouter();
    router.register(makeProvider('p1'));
    await router.call(makeReq());
    expect(router.listProviders()[0].activeCalls).toBe(0);
  });

  it('activeCalls decrements to 0 after a failed call', async () => {
    const router = makeRouter();
    router.register(makeFailingProvider('p1'));
    await router.call(makeReq()).catch(() => {});
    expect(router.listProviders()[0].activeCalls).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 8 — AbortSignal
// ══════════════════════════════════════════════════════════════════════════════

describe('AbortSignal', () => {
  it('already-aborted signal throws AbortError before any provider is tried', async () => {
    const router = makeRouter();
    const p1 = makeProvider('p1');
    router.register(p1);
    const ctrl = new AbortController();
    ctrl.abort();
    const err = await router.call(makeReq({ signal: ctrl.signal })).catch(e => e);
    expect(err.name).toBe('AbortError');
    expect((p1.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('AbortError is not recorded as a health failure', async () => {
    const router = makeRouter();
    const ctrl = new AbortController();
    ctrl.abort();
    router.register(makeProvider('p1'));
    await router.call(makeReq({ signal: ctrl.signal })).catch(() => {});
    // No call was made, so successRate stays at the optimistic default of 1.
    expect(router.listProviders()[0].successRate).toBe(1);
  });

  it('AbortError thrown by provider propagates and is not counted as failure', async () => {
    const router = makeRouter();
    const ctrl = new AbortController();
    router.register(makeProvider('p1', {
      call: vi.fn(async () => {
        ctrl.abort();
        const e = new Error('aborted mid-flight');
        e.name = 'AbortError';
        throw e;
      }),
    }));
    const err = await router.call(makeReq({ signal: ctrl.signal })).catch(e => e);
    expect(err.name).toBe('AbortError');
    // Health window should be empty — abort not recorded.
    expect(router.listProviders()[0].successRate).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 9 — recordExternal
// ══════════════════════════════════════════════════════════════════════════════

describe('recordExternal', () => {
  it('updates successRate with external outcomes', () => {
    const router = makeRouter();
    router.register(makeProvider('p1'));
    router.recordExternal('p1', false, 100);
    router.recordExternal('p1', false, 100);
    router.recordExternal('p1', true, 100);
    expect(router.listProviders()[0].successRate).toBeCloseTo(1 / 3);
  });

  it('updates avgLatencyMs with external latency samples', () => {
    const router = makeRouter();
    router.register(makeProvider('p1'));
    router.recordExternal('p1', true, 100);
    router.recordExternal('p1', true, 200);
    expect(router.listProviders()[0].avgLatencyMs).toBe(150);
  });

  it('can trigger a circuit open via external failures', () => {
    const { now } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 3 });
    router.register(makeProvider('p1'));
    router.recordExternal('p1', false, 10);
    router.recordExternal('p1', false, 10);
    router.recordExternal('p1', false, 10);
    expect(router.listProviders()[0].healthy).toBe(false);
  });

  it('recordExternal for an unknown id is a safe no-op', () => {
    expect(() => makeRouter().recordExternal('ghost', true, 50)).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 10 — resetHealth
// ══════════════════════════════════════════════════════════════════════════════

describe('resetHealth', () => {
  it('resetHealth() with no arg clears all providers', () => {
    const router = makeRouter();
    router.register(makeProvider('p1'));
    router.register(makeProvider('p2'));
    router.recordExternal('p1', false, 100);
    router.recordExternal('p2', false, 100);
    router.resetHealth();
    for (const p of router.listProviders()) {
      expect(p.successRate).toBe(1);
      expect(p.avgLatencyMs).toBe(0);
    }
  });

  it('resetHealth(id) clears only the specified provider', () => {
    const router = makeRouter();
    router.register(makeProvider('p1'));
    router.register(makeProvider('p2'));
    router.recordExternal('p1', false, 200);
    router.recordExternal('p2', false, 200);
    router.resetHealth('p1');
    const list = router.listProviders();
    const p1 = list.find(p => p.id === 'p1')!;
    const p2 = list.find(p => p.id === 'p2')!;
    expect(p1.successRate).toBe(1); // cleared
    expect(p2.successRate).toBe(0); // untouched
  });

  it('resetHealth closes an open circuit', async () => {
    const { now } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 1 });
    router.register(makeFailingProvider('p1'));
    await router.call(makeReq()).catch(() => {});
    expect(router.listProviders()[0].healthy).toBe(false);
    router.resetHealth('p1');
    const [p] = router.listProviders();
    expect(p.healthy).toBe(true);
    expect(p.circuitOpenUntil).toBeUndefined();
  });

  it('after resetHealth provider accepts calls again', async () => {
    const { now } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 1 });
    let fail = true;
    router.register(makeProvider('p1', {
      call: vi.fn(async () => {
        if (fail) throw new Error('fail');
        return { provider: 'p1', text: 'ok', latencyMs: 0 } as LlmResponse;
      }),
    }));
    await router.call(makeReq()).catch(() => {});
    router.resetHealth('p1');
    fail = false;
    const resp = await router.call(makeReq());
    expect(resp.provider).toBe('p1');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 11 — events
// ══════════════════════════════════════════════════════════════════════════════

describe('events', () => {
  it('callStart fires before the provider call function runs', async () => {
    const router = makeRouter();
    const order: string[] = [];
    router.on('callStart', ({ providerId }) => order.push(`start:${providerId}`));
    router.register(makeProvider('p1', {
      call: vi.fn(async () => {
        order.push('call:p1');
        return { provider: 'p1', text: 'ok', latencyMs: 0 } as LlmResponse;
      }),
    }));
    await router.call(makeReq());
    expect(order[0]).toBe('start:p1');
    expect(order[1]).toBe('call:p1');
  });

  it('callEnd fires after a successful call with latencyMs', async () => {
    const router = makeRouter();
    const ends: any[] = [];
    router.on('callEnd', meta => ends.push(meta));
    router.register(makeProvider('p1'));
    await router.call(makeReq());
    expect(ends).toHaveLength(1);
    expect(ends[0].providerId).toBe('p1');
    expect(typeof ends[0].latencyMs).toBe('number');
  });

  it('callError fires on provider failure', async () => {
    const router = makeRouter();
    const errors: any[] = [];
    router.on('callError', meta => errors.push(meta));
    router.register(makeFailingProvider('p1', new Error('oops')));
    await router.call(makeReq()).catch(() => {});
    expect(errors).toHaveLength(1);
    expect(errors[0].providerId).toBe('p1');
  });

  it('events fire in order: callStart → callEnd on success', async () => {
    const router = makeRouter();
    const seq: string[] = [];
    router.on('callStart', () => seq.push('start'));
    router.on('callEnd', () => seq.push('end'));
    router.register(makeProvider('p1'));
    await router.call(makeReq());
    expect(seq).toEqual(['start', 'end']);
  });

  it('on() returns a working unsubscribe function', async () => {
    const router = makeRouter();
    const calls: number[] = [];
    const unsub = router.on('callEnd', () => calls.push(1));
    router.register(makeProvider('p1'));
    await router.call(makeReq());
    expect(calls).toHaveLength(1);
    unsub();
    await router.call(makeReq());
    expect(calls).toHaveLength(1); // not incremented after unsub
  });

  it('multiple listeners for the same event all fire', async () => {
    const router = makeRouter();
    const a: number[] = [], b: number[] = [];
    router.on('callEnd', () => a.push(1));
    router.on('callEnd', () => b.push(1));
    router.register(makeProvider('p1'));
    await router.call(makeReq());
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('a throwing listener does not break the router', async () => {
    const router = makeRouter();
    router.on('callEnd', () => { throw new Error('bad listener'); });
    router.register(makeProvider('p1'));
    await expect(router.call(makeReq())).resolves.toBeDefined();
  });

  it('callError + callEnd both fire correctly across a fallback chain', async () => {
    const router = makeRouter();
    const errors: string[] = [], ends: string[] = [];
    router.on('callError', ({ providerId }) => errors.push(providerId));
    router.on('callEnd', ({ providerId }) => ends.push(providerId));
    router.register(makeFailingProvider('p1'));
    router.register(makeProvider('p2'));
    await router.call(makeReq(), { order: ['p1', 'p2'] });
    expect(errors).toEqual(['p1']);
    expect(ends).toEqual(['p2']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 12 — rolling window
// ══════════════════════════════════════════════════════════════════════════════

describe('rolling window', () => {
  it('window size is respected: oldest outcomes are dropped', () => {
    const router = makeRouter({ healthWindow: 3 });
    router.register(makeProvider('p1'));
    // 3 failures then 3 successes; window of 3 should contain only successes.
    for (let i = 0; i < 3; i++) router.recordExternal('p1', false, 10);
    for (let i = 0; i < 3; i++) router.recordExternal('p1', true, 10);
    expect(router.listProviders()[0].successRate).toBe(1);
  });

  it('avgLatencyMs reflects only the last healthWindow samples', () => {
    const router = makeRouter({ healthWindow: 2 });
    router.register(makeProvider('p1'));
    router.recordExternal('p1', true, 1_000);
    router.recordExternal('p1', true, 1_000);
    // These two push out the 1000ms samples.
    router.recordExternal('p1', true, 10);
    router.recordExternal('p1', true, 10);
    expect(router.listProviders()[0].avgLatencyMs).toBe(10);
  });

  it('successRate reflects only window outcomes (old history irrelevant)', () => {
    const router = makeRouter({ healthWindow: 5 });
    router.register(makeProvider('p1'));
    for (let i = 0; i < 10; i++) router.recordExternal('p1', true, 10);
    // 5 failures overwrite the oldest 5 successes — window is now all failures.
    for (let i = 0; i < 5; i++) router.recordExternal('p1', false, 10);
    expect(router.listProviders()[0].successRate).toBe(0);
  });

  it('circuit breaker consecutive counter is independent of window size', async () => {
    const { now } = makeClock();
    // Window = 2 but circuitFailures = 3 → 3 consecutive failures still open the circuit.
    const router = makeRouter({ clock: now, healthWindow: 2, circuitFailures: 3 });
    router.register(makeFailingProvider('p1'));
    for (let i = 0; i < 3; i++) {
      await router.call(makeReq()).catch(() => {});
    }
    expect(router.listProviders()[0].healthy).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 13 — opts.order override
// ══════════════════════════════════════════════════════════════════════════════

describe('opts.order override', () => {
  it('opts.order sets the exact provider attempt order', async () => {
    const router = makeRouter();
    router.register(makeProvider('p1'));
    router.register(makeProvider('p2'));
    // Give p2 much better health so it would be first in the default sort.
    // Use 4 failures for p1 — below the default circuitFailures=5 so the circuit stays closed,
    // but success rate is 0% which makes p2 rank higher via health sort.
    for (let i = 0; i < 10; i++) router.recordExternal('p2', true, 1);
    for (let i = 0; i < 4; i++) router.recordExternal('p1', false, 500);
    // Force p1 first; it should succeed (its call mock doesn't throw).
    const resp = await router.call(makeReq(), { order: ['p1', 'p2'] });
    expect(resp.provider).toBe('p1');
  });

  it('opts.order still skips circuit-open providers', async () => {
    const { now } = makeClock();
    const router = makeRouter({ clock: now, circuitFailures: 1, circuitCooldownMs: 60_000 });
    const p1 = makeFailingProvider('p1');
    const p2 = makeProvider('p2');
    router.register(p1);
    router.register(p2);
    await router.call(makeReq()).catch(() => {}); // opens p1's circuit
    const resp = await router.call(makeReq(), { order: ['p1', 'p2'] });
    expect(resp.provider).toBe('p2');
  });

  it('opts.order omitting a provider means it is not tried', async () => {
    const router = makeRouter();
    const p1 = makeProvider('p1');
    const p2 = makeProvider('p2');
    router.register(p1);
    router.register(p2);
    await router.call(makeReq(), { order: ['p2'] });
    expect((p1.call as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
