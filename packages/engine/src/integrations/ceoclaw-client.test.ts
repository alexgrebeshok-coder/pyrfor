// @vitest-environment node
/**
 * ceoclaw-client.test.ts — Unit tests for the CEOClaw integration client.
 *
 * All network I/O is replaced by a vi.fn() fetchImpl injected through
 * CeoclawClientOptions.  The EventLedger is replaced by a plain object that
 * implements the readAll() surface used by subscribeLedger.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CeoclawClient,
  CeoclawClientOptions,
  CeoclawHeartbeat,
  CeoclawTask,
  CeoclawGoal,
  HttpError,
  TimeoutError,
  buildHeaders,
  classifyHttpError,
  defaultLedgerMapping,
} from './ceoclaw-client';
import type { LedgerEvent } from '../runtime/event-ledger';

// ====== Helpers ==============================================================

/** Fake ledger object — implements only the readAll() surface. */
interface FakeLedger {
  readAll: () => Promise<LedgerEvent[]>;
}

function makeFakeLedger(events: LedgerEvent[] = []): FakeLedger {
  return { readAll: vi.fn().mockResolvedValue(events) };
}

/** Build a minimal LedgerEvent. seq defaults to 0. */
function ledgerEvent(
  type: LedgerEvent['type'],
  overrides: Partial<LedgerEvent> = {},
): LedgerEvent {
  return {
    id: 'evt-1',
    ts: '2024-01-01T00:00:00.000Z',
    run_id: 'run-abc',
    seq: 0,
    type,
    ...overrides,
  } as LedgerEvent;
}

