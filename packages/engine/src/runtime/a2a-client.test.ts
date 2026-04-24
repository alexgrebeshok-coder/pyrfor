// @vitest-environment node
/**
 * Tests for packages/engine/src/runtime/a2a-client.ts
 *
 * All HTTP calls are intercepted via the injected fetchImpl — no real network.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createA2AClient } from './a2a-client.js';
import type { A2AClient, A2AAgentConfig } from './a2a-client.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  return async (url: any, init?: any): Promise<Response> =>
    Promise.resolve(handler(String(url), init));
}

function cardResponse(skills: unknown[] = [{ skill: 'ping', description: 'ping tool' }]) {
  return new Response(JSON.stringify({ name: 'remote', version: '1.0', skills }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function invokeOk(output: unknown = { result: 'pong' }) {
  return new Response(JSON.stringify({ output }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function invokeErr(status: number, errorMsg = 'server blew up') {
  return new Response(JSON.stringify({ error: errorMsg }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Default agent config. */
function agentCfg(overrides: Partial<A2AAgentConfig> = {}): A2AAgentConfig {
  return { name: 'agent1', baseUrl: 'http://remote.test/a2a', ...overrides };
}

/** Build a client backed by a fetch that serves a card + a single skill invoke. */
function makeSimpleClient(invokeHandler?: (url: string, init?: RequestInit) => Response) {
  return createA2AClient({
    retries: 0,
    retryBackoffMs: 0,
    fetchImpl: mockFetch((url, init) => {
      if (url.includes('.well-known')) return cardResponse();
      return invokeHandler ? invokeHandler(url, init) : invokeOk();
    }),
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('A2AClient', () => {
  let client: A2AClient;
  const allClients: A2AClient[] = [];

  function track(c: A2AClient) {
    allClients.push(c);
    return c;
  }

  beforeEach(() => {
    client = track(makeSimpleClient());
  });

  afterEach(async () => {
    for (const c of allClients) await c.shutdown().catch(() => {});
    allClients.length = 0;
  });

  // ── 1. register fetches card and caches skills ────────────────────────────

  it('register fetches well-known card and caches skills', async () => {
    await client.register(agentCfg());
    expect(client.isRegistered('agent1')).toBe(true);
    const skills = client.listSkills('agent1');
    expect(skills).toHaveLength(1);
    expect(skills[0].skill).toBe('ping');
    expect(skills[0].agentName).toBe('agent1');
  });

  // ── 2. duplicate register throws ─────────────────────────────────────────

  it('duplicate register throws', async () => {
    await client.register(agentCfg());
    await expect(client.register(agentCfg())).rejects.toThrow(/duplicate agent name/i);
  });

  // ── 3. listAgents ─────────────────────────────────────────────────────────

  it('listAgents includes registered agent', async () => {
    expect(client.listAgents()).toEqual([]);
    await client.register(agentCfg());
    expect(client.listAgents()).toContain('agent1');
  });

  // ── 4. listSkills per-agent filter ────────────────────────────────────────

  it('listSkills per-agent filter returns only that agent skills', async () => {
    const multi = track(
      createA2AClient({
        retries: 0,
        fetchImpl: mockFetch((url) => {
          if (url.includes('agent1') && url.includes('.well-known'))
            return cardResponse([{ skill: 'foo' }]);
          if (url.includes('agent2') && url.includes('.well-known'))
            return cardResponse([{ skill: 'bar' }, { skill: 'baz' }]);
          return invokeOk();
        }),
      }),
    );

    await multi.register({ name: 'agent1', baseUrl: 'http://agent1.test/a2a' });
    await multi.register({ name: 'agent2', baseUrl: 'http://agent2.test/a2a' });

    expect(multi.listSkills('agent1').map((s) => s.skill)).toEqual(['foo']);
    expect(multi.listSkills('agent2').map((s) => s.skill)).toEqual(['bar', 'baz']);
  });

  // ── 5. listSkills all when no filter ─────────────────────────────────────

  it('listSkills returns all skills when no agent filter provided', async () => {
    const multi = track(
      createA2AClient({
        retries: 0,
        fetchImpl: mockFetch((url) => {
          if (url.includes('agent1') && url.includes('.well-known'))
            return cardResponse([{ skill: 'foo' }]);
          if (url.includes('agent2') && url.includes('.well-known'))
            return cardResponse([{ skill: 'bar' }]);
          return invokeOk();
        }),
      }),
    );

    await multi.register({ name: 'agent1', baseUrl: 'http://agent1.test/a2a' });
    await multi.register({ name: 'agent2', baseUrl: 'http://agent2.test/a2a' });

    const all = multi.listSkills();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.skill).sort()).toEqual(['bar', 'foo']);
  });

  // ── 6. call success returns ok:true with output ───────────────────────────

  it('call success returns ok:true with output', async () => {
    await client.register(agentCfg());
    const res = await client.call('agent1', 'ping', { msg: 'hi' });
    expect(res.ok).toBe(true);
    expect(res.output).toEqual({ result: 'pong' });
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.retries).toBe(0);
  });

  // ── 7. call posts JSON body { input } ─────────────────────────────────────

  it('call posts JSON body { input }', async () => {
    let capturedBody: unknown;
    const c = track(
      makeSimpleClient((url, init) => {
        capturedBody = JSON.parse(init?.body as string);
        return invokeOk();
      }),
    );

    await c.register(agentCfg());
    await c.call('agent1', 'ping', { key: 'value' });

    expect(capturedBody).toEqual({ input: { key: 'value' } });
  });

  // ── 8. call sends Authorization Bearer when authToken set ─────────────────

  it('call sends Authorization Bearer when authToken set', async () => {
    let capturedAuth: string | undefined;
    const c = track(
      createA2AClient({
        retries: 0,
        fetchImpl: mockFetch((url, init) => {
          if (url.includes('.well-known')) return cardResponse();
          capturedAuth = (init?.headers as Record<string, string>)?.['Authorization'];
          return invokeOk();
        }),
      }),
    );

    await c.register(agentCfg({ authToken: 'tok-secret' }));
    await c.call('agent1', 'ping', {});

    expect(capturedAuth).toBe('Bearer tok-secret');
  });

  // ── 9. call sends custom headers ──────────────────────────────────────────

  it('call sends custom headers', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const c = track(
      createA2AClient({
        retries: 0,
        fetchImpl: mockFetch((url, init) => {
          if (url.includes('.well-known')) return cardResponse();
          capturedHeaders = init?.headers as Record<string, string>;
          return invokeOk();
        }),
      }),
    );

    await c.register(agentCfg({ headers: { 'X-Custom': 'hello' } }));
    await c.call('agent1', 'ping', {});

    expect(capturedHeaders?.['X-Custom']).toBe('hello');
  });

  // ── 10. call unknown agent → ok:false 'no such agent' ─────────────────────

  it('call unknown agent returns ok:false with "no such agent"', async () => {
    const res = await client.call('ghost', 'ping', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no such agent');
    expect(res.durationMs).toBe(0);
    expect(res.retries).toBe(0);
  });

  // ── 11. call 4xx returns ok:false with body.error ─────────────────────────

  it('call 4xx returns ok:false with body.error string', async () => {
    const c = track(makeSimpleClient(() => invokeErr(422, 'bad input')));
    await c.register(agentCfg());
    const res = await c.call('agent1', 'ping', {});
    expect(res.ok).toBe(false);
    expect(res.error).toBe('bad input');
    expect(res.retries).toBe(0);
  });

  // ── 12. call 5xx retries up to retries count then fails ───────────────────

  it('call 5xx retries up to retries count then fails', async () => {
    let calls = 0;
    const c = track(
      createA2AClient({
        retries: 2,
        retryBackoffMs: 0,
        fetchImpl: mockFetch((url) => {
          if (url.includes('.well-known')) return cardResponse();
          calls++;
          return invokeErr(503, 'unavailable');
        }),
      }),
    );

    await c.register(agentCfg());
    const res = await c.call('agent1', 'ping', {});

    expect(res.ok).toBe(false);
    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(res.retries).toBe(2);
  });

  // ── 13. call network error retries then fails with last error ─────────────

  it('call network error retries then fails with last error', async () => {
    let calls = 0;
    const c = track(
      createA2AClient({
        retries: 2,
        retryBackoffMs: 0,
        fetchImpl: mockFetch((url) => {
          if (url.includes('.well-known')) return cardResponse();
          calls++;
          throw new Error('connection refused');
        }),
      }),
    );

    await c.register(agentCfg());
    const res = await c.call('agent1', 'ping', {});

    expect(res.ok).toBe(false);
    expect(res.error).toContain('connection refused');
    expect(calls).toBe(3);
    expect(res.retries).toBe(2);
  });

  // ── 14. call retries=0 → exactly 1 attempt ───────────────────────────────

  it('call retries=0 → exactly 1 attempt on failure', async () => {
    let calls = 0;
    const c = track(
      createA2AClient({
        retries: 0,
        fetchImpl: mockFetch((url) => {
          if (url.includes('.well-known')) return cardResponse();
          calls++;
          return invokeErr(500, 'boom');
        }),
      }),
    );

    await c.register(agentCfg());
    const res = await c.call('agent1', 'ping', {});

    expect(calls).toBe(1);
    expect(res.retries).toBe(0);
    expect(res.ok).toBe(false);
  });

  // ── 15. call timeout → ok:false 'timeout' ────────────────────────────────

  it('call timeout → ok:false "timeout"', async () => {
    vi.useFakeTimers();
    try {
      const c = track(
        createA2AClient({
          retries: 0,
          fetchImpl: mockFetch((url) => {
            if (url.includes('.well-known')) return cardResponse();
            return new Promise(() => { /* never resolves */ });
          }),
          clock: () => Date.now(),
        }),
      );

      // Register using real (fake-timer-aware) Promise.race.
      // The card fetch must complete before advancing time.
      const registerPromise = c.register(agentCfg({ callTimeoutMs: 100 }));
      await vi.runAllTimersAsync();
      await registerPromise;

      const callPromise = c.call('agent1', 'ping', {});
      await vi.advanceTimersByTimeAsync(200);
      const res = await callPromise;

      expect(res.ok).toBe(false);
      expect(res.error).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  // ── 16. call retries field reflects attempts-1 ───────────────────────────

  it('call retries field reflects number of retry attempts', async () => {
    let calls = 0;
    const c = track(
      createA2AClient({
        retries: 3,
        retryBackoffMs: 0,
        fetchImpl: mockFetch((url) => {
          if (url.includes('.well-known')) return cardResponse();
          calls++;
          if (calls < 3) return invokeErr(500, 'not yet');
          return invokeOk(); // succeeds on 3rd attempt
        }),
      }),
    );

    await c.register(agentCfg());
    const res = await c.call('agent1', 'ping', {});

    expect(res.ok).toBe(true);
    expect(res.retries).toBe(2); // 2 retries before success on attempt 3
  });

  // ── 17. emit 'register' on register ──────────────────────────────────────

  it("emits 'register' event on register", async () => {
    const events: any[] = [];
    client.on('register', (p) => events.push(p));
    await client.register(agentCfg());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentName: 'agent1' });
  });

  // ── 18. emit 'unregister' on unregister ───────────────────────────────────

  it("emits 'unregister' event on unregister", async () => {
    const events: any[] = [];
    client.on('unregister', (p) => events.push(p));
    await client.register(agentCfg());
    await client.unregister('agent1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agentName: 'agent1' });
  });

  // ── 19. emit 'skill' once per discovered skill ────────────────────────────

  it("emits 'skill' once per discovered skill on register", async () => {
    const c = track(
      createA2AClient({
        retries: 0,
        fetchImpl: mockFetch((url) => {
          if (url.includes('.well-known'))
            return cardResponse([{ skill: 'a' }, { skill: 'b' }, { skill: 'c' }]);
          return invokeOk();
        }),
      }),
    );

    const skillEvents: any[] = [];
    c.on('skill', (p) => skillEvents.push(p));
    await c.register(agentCfg());

    expect(skillEvents).toHaveLength(3);
    expect(skillEvents.map((e) => e.skill).sort()).toEqual(['a', 'b', 'c']);
  });

  // ── 20. emit 'call' with payload ─────────────────────────────────────────

  it("emits 'call' event with agentName, skill, ok, durationMs on call", async () => {
    const events: any[] = [];
    client.on('call', (p) => events.push(p));
    await client.register(agentCfg());
    await client.call('agent1', 'ping', {});

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agentName: 'agent1',
      skill:     'ping',
      ok:        true,
    });
    expect(typeof events[0].durationMs).toBe('number');
  });

  // ── 21. on/off unsubscribe stops further callbacks ────────────────────────

  it('on() returns unsub that stops further callbacks', async () => {
    const events: any[] = [];
    const unsub = client.on('register', (p) => events.push(p));
    unsub(); // immediately unsub
    await client.register(agentCfg());
    expect(events).toHaveLength(0);
  });

  // ── 22. subscriber throw swallowed ────────────────────────────────────────

  it('subscriber throw is swallowed and does not break call', async () => {
    const good: any[] = [];
    client.on('register', () => { throw new Error('subscriber kaboom'); });
    client.on('register', (p) => good.push(p));

    await expect(client.register(agentCfg())).resolves.toBeUndefined();
    expect(good).toHaveLength(1);
  });

  // ── 23. shutdown drops all agents + idempotent ────────────────────────────

  it('shutdown drops all agents and is idempotent', async () => {
    await client.register(agentCfg());
    expect(client.listAgents()).toHaveLength(1);

    await client.shutdown();
    expect(client.listAgents()).toHaveLength(0);
    expect(client.listSkills()).toHaveLength(0);

    // Second shutdown must not throw
    await expect(client.shutdown()).resolves.toBeUndefined();
  });

  // ── 24. card without skills → empty skill list ───────────────────────────

  it('card response missing skills array → registers with empty skill list', async () => {
    const c = track(
      createA2AClient({
        retries: 0,
        fetchImpl: mockFetch(() =>
          new Response(JSON.stringify({ name: 'x', version: '1' }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      }),
    );

    await c.register(agentCfg());
    expect(c.isRegistered('agent1')).toBe(true);
    expect(c.listSkills('agent1')).toEqual([]);
  });

  // ── 25. card non-JSON → register rejects ─────────────────────────────────

  it('card non-JSON response causes register to reject', async () => {
    const c = track(
      createA2AClient({
        retries: 0,
        fetchImpl: mockFetch(
          () => new Response('not valid json at all!!!', { headers: { 'Content-Type': 'text/plain' } }),
        ),
      }),
    );

    await expect(c.register(agentCfg())).rejects.toThrow();
    expect(c.isRegistered('agent1')).toBe(false);
  });

  // ── 26. isRegistered flips correctly ─────────────────────────────────────

  it('isRegistered returns true after register and false after unregister', async () => {
    expect(client.isRegistered('agent1')).toBe(false);
    await client.register(agentCfg());
    expect(client.isRegistered('agent1')).toBe(true);
    await client.unregister('agent1');
    expect(client.isRegistered('agent1')).toBe(false);
  });
});
