// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createHttpClient,
  HttpError,
  HttpTimeoutError,
  HttpCircuitOpenError,
} from './http-client';

// ── Helpers ──────────────────────────────────────────────────

function makeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(bodyStr, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makeTextResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
}

/** Build an injected clock + timer that lets tests fast-forward time */
function makeClock(startMs = 0) {
  let now = startMs;
  const timers: { id: number; at: number; cb: () => void }[] = [];
  let nextId = 1;

  const clock = () => now;

  const setTimer = (cb: () => void, ms: number): unknown => {
    const id = nextId++;
    timers.push({ id, at: now + ms, cb });
    return id;
  };

  const clearTimer = (h: unknown) => {
    const idx = timers.findIndex((t) => t.id === h);
    if (idx !== -1) timers.splice(idx, 1);
  };

  /**
   * Step-advance `ms` total time, draining microtasks between each timer
   * that fires.  Because we drain BEFORE incrementing `now`, async code
   * that runs after a fake-resolved promise sees the old clock value when
   * it schedules its next timer — so that timer lands inside our window.
   */
  const advance = async (ms: number) => {
    const target = now + ms;

    for (let iter = 0; iter < 100; iter++) {
      // Drain all pending microtasks at the current clock value so that
      // any async code (e.g. the retry-delay scheduling) runs first.
      for (let i = 0; i < 5; i++) await Promise.resolve();

      // Find the earliest timer that falls within [now, target].
      const due = timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at);

      if (due.length === 0) break;

      const next = due[0];
      now = next.at;
      const idx = timers.indexOf(next);
      if (idx !== -1) timers.splice(idx, 1);
      next.cb();
    }

    now = target;
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  return { clock, setTimer, clearTimer, advance };
}

// ── Tests ────────────────────────────────────────────────────