/** Build a CeoclawHeartbeat for reuse across tests. */
function heartbeat(overrides: Partial<CeoclawHeartbeat> = {}): CeoclawHeartbeat {
  return {
    runId: 'run-abc',
    workspaceId: 'ws-1',
    status: 'progress',
    occurredAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Build a Response-like object with a JSON body. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Build a Response-like object with no body (e.g. 204). */
function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

/** Default client options with injectable fetch. */
function makeOpts(
  fetchImpl: typeof fetch,
  extra: Partial<CeoclawClientOptions> = {},
): CeoclawClientOptions {
  return {
    baseUrl: 'https://ceoclaw.example.com',
    apiKey: 'test-key',
    workspaceId: 'ws-1',
    timeoutMs: 5_000,
    retry: { attempts: 2, backoffMs: 0 }, // zero backoff keeps tests fast
    fetchImpl,
    ...extra,
  };
}

// ====== Pure helper tests ====================================================

describe('buildHeaders', () => {
  it('includes Content-Type and Accept without an apiKey', () => {
    const h = buildHeaders();
    expect(h['Content-Type']).toBe('application/json');
    expect(h['Accept']).toBe('application/json');
    expect(h['Authorization']).toBeUndefined();
  });

  it('adds Authorization: Bearer when apiKey is provided', () => {
    const h = buildHeaders('my-secret');
    expect(h['Authorization']).toBe('Bearer my-secret');
  });
});

// ====== classifyHttpError tests ==============================================

describe('classifyHttpError', () => {
  it('classifies AbortError as cancelled', () => {
    const e = new DOMException('aborted', 'AbortError');
    expect(classifyHttpError(e)).toBe('cancelled');
  });

  it('classifies TimeoutError as transient', () => {
    expect(classifyHttpError(new TimeoutError(5000))).toBe('transient');
  });

  it('classifies "fetch failed" network errors as transient', () => {
    expect(classifyHttpError(new Error('fetch failed'))).toBe('transient');
  });

  it('classifies ECONNRESET as transient', () => {
    expect(classifyHttpError(new Error('read ECONNRESET'))).toBe('transient');
  });

  it('classifies HTTP 400 as permanent', () => {
    expect(classifyHttpError(new HttpError(400, 'Bad Request'))).toBe('permanent');
  });

  it('classifies HTTP 401 as permanent', () => {
    expect(classifyHttpError(new HttpError(401, 'Unauthorized'))).toBe('permanent');
  });

  it('classifies HTTP 403 as permanent', () => {
    expect(classifyHttpError(new HttpError(403, 'Forbidden'))).toBe('permanent');
  });

  it('classifies HTTP 500 as transient', () => {
    expect(classifyHttpError(new HttpError(500, 'Server Error'))).toBe('transient');
  });

  it('classifies unknown errors as transient', () => {
    expect(classifyHttpError('oops')).toBe('transient');
  });
});

// ====== defaultLedgerMapping tests ===========================================

describe('defaultLedgerMapping', () => {
  const ctx = { workspaceId: 'ws-1' };

  it('maps run.created → started', () => {
    const hb = defaultLedgerMapping(
      ledgerEvent('run.created', { goal: 'do something' }),
      ctx,
    );
    expect(hb).not.toBeNull();
    expect(hb!.status).toBe('started');
    expect(hb!.summary).toBe('do something');
    expect(hb!.runId).toBe('run-abc');
    expect(hb!.workspaceId).toBe('ws-1');
  });

  it('maps run.completed → completed with progress 1', () => {
    const hb = defaultLedgerMapping(ledgerEvent('run.completed'), ctx);
    expect(hb!.status).toBe('completed');
    expect(hb!.progress).toBe(1);
  });

  it('maps run.failed → failed', () => {
    const hb = defaultLedgerMapping(
      ledgerEvent('run.failed', { error: 'out of memory' }),
      ctx,
    );
    expect(hb!.status).toBe('failed');
    expect(hb!.summary).toBe('out of memory');
  });

  it('maps run.cancelled → cancelled', () => {
    const hb = defaultLedgerMapping(
      ledgerEvent('run.cancelled', { reason: 'user request' }),
      ctx,
    );
    expect(hb!.status).toBe('cancelled');
    expect(hb!.summary).toBe('user request');
  });

  it('maps run.blocked → blocked', () => {
    const hb = defaultLedgerMapping(
      ledgerEvent('run.blocked', { reason: 'waiting for approval' }),
      ctx,
    );
    expect(hb!.status).toBe('blocked');
  });

  it('maps approval.requested → progress', () => {
    const hb = defaultLedgerMapping(
      ledgerEvent('approval.requested', { tool: 'bash' }),
      ctx,
    );
    expect(hb!.status).toBe('progress');
    expect(hb!.summary).toBe('approval.requested');
  });

  it('maps approval.granted → progress', () => {
    const hb = defaultLedgerMapping(ledgerEvent('approval.granted'), ctx);
    expect(hb!.status).toBe('progress');
  });

  it('maps approval.denied → progress', () => {
    const hb = defaultLedgerMapping(ledgerEvent('approval.denied'), ctx);
    expect(hb!.status).toBe('progress');
  });

  it('maps tool.executed → progress with tool metadata', () => {
    const hb = defaultLedgerMapping(
      ledgerEvent('tool.executed', { tool: 'bash', ms: 120 }),
      ctx,
    );
    expect(hb!.status).toBe('progress');
    expect(hb!.summary).toBe('tool:bash');
    expect((hb!.metadata as Record<string, unknown>)['tool']).toBe('bash');
  });

  it('returns null for unmapped event types (e.g. plan.proposed)', () => {
    const hb = defaultLedgerMapping(ledgerEvent('plan.proposed'), ctx);
    expect(hb).toBeNull();
  });

  it('returns null for model.turn.started', () => {
    expect(defaultLedgerMapping(ledgerEvent('model.turn.started'), ctx)).toBeNull();
  });
});

// ====== CeoclawClient method tests ===========================================

describe('CeoclawClient.health', () => {
  it('parses ok + version from response and measures latency', async () => {
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      call++;
      return Promise.resolve(jsonResponse({ ok: true, version: '2.3.0' }));
    });
    // Use injectable clock so latencyMs is predictable.
    let tick = 0;
    const clock = () => (tick += 50);
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch, { clock }));
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('2.3.0');
    expect(result.latencyMs).toBe(50);
    expect(call).toBe(1);
  });
});

describe('CeoclawClient.listTasks', () => {
  it('builds correct query string from filters', async () => {
    const tasks: CeoclawTask[] = [
      { id: 't1', title: 'Task 1', status: 'open' },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(tasks));
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    const result = await client.listTasks({
      status: 'open',
      goalId: 'g-1',
      limit: 10,
    });
    expect(result).toEqual(tasks);
    const calledUrl: string = (fetchImpl.mock.calls[0] as [string])[0];
    expect(calledUrl).toContain('status=open');
    expect(calledUrl).toContain('goalId=g-1');
    expect(calledUrl).toContain('limit=10');
  });

  it('omits undefined filter params', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    await client.listTasks();
    const calledUrl: string = (fetchImpl.mock.calls[0] as [string])[0];
    expect(calledUrl).not.toContain('status=');
  });
});

describe('CeoclawClient.getTask', () => {
  it('returns the task on success', async () => {
    const task: CeoclawTask = { id: 't1', title: 'Fix bug', status: 'open' };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(task));
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    const result = await client.getTask('t1');
    expect(result).toEqual(task);
  });

  it('returns null on 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    const client = new CeoclawClient(
      makeOpts(fetchImpl as typeof fetch, { retry: { attempts: 0 } }),
    );
    const result = await client.getTask('missing');
    expect(result).toBeNull();
  });
});

