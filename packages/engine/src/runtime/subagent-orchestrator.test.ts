// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSubagentOrchestrator,
} from './subagent-orchestrator.js';
import type {
  SubagentSpec,
  SubagentRunner,
  SubagentOrchestratorOptions,
} from './subagent-orchestrator.js';

// ── Fake runner factory ───────────────────────────────────────────────────────

function makeRunner(
  runnerOpts: {
    delayMs?: number;
    throw?: string;
    tokens?: number;
    iter?: number;
    checkAbort?: boolean;
  } = {},
): SubagentRunner {
  return async (spec, ctx) => {
    if (runnerOpts.throw) throw new Error(runnerOpts.throw);
    if (runnerOpts.delayMs) {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(res, runnerOpts.delayMs);
        if (runnerOpts.checkAbort) {
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(t);
            rej(new Error('aborted'));
          });
        }
      });
    }
    return {
      output: 'done:' + spec.role,
      toolCalls: 0,
      iterations: runnerOpts.iter ?? 1,
      tokensUsed: runnerOpts.tokens ?? 100,
    };
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOrchestrator(overrides: Partial<SubagentOrchestratorOptions> = {}) {
  return createSubagentOrchestrator({
    runner: makeRunner(),
    ...overrides,
  });
}

function makeSpec(overrides: Partial<SubagentSpec> = {}): SubagentSpec {
  return { role: 'coder', goal: 'write tests', ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SubagentOrchestrator', () => {
  // ── spawn basics ───────────────────────────────────────────────────────────

  it('spawn returns ok=true with output', async () => {
    const o = makeOrchestrator();
    const result = await o.spawn(makeSpec({ role: 'coder' }));
    expect(result.ok).toBe(true);
    expect(result.output).toBe('done:coder');
  });

  it('spawn populates id, role, durationMs, tokensUsed', async () => {
    let t = 1000;
    const clock = () => (t += 10);
    const o = makeOrchestrator({ clock, runner: makeRunner({ tokens: 250 }) });
    const result = await o.spawn(makeSpec({ role: 'reviewer' }));
    expect(result.id).toBeTruthy();
    expect(result.role).toBe('reviewer');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.tokensUsed).toBe(250);
  });

  it('spawn cost.record called on success', async () => {
    const record = vi.fn();
    const o = makeOrchestrator({ cost: { record }, runner: makeRunner({ tokens: 300 }) });
    await o.spawn(makeSpec({ role: 'planner' }));
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0][0]).toMatchObject({ role: 'planner', tokens: 300 });
  });

  it('spawn cost.record NOT called on runner failure', async () => {
    const record = vi.fn();
    const o = makeOrchestrator({ cost: { record }, runner: makeRunner({ throw: 'boom' }) });
    const result = await o.spawn(makeSpec());
    expect(result.ok).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });

  // ── timeout ────────────────────────────────────────────────────────────────

  it('spawn timeout aborts and returns ok:false error:timeout', async () => {
    const o = makeOrchestrator({
      runner: makeRunner({ delayMs: 500, checkAbort: true }),
      defaultMaxDurationMs: 30,
    });
    const result = await o.spawn(makeSpec());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
    expect(result.cancelled).toBe(false);
  });

  // ── external cancel ────────────────────────────────────────────────────────

  it('spawn external cancel via cancel(id) returns cancelled=true error=cancelled', async () => {
    const o = makeOrchestrator({
      runner: makeRunner({ delayMs: 500, checkAbort: true }),
    });
    // We need the id before spawn resolves — use a spec with explicit id
    const spec = makeSpec({ id: 'agent-cancel-test' });
    const promise = o.spawn(spec);
    // Give it a tick to register as active
    await new Promise((r) => setTimeout(r, 10));
    o.cancel('agent-cancel-test');
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('cancelled');
    expect(result.cancelled).toBe(true);
  });

  // ── runner throws ──────────────────────────────────────────────────────────

  it('spawn runner throws → ok:false with error message', async () => {
    const o = makeOrchestrator({ runner: makeRunner({ throw: 'something bad' }) });
    const result = await o.spawn(makeSpec());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('something bad');
  });

  it('spawn runner sync throw caught and returns failure', async () => {
    const syncThrowRunner: SubagentRunner = (_spec, _ctx) => {
      throw new Error('sync-throw');
    };
    const o = makeOrchestrator({ runner: syncThrowRunner });
    const result = await o.spawn(makeSpec());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('sync-throw');
  });

  // ── budget overage (post-call) ─────────────────────────────────────────────

  it('token overage post-check → ok:false error:token-budget-exceeded', async () => {
    const o = makeOrchestrator({ runner: makeRunner({ tokens: 9000 }) });
    const result = await o.spawn(makeSpec({ maxTokens: 500 }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('token-budget-exceeded');
    expect(result.tokensUsed).toBe(9000);
  });

  it('token overage still calls cost.record', async () => {
    const record = vi.fn();
    const o = makeOrchestrator({ cost: { record }, runner: makeRunner({ tokens: 9000 }) });
    await o.spawn(makeSpec({ maxTokens: 500 }));
    expect(record).toHaveBeenCalledOnce();
  });

  it('iteration overage post-check → ok:false error:iteration-budget-exceeded', async () => {
    const o = makeOrchestrator({ runner: makeRunner({ iter: 20 }) });
    const result = await o.spawn(makeSpec({ maxIterations: 5 }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('iteration-budget-exceeded');
    expect(result.iterations).toBe(20);
  });

  // ── spawnMany ──────────────────────────────────────────────────────────────

  it('spawnMany parallel returns all results', async () => {
    const o = makeOrchestrator();
    const specs = [
      makeSpec({ role: 'planner' }),
      makeSpec({ role: 'coder' }),
      makeSpec({ role: 'reviewer' }),
    ];
    const results = await o.spawnMany(specs, { mode: 'parallel' });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.ok)).toBe(true);
    const roles = results.map((r) => r.role).sort();
    expect(roles).toEqual(['coder', 'planner', 'reviewer']);
  });

  it('spawnMany serial runs sequentially (verify start order via timestamps)', async () => {
    const order: string[] = [];
    const orderedRunner: SubagentRunner = async (spec, _ctx) => {
      order.push(spec.role);
      return { output: 'done:' + spec.role, toolCalls: 0, iterations: 1, tokensUsed: 10 };
    };
    const o = makeOrchestrator({ runner: orderedRunner });
    const specs = ['first', 'second', 'third'].map((role) => makeSpec({ role }));
    await o.spawnMany(specs, { mode: 'serial' });
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('spawnMany respects concurrencyLimit (track simultaneous in-flight, expect <= limit)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const trackingRunner: SubagentRunner = async (_spec, _ctx) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { output: 'done', toolCalls: 0, iterations: 1, tokensUsed: 10 };
    };
    const o = makeOrchestrator({ runner: trackingRunner, concurrencyLimit: 2 });
    const specs = Array.from({ length: 6 }, (_, i) => makeSpec({ role: `agent-${i}` }));
    await o.spawnMany(specs, { mode: 'parallel' });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('spawnMany empty → []', async () => {
    const o = makeOrchestrator();
    const results = await o.spawnMany([]);
    expect(results).toEqual([]);
  });

  it('spawnMany continues past failure and collects all results', async () => {
    let call = 0;
    const mixedRunner: SubagentRunner = async (spec, _ctx) => {
      call++;
      if (call === 2) throw new Error('second-fails');
      return { output: 'done:' + spec.role, toolCalls: 0, iterations: 1, tokensUsed: 10 };
    };
    const o = makeOrchestrator({ runner: mixedRunner });
    const specs = ['a', 'b', 'c'].map((role) => makeSpec({ role }));
    const results = await o.spawnMany(specs, { mode: 'serial' });
    expect(results).toHaveLength(3);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[2].ok).toBe(true);
  });

  // ── cancel ─────────────────────────────────────────────────────────────────

  it('cancel(unknownId) returns false', () => {
    const o = makeOrchestrator();
    expect(o.cancel('no-such-id')).toBe(false);
  });

  it('cancel returns true for in-flight agent', async () => {
    const o = makeOrchestrator({ runner: makeRunner({ delayMs: 500, checkAbort: true }) });
    const spec = makeSpec({ id: 'in-flight-123' });
    const promise = o.spawn(spec);
    await new Promise((r) => setTimeout(r, 10));
    expect(o.cancel('in-flight-123')).toBe(true);
    await promise;
  });

  it('second cancel on same id returns false (already removed from active)', async () => {
    const o = makeOrchestrator({ runner: makeRunner({ delayMs: 200, checkAbort: true }) });
    const spec = makeSpec({ id: 'double-cancel' });
    const promise = o.spawn(spec);
    await new Promise((r) => setTimeout(r, 10));
    expect(o.cancel('double-cancel')).toBe(true);
    await promise;
    // After promise settles it's removed from active map
    expect(o.cancel('double-cancel')).toBe(false);
  });

  // ── cancelAll ──────────────────────────────────────────────────────────────

  it('cancelAll cancels all in-flight agents; returns count', async () => {
    const o = makeOrchestrator({ runner: makeRunner({ delayMs: 500, checkAbort: true }) });
    const promises = [
      o.spawn(makeSpec({ id: 'ca-1', role: 'planner' })),
      o.spawn(makeSpec({ id: 'ca-2', role: 'coder' })),
      o.spawn(makeSpec({ id: 'ca-3', role: 'reviewer' })),
    ];
    await new Promise((r) => setTimeout(r, 10));
    const count = o.cancelAll();
    expect(count).toBe(3);
    const results = await Promise.all(promises);
    expect(results.every((r) => r.cancelled === true)).toBe(true);
  });

  // ── active ─────────────────────────────────────────────────────────────────

  it('active() lists in-flight specs', async () => {
    const o = makeOrchestrator({ runner: makeRunner({ delayMs: 200 }) });
    const p1 = o.spawn(makeSpec({ id: 'act-1', role: 'planner' }));
    const p2 = o.spawn(makeSpec({ id: 'act-2', role: 'coder' }));
    await new Promise((r) => setTimeout(r, 10));
    const list = o.active();
    expect(list.length).toBe(2);
    const ids = list.map((a) => a.id).sort();
    expect(ids).toEqual(['act-1', 'act-2']);
    await Promise.all([p1, p2]);
    expect(o.active()).toHaveLength(0);
  });

  // ── shutdown ───────────────────────────────────────────────────────────────

  it('shutdown cancels all and awaits; active() is empty afterwards', async () => {
    const o = makeOrchestrator({ runner: makeRunner({ delayMs: 500, checkAbort: true }) });
    o.spawn(makeSpec({ id: 'sd-1', role: 'planner' }));
    o.spawn(makeSpec({ id: 'sd-2', role: 'coder' }));
    await new Promise((r) => setTimeout(r, 10));
    await o.shutdown();
    expect(o.active()).toHaveLength(0);
  });

  it('shutdown is idempotent', async () => {
    const o = makeOrchestrator();
    await o.shutdown();
    await expect(o.shutdown()).resolves.toBeUndefined();
  });

  // ── ID generation ──────────────────────────────────────────────────────────

  it('ULID-style ids are unique across multiple spawns', async () => {
    const o = makeOrchestrator();
    const results = await o.spawnMany(
      Array.from({ length: 10 }, () => makeSpec()),
    );
    const ids = results.map((r) => r.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(10);
  });

  it('spec without id gets a generated id', async () => {
    const o = makeOrchestrator();
    const result = await o.spawn(makeSpec()); // no id
    expect(result.id).toBeTruthy();
    expect(typeof result.id).toBe('string');
  });

  // ── spec field preservation ────────────────────────────────────────────────

  it('role and id are preserved in result', async () => {
    const o = makeOrchestrator();
    const result = await o.spawn(makeSpec({ id: 'preserved-id', role: 'researcher' }));
    expect(result.id).toBe('preserved-id');
    expect(result.role).toBe('researcher');
  });

  // ── defaults ───────────────────────────────────────────────────────────────

  it('maxDurationMs default applied if spec does not specify', async () => {
    // Default is 60_000; we override to 30ms to verify it fires quickly
    const o = makeOrchestrator({
      runner: makeRunner({ delayMs: 500, checkAbort: true }),
      defaultMaxDurationMs: 30,
    });
    const result = await o.spawn(makeSpec()); // no maxDurationMs in spec
    expect(result.ok).toBe(false);
    expect(result.error).toBe('timeout');
  });

  // ── abort signal propagation ───────────────────────────────────────────────

  it('runner receiving signal can detect abort event', async () => {
    let abortDetected = false;
    const abortAwareRunner: SubagentRunner = async (_spec, ctx) => {
      ctx.signal.addEventListener('abort', () => {
        abortDetected = true;
      });
      await new Promise<void>((res, rej) => {
        const t = setTimeout(res, 500);
        ctx.signal.addEventListener('abort', () => {
          clearTimeout(t);
          rej(new Error('aborted'));
        });
      });
      return { output: 'done', toolCalls: 0, iterations: 1, tokensUsed: 10 };
    };
    const o = makeOrchestrator({ runner: abortAwareRunner });
    const spec = makeSpec({ id: 'abort-signal-test' });
    const promise = o.spawn(spec);
    await new Promise((r) => setTimeout(r, 20));
    o.cancel('abort-signal-test');
    await promise;
    expect(abortDetected).toBe(true);
  });

  // ── concurrencyLimit=1 ─────────────────────────────────────────────────────

  it('concurrencyLimit=1 in parallel mode behaves like serial', async () => {
    const order: string[] = [];
    const seqRunner: SubagentRunner = async (spec, _ctx) => {
      order.push(spec.role);
      await new Promise((r) => setTimeout(r, 10));
      return { output: 'done', toolCalls: 0, iterations: 1, tokensUsed: 10 };
    };
    const o = makeOrchestrator({ runner: seqRunner, concurrencyLimit: 1 });
    const specs = ['x', 'y', 'z'].map((role) => makeSpec({ role }));
    await o.spawnMany(specs, { mode: 'parallel' });
    // With limit=1 each runs after the previous completes
    expect(order).toEqual(['x', 'y', 'z']);
  });
});