describe('HttpClient', () => {
  // ── basic GET / POST ────────────────────────────────────────

  it('GET returns parsed JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ hello: 'world' }));
    const client = createHttpClient({ fetchFn });

    const res = await client.get<{ hello: string }>('https://example.com/api');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ hello: 'world' });
    expect(res.attempts).toBe(1);
  });

  it('POST auto-stringifies object body + sets content-type', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ ok: true }));
    const client = createHttpClient({ fetchFn });

    await client.post('https://example.com/api', { name: 'test' });

    const [, init] = fetchFn.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ name: 'test' }));
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('POST does not override explicit content-type', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ ok: true }));
    const client = createHttpClient({ fetchFn });

    await client.post('https://example.com/api', { x: 1 }, {
      headers: { 'Content-Type': 'application/x-custom' },
    });

    const [, init] = fetchFn.mock.calls[0];
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-custom');
  });

  // ── URL resolution ──────────────────────────────────────────

  it('appends query params URL-encoded', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({}));
    const client = createHttpClient({ fetchFn });

    await client.get('https://example.com/search', {
      query: { q: 'hello world', page: 2, active: true },
    });

    const [url] = fetchFn.mock.calls[0];
    expect(url).toContain('q=hello+world');
    expect(url).toContain('page=2');
    expect(url).toContain('active=true');
  });

  it('skips undefined query params', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({}));
    const client = createHttpClient({ fetchFn });

    await client.get('https://example.com/search', {
      query: { q: 'hi', optional: undefined },
    });

    const [url] = fetchFn.mock.calls[0];
    expect(url).not.toContain('optional');
  });

  it('resolves relative URL against baseUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({}));
    const client = createHttpClient({ baseUrl: 'https://api.example.com/v1', fetchFn });

    await client.get('/users');

    const [url] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/users');
  });

  it('does not prefix absolute URL with baseUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({}));
    const client = createHttpClient({ baseUrl: 'https://api.example.com', fetchFn });

    await client.get('https://other.com/resource');

    const [url] = fetchFn.mock.calls[0];
    expect(url).toBe('https://other.com/resource');
  });

  // ── Headers ─────────────────────────────────────────────────

  it('applies defaultHeaders to every request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({}));
    const client = createHttpClient({
      defaultHeaders: { Authorization: 'Bearer tok' },
      fetchFn,
    });

    await client.get('https://example.com/x');

    const [, init] = fetchFn.mock.calls[0];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('per-call headers override defaultHeaders', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({}));
    const client = createHttpClient({
      defaultHeaders: { Authorization: 'Bearer old' },
      fetchFn,
    });

    await client.get('https://example.com/x', { headers: { Authorization: 'Bearer new' } });

    const [, init] = fetchFn.mock.calls[0];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer new');
  });

  // ── Timeout ─────────────────────────────────────────────────

  it('timeout aborts request → throws HttpTimeoutError', async () => {
    const { clock, setTimer, clearTimer, advance } = makeClock();

    const fetchFn = vi.fn().mockImplementation(() => new Promise(() => { /* never */ }));
    const client = createHttpClient({ fetchFn, clock, setTimer, clearTimer, defaultTimeoutMs: 1000 });

    const p = client.get('https://example.com/slow');
    await advance(1001);

    await expect(p).rejects.toBeInstanceOf(HttpTimeoutError);
    const err = await p.catch((e) => e);
    expect(err.code).toBe('HTTP_TIMEOUT');
  });

  // ── Retry ───────────────────────────────────────────────────

  it('retries on 503 then succeeds; attempts === 2', async () => {
    const { clock, setTimer, clearTimer, advance } = makeClock();

    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      call++;
      return call === 1
        ? Promise.resolve(makeResponse('err', 503))
        : Promise.resolve(makeResponse({ ok: true }));
    });

    const client = createHttpClient({
      fetchFn, clock, setTimer, clearTimer,
      defaultRetries: 1,
      retryBackoff: () => 100,
      rng: () => 0,
    });

    const p = client.get<{ ok: boolean }>('https://example.com/api');
    await advance(200);
    const res = await p;

    expect(res.data).toEqual({ ok: true });
    expect(res.attempts).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries on network error then succeeds', async () => {
    const { clock, setTimer, clearTimer, advance } = makeClock();

    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.reject(new Error('Network failure'));
      return Promise.resolve(makeResponse({ ok: true }));
    });

    const client = createHttpClient({
      fetchFn, clock, setTimer, clearTimer,
      defaultRetries: 1,
      retryBackoff: () => 50,
      rng: () => 0,
    });

    const p = client.get<{ ok: boolean }>('https://example.com/api');
    await advance(100);
    const res = await p;

    expect(res.data).toEqual({ ok: true });
    expect(res.attempts).toBe(2);
  });

  it('does not retry on 400', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ error: 'bad' }, 400));
    const client = createHttpClient({ fetchFn, defaultRetries: 3 });

    await expect(client.get('https://example.com/api')).rejects.toBeInstanceOf(HttpError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After header (seconds)', async () => {
    const { clock, setTimer, clearTimer, advance } = makeClock();

    const timers: number[] = [];
    const captureSetTimer = (cb: () => void, ms: number) => {
      timers.push(ms);
      return setTimer(cb, ms);
    };

    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      call++;
      return call === 1
        ? Promise.resolve(makeResponse('retry', 503, { 'retry-after': '2' }))
        : Promise.resolve(makeResponse({ ok: true }));
    });

    const client = createHttpClient({
      fetchFn, clock, setTimer: captureSetTimer, clearTimer,
      defaultRetries: 1,
      retryBackoff: () => 0,
      rng: () => 0,
    });

    const p = client.get('https://example.com/api');
    await advance(3000);
    await p;

    // First timer is the timeout, second is retry-after
    const retryDelays = timers.filter(ms => ms === 2000);
    expect(retryDelays.length).toBeGreaterThan(0);
  });

  it('honors Retry-After header (HTTP-date)', async () => {
    const baseTime = Date.now();
    const { clock, setTimer, clearTimer, advance } = makeClock(baseTime);

    const timers: number[] = [];
    const captureSetTimer = (cb: () => void, ms: number) => {
      timers.push(ms);
      return setTimer(cb, ms);
    };

    const futureDate = new Date(baseTime + 5000).toUTCString();

    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      call++;
      return call === 1
        ? Promise.resolve(makeResponse('retry', 429, { 'retry-after': futureDate }))
        : Promise.resolve(makeResponse({ ok: true }));
    });

    const client = createHttpClient({
      fetchFn, clock, setTimer: captureSetTimer, clearTimer,
      defaultRetries: 1,
      retryBackoff: () => 0,
      rng: () => 0,
    });

    const p = client.get('https://example.com/api');
    await advance(6000);
    await p;

    const retryDelays = timers.filter(ms => ms >= 4000 && ms <= 6000);
    expect(retryDelays.length).toBeGreaterThan(0);
  });

  // ── Circuit breaker ─────────────────────────────────────────

  it('circuit opens after threshold consecutive failures', async () => {
    const { clock, setTimer, clearTimer } = makeClock();

    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(makeResponse('err', 500)));
    const client = createHttpClient({
      fetchFn, clock, setTimer, clearTimer,
      defaultRetries: 0,
      circuit: { failureThreshold: 3, resetAfterMs: 5000 },
    });

    for (let i = 0; i < 3; i++) {
      await client.get('https://example.com/api').catch(() => null);
    }

    expect(client.getStats().circuitOpen).toBe(true);
  });

  it('circuit fast-fails with HTTP_CIRCUIT_OPEN after opening', async () => {
    const { clock, setTimer, clearTimer } = makeClock();

    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(makeResponse('err', 500)));
    const client = createHttpClient({
      fetchFn, clock, setTimer, clearTimer,
      defaultRetries: 0,
      circuit: { failureThreshold: 2, resetAfterMs: 5000 },
    });

    await client.get('https://example.com/api').catch(() => null);
    await client.get('https://example.com/api').catch(() => null);

    const err = await client.get('https://example.com/api').catch((e) => e);
    expect(err).toBeInstanceOf(HttpCircuitOpenError);
    expect(err.code).toBe('HTTP_CIRCUIT_OPEN');
    // fetch should have been called only twice (not the third)
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('circuit enters half-open after resetAfterMs', async () => {
    const { clock, setTimer, clearTimer, advance } = makeClock();

    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(makeResponse('err', 500)));
    const client = createHttpClient({
      fetchFn, clock, setTimer, clearTimer,
      defaultRetries: 0,
      circuit: { failureThreshold: 2, resetAfterMs: 3000 },
    });

    await client.get('https://example.com/api').catch(() => null);
    await client.get('https://example.com/api').catch(() => null);

    expect(client.getStats().circuitOpen).toBe(true);

    // Fast forward past resetAfterMs → half-open
    await advance(3001);

    // In half-open, one trial attempt is allowed (fails again here)
    const err = await client.get('https://example.com/api').catch((e) => e);
    // Should have tried (not fast-fail) — fetch called 3 times total
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(err).toBeInstanceOf(HttpError);
  });

  it('successful trial closes circuit', async () => {
    const { clock, setTimer, clearTimer, advance } = makeClock();

    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      call++;
      // fail twice to open, then succeed on trial
      return call <= 2
        ? Promise.resolve(makeResponse('err', 500))
        : Promise.resolve(makeResponse({ ok: true }));
    });

    const client = createHttpClient({
      fetchFn, clock, setTimer, clearTimer,
      defaultRetries: 0,
      circuit: { failureThreshold: 2, resetAfterMs: 3000 },
    });

    await client.get('https://example.com/api').catch(() => null);
    await client.get('https://example.com/api').catch(() => null);
    expect(client.getStats().circuitOpen).toBe(true);

    await advance(3001); // → half-open

    const res = await client.get<{ ok: boolean }>('https://example.com/api');
    expect(res.data).toEqual({ ok: true });
    expect(client.getStats().circuitOpen).toBe(false);
  });

  // ── Interceptors ────────────────────────────────────────────

  it('calls onRequest interceptor before sending', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({}));
    const onRequest = vi.fn();
    const client = createHttpClient({ fetchFn, onRequest });

    await client.get('https://example.com/api');

    expect(onRequest).toHaveBeenCalledOnce();
    expect(onRequest.mock.calls[0][0].url).toBe('https://example.com/api');
  });

  it('calls onResponse interceptor after success', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ x: 1 }));
    const onResponse = vi.fn();
    const client = createHttpClient({ fetchFn, onResponse });

    await client.get('https://example.com/api');

    expect(onResponse).toHaveBeenCalledOnce();
    const [res] = onResponse.mock.calls[0];
    expect(res.status).toBe(200);
  });

  it('calls onError interceptor on HTTP error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse({ msg: 'gone' }, 410));
    const onError = vi.fn();
    const client = createHttpClient({ fetchFn, onError });

    await client.get('https://example.com/api').catch(() => null);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(HttpError);
  });

  it('calls onError interceptor on network error', async () => {
    const { clock, setTimer, clearTimer } = makeClock();
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const onError = vi.fn();
    const client = createHttpClient({ fetchFn, clock, setTimer, clearTimer, onError, defaultRetries: 0 });

    await client.get('https://example.com/api').catch(() => null);

    expect(onError).toHaveBeenCalledOnce();
  });

  // ── Response types ──────────────────────────────────────────

  it("responseType 'text' returns string", async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeTextResponse('hello text'));
    const client = createHttpClient({ fetchFn });

    const res = await client.get<string>('https://example.com/api', { responseType: 'text' });
    expect(typeof res.data).toBe('string');
    expect(res.data).toBe('hello text');
  });

  it("responseType 'buffer' returns Buffer", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('binary data'));
    const client = createHttpClient({ fetchFn });

    const res = await client.get<Buffer>('https://example.com/api', { responseType: 'buffer' });
    expect(Buffer.isBuffer(res.data)).toBe(true);
    expect(res.data.toString()).toBe('binary data');
  });

  it("responseType 'stream' returns ReadableStream", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('stream data'));
    const client = createHttpClient({ fetchFn });

    const res = await client.get('https://example.com/api', { responseType: 'stream' });
    expect(res.data).toBeDefined();
    // ReadableStream has getReader
    expect(typeof (res.data as ReadableStream).getReader).toBe('function');
  });

  // ── HttpError ───────────────────────────────────────────────

  it('4xx throws HttpError with parsed JSON body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeResponse({ error: 'not found', code: 'E404' }, 404),
    );
    const client = createHttpClient({ fetchFn });

    const err = await client.get('https://example.com/missing').catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ error: 'not found', code: 'E404' });
  });

  it('5xx non-retried (after exhausting retries) throws last error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse('oops', 500));
    const client = createHttpClient({ fetchFn, defaultRetries: 0 });

    const err = await client.get('https://example.com/api').catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(500);
  });

  // ── Stats ───────────────────────────────────────────────────

  it('getStats tracks requests, errors, retries, perStatus', async () => {
    const { clock, setTimer, clearTimer, advance } = makeClock();

    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      call++;
      return call === 1
        ? Promise.resolve(makeResponse('bad', 503))
        : Promise.resolve(makeResponse({ ok: true }));
    });

    const client = createHttpClient({
      fetchFn, clock, setTimer, clearTimer,
      defaultRetries: 1,
      retryBackoff: () => 100,
      rng: () => 0,
    });

    const p = client.get('https://example.com/api');
    await advance(200);
    await p;

    const s = client.getStats();
    expect(s.requests).toBe(1);
    expect(s.retries).toBe(1);
    expect(s.errors).toBe(0);
    expect(s.perStatus[503]).toBe(1);
    expect(s.perStatus[200]).toBe(1);
  });

  it('getStats counts errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeResponse('gone', 410));
    const client = createHttpClient({ fetchFn });

    await client.get('https://example.com/api').catch(() => null);

    expect(client.getStats().errors).toBe(1);
  });

  // ── resetCircuit ────────────────────────────────────────────

  it('resetCircuit closes circuit immediately', async () => {
    const { clock, setTimer, clearTimer } = makeClock();

    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(makeResponse('err', 500)));
    const client = createHttpClient({
      fetchFn, clock, setTimer, clearTimer,
      defaultRetries: 0,
      circuit: { failureThreshold: 2, resetAfterMs: 10000 },
    });

    await client.get('https://example.com/api').catch(() => null);
    await client.get('https://example.com/api').catch(() => null);
    expect(client.getStats().circuitOpen).toBe(true);

    client.resetCircuit();
    expect(client.getStats().circuitOpen).toBe(false);

    // next request should go through (will fail again, but not circuit-open fail)
    fetchFn.mockImplementationOnce(() => Promise.resolve(makeResponse({ ok: true })));
    const res = await client.get<{ ok: boolean }>('https://example.com/api');
    expect(res.data).toEqual({ ok: true });
  });

  // ── Signal abort ────────────────────────────────────────────

  it('user signal abort propagates → throws', async () => {
    const ac = new AbortController();

    const fetchFn = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        });
        ac.abort(); // trigger immediately
      });
    });

    const client = createHttpClient({ fetchFn, defaultRetries: 0 });

    await expect(
      client.get('https://example.com/api', { signal: ac.signal }),
    ).rejects.toThrow();
  });

  // ── HTTP methods ─────────────────────────────────────────────

  it('supports HEAD method', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const client = createHttpClient({ fetchFn });

    await client.request({ url: 'https://example.com/api', method: 'HEAD', responseType: 'text' });

    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe('HEAD');
  });

  it('supports OPTIONS method', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(null, { status: 204, headers: { Allow: 'GET,POST' } }),
    );
    const client = createHttpClient({ fetchFn });

    await client.request({ url: 'https://example.com/api', method: 'OPTIONS', responseType: 'text' });

    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe('OPTIONS');
  });

  it('PUT and PATCH send body', async () => {
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(makeResponse({ updated: true })));
    const client = createHttpClient({ fetchFn });

    await client.put('https://example.com/api/1', { value: 42 });
    await client.patch('https://example.com/api/1', { value: 43 });

    const [, putInit] = fetchFn.mock.calls[0];
    const [, patchInit] = fetchFn.mock.calls[1];
    expect(putInit.method).toBe('PUT');
    expect(putInit.body).toBe(JSON.stringify({ value: 42 }));
    expect(patchInit.method).toBe('PATCH');
    expect(patchInit.body).toBe(JSON.stringify({ value: 43 }));
  });

  it('DELETE sends request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createHttpClient({ fetchFn });

    const res = await client.delete('https://example.com/api/1');
    expect(res.status).toBe(204);

    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe('DELETE');
  });

  // ── durationMs ──────────────────────────────────────────────

  it('response durationMs reflects elapsed time', async () => {
    let now = 1000;
    const clock = () => now;
    const setTimer = (cb: () => void, ms: number) => setTimeout(cb, ms);
    const clearTimer = (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>);

    const fetchFn = vi.fn().mockImplementation(async () => {
      now += 250;
      return makeResponse({ ok: true });
    });

    const client = createHttpClient({ fetchFn, clock, setTimer, clearTimer });
    const res = await client.get('https://example.com/api');
    expect(res.durationMs).toBe(250);
  });

  // ── Edge cases ───────────────────────────────────────────────

  it('empty response body decoded as null for json type', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    const client = createHttpClient({ fetchFn });

    const res = await client.get('https://example.com/api');
    expect(res.data).toBeNull();
  });

  it('response headers are accessible', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'x-custom': 'value123' } }),
    );
    const client = createHttpClient({ fetchFn });

    const res = await client.get('https://example.com/api');
    expect(res.headers['x-custom']).toBe('value123');
  });

  it('stats circuitOpen false by default', () => {
    const client = createHttpClient({});
    expect(client.getStats().circuitOpen).toBe(false);
  });

  it('stats requests increments per request', async () => {
    const fetchFn = vi.fn().mockImplementation(() => Promise.resolve(makeResponse({})));
    const client = createHttpClient({ fetchFn });

    await client.get('https://example.com/a');
    await client.get('https://example.com/b');

    expect(client.getStats().requests).toBe(2);
  });

  it('multiple retries exhaust and throw', async () => {
    const { clock, setTimer, clearTimer, advance } = makeClock();

    const fetchFn = vi.fn().mockResolvedValue(makeResponse('server error', 503));
    const client = createHttpClient({
      fetchFn, clock, setTimer, clearTimer,
      defaultRetries: 2,
      retryBackoff: () => 100,
      rng: () => 0,
    });

    const p = client.get('https://example.com/api');
    await advance(500);

    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