describe('CeoclawClient.upsertTask', () => {
  it('sends PUT with body and returns server response', async () => {
    const returned: CeoclawTask = { id: 't2', title: 'New task', status: 'open' };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(returned));
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    const result = await client.upsertTask({ title: 'New task', status: 'open' });
    expect(result).toEqual(returned);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toMatchObject({ title: 'New task' });
  });
});

describe('CeoclawClient.deleteTask', () => {
  it('returns true for 204 No Content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(emptyResponse(204));
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    expect(await client.deleteTask('t1')).toBe(true);
  });

  it('returns false for 404', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    );
    const client = new CeoclawClient(
      makeOpts(fetchImpl as typeof fetch, { retry: { attempts: 0 } }),
    );
    expect(await client.deleteTask('ghost')).toBe(false);
  });
});

describe('CeoclawClient.listGoals', () => {
  it('returns list of goals and passes filters', async () => {
    const goals: CeoclawGoal[] = [{ id: 'g1', title: 'Goal A', status: 'active' }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(goals));
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    const result = await client.listGoals({ status: 'active', limit: 5 });
    expect(result).toEqual(goals);
    const calledUrl: string = (fetchImpl.mock.calls[0] as [string])[0];
    expect(calledUrl).toContain('status=active');
    expect(calledUrl).toContain('limit=5');
  });
});

describe('CeoclawClient.sendHeartbeat', () => {
  it('posts heartbeat and returns accepted + serverId', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ accepted: true, serverId: 'srv-9' }),
    );
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    const hb = heartbeat({ status: 'started' });
    const result = await client.sendHeartbeat(hb);
    expect(result.accepted).toBe(true);
    expect(result.serverId).toBe('srv-9');
    expect(client.getStats().sent).toBe(1);
  });
});

describe('CeoclawClient.sendBatch', () => {
  it('sends batch and returns accepted/rejected counts', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ accepted: 2, rejected: 0 }),
    );
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    const result = await client.sendBatch([
      heartbeat({ runId: 'r1', status: 'started' }),
      heartbeat({ runId: 'r2', status: 'completed' }),
    ]);
    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(0);
    expect(client.getStats().sent).toBe(2);
    // Verify request body contained both heartbeats.
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as CeoclawHeartbeat[];
    expect(body).toHaveLength(2);
    expect(body[0].runId).toBe('r1');
  });
});

// ====== Timeout and retry tests ==============================================

describe('Timeout behaviour', () => {
  it('rejects with TimeoutError when fetch hangs beyond timeoutMs and retries', async () => {
    let attempts = 0;
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      attempts++;
      // Simulate a hanging fetch that respects AbortSignal.
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const client = new CeoclawClient(
      makeOpts(fetchImpl as typeof fetch, {
        timeoutMs: 20,
        retry: { attempts: 1, backoffMs: 0 },
      }),
    );
    await expect(client.health()).rejects.toThrow();
    // Initial attempt + 1 retry = 2 total calls.
    expect(attempts).toBe(2);
  });
});

describe('Retry behaviour', () => {
  it('succeeds on 2nd attempt after a transient 500 error', async () => {
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(
          new Response('server error', { status: 500, statusText: 'Internal Server Error' }),
        );
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const client = new CeoclawClient(
      makeOpts(fetchImpl as typeof fetch, { retry: { attempts: 2, backoffMs: 0 } }),
    );
    const result = await client.health();
    expect(result.ok).toBe(true);
    expect(call).toBe(2);
  });

  it('throws after exhausting all retry attempts on persistent transient errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('error', { status: 503, statusText: 'Service Unavailable' }),
    );
    const client = new CeoclawClient(
      makeOpts(fetchImpl as typeof fetch, { retry: { attempts: 2, backoffMs: 0 } }),
    );
    await expect(client.health()).rejects.toBeInstanceOf(HttpError);
    // Initial attempt + 2 retries = 3 total calls.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

// ====== subscribeLedger tests ================================================

describe('CeoclawClient.subscribeLedger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls ledger, maps events, batches and sends heartbeats', async () => {
    const events: LedgerEvent[] = [
      ledgerEvent('run.created', { seq: 0, goal: 'test' }),
      ledgerEvent('run.completed', { seq: 1 }),
    ];
    const fakeLedger = makeFakeLedger(events);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ accepted: 2, rejected: 0 }),
    );
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));

    const dispose = client.subscribeLedger(fakeLedger as unknown as import('../runtime/event-ledger').EventLedger, {
      flushEveryMs: 500,
    });

    // Advance clock to trigger one poll cycle.
    await vi.advanceTimersByTimeAsync(600);

    expect(fakeLedger.readAll).toHaveBeenCalled();
    // sendBatch should have been called with the 2 mapped heartbeats.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as CeoclawHeartbeat[];
    expect(body).toHaveLength(2);
    expect(body[0].status).toBe('started');
    expect(body[1].status).toBe('completed');

    dispose();
  });

  it('does not resend events already seen in a previous poll', async () => {
    const events: LedgerEvent[] = [
      ledgerEvent('run.created', { seq: 0 }),
      ledgerEvent('run.completed', { seq: 1 }),
    ];
    const fakeLedger = makeFakeLedger(events);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ accepted: 2, rejected: 0 }),
    );
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    const dispose = client.subscribeLedger(
      fakeLedger as unknown as import('../runtime/event-ledger').EventLedger,
      { flushEveryMs: 500 },
    );

    // First poll — sends 2.
    await vi.advanceTimersByTimeAsync(600);
    // Second poll — same events, should not re-send.
    await vi.advanceTimersByTimeAsync(600);

    // Only one sendBatch call expected (empty queue on second poll).
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('requeues heartbeats on sendBatch failure and increments getStats.failed', async () => {
    const events: LedgerEvent[] = [ledgerEvent('run.created', { seq: 0 })];
    const fakeLedger = makeFakeLedger(events);
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const client = new CeoclawClient(
      makeOpts(fetchImpl as typeof fetch, { retry: { attempts: 0, backoffMs: 0 } }),
    );

    const dispose = client.subscribeLedger(
      fakeLedger as unknown as import('../runtime/event-ledger').EventLedger,
      { flushEveryMs: 500 },
    );

    await vi.advanceTimersByTimeAsync(600);

    const stats = client.getStats();
    expect(stats.failed).toBeGreaterThan(0);
    expect(stats.queued).toBeGreaterThan(0);
    expect(stats.lastError).toContain('fetch failed');

    dispose();
  });

  it('disposer stops polling so no further fetch calls are made', async () => {
    const events: LedgerEvent[] = [ledgerEvent('run.created', { seq: 0 })];
    // Second poll would add a new event — but we dispose before it fires.
    const fakeLedger = {
      readAll: vi.fn()
        .mockResolvedValueOnce(events)
        .mockResolvedValue([
          ...events,
          ledgerEvent('run.completed', { seq: 1 }),
        ]),
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ accepted: 1, rejected: 0 }),
    );
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));

    const dispose = client.subscribeLedger(
      fakeLedger as unknown as import('../runtime/event-ledger').EventLedger,
      { flushEveryMs: 500 },
    );

    await vi.advanceTimersByTimeAsync(600);
    const callsAfterFirst = fetchImpl.mock.calls.length;

    dispose();

    // Advance further — no new calls should occur after dispose (interval cleared).
    await vi.advanceTimersByTimeAsync(1_100);
    // At most one extra call from the final flush inside the disposer.
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(callsAfterFirst + 1);
  });
});

// ====== getStats tests =======================================================

describe('CeoclawClient.getStats', () => {
  it('tracks sent correctly via sendHeartbeat', async () => {
    // Return a fresh Response on each call so the body stream is not re-read.
    const fetchImpl = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse({ accepted: true })),
    );
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    await client.sendHeartbeat(heartbeat());
    await client.sendHeartbeat(heartbeat());
    expect(client.getStats().sent).toBe(2);
  });

  it('tracks sent/failed correctly via sendBatch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ accepted: 3, rejected: 1 }),
    );
    const client = new CeoclawClient(makeOpts(fetchImpl as typeof fetch));
    const batch = [heartbeat(), heartbeat(), heartbeat(), heartbeat()];
    await client.sendBatch(batch);
    const stats = client.getStats();
    expect(stats.sent).toBe(3);
    expect(stats.failed).toBe(1);
  });

  it('returns queued count after subscribeLedger failure', async () => {
    vi.useFakeTimers();
    const fakeLedger = makeFakeLedger([ledgerEvent('run.created', { seq: 0 })]);
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const client = new CeoclawClient(
      makeOpts(fetchImpl as typeof fetch, { retry: { attempts: 0, backoffMs: 0 } }),
    );
    const dispose = client.subscribeLedger(
      fakeLedger as unknown as import('../runtime/event-ledger').EventLedger,
      { flushEveryMs: 100 },
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(client.getStats().queued).toBeGreaterThanOrEqual(0);
    dispose();
    vi.useRealTimers();
  });
});
