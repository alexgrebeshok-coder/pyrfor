import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, apiEvents, daemonFetch } from '../apiFetch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOnce(response: Partial<Response> & { ok: boolean; status: number }) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(response as Response);
}

function mockFetchFail(err = new TypeError('Failed to fetch')) {
  (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(err);
}

/** Collect all 'retry' CustomEvent details fired during `fn`. */
async function captureRetryEvents(fn: () => Promise<unknown>): Promise<unknown[]> {
  const details: unknown[] = [];
  const handler = (e: Event) => details.push((e as CustomEvent).detail);
  apiEvents.addEventListener('retry', handler);
  try {
    await fn();
  } catch {
    // ignore; we just want the events
  } finally {
    apiEvents.removeEventListener('retry', handler);
  }
  return details;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('apiFetch', () => {
  it('returns response immediately on success (no retry)', async () => {
    mockFetchOnce({ ok: true, status: 200, headers: new Headers() });

    const res = await apiFetch('http://localhost:1/test', undefined, { retries: 3 });
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on network error and succeeds on attempt 2', async () => {
    mockFetchFail();
    mockFetchOnce({ ok: true, status: 200, headers: new Headers() });

    const promise = apiFetch('http://localhost:1/test', undefined, {
      retries: 3,
      baseDelayMs: 10,
    });

    // Advance past the first backoff
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries on HTTP 503 and succeeds on attempt 2', async () => {
    mockFetchOnce({ ok: false, status: 503, headers: new Headers() });
    mockFetchOnce({ ok: true, status: 200, headers: new Headers() });

    const promise = apiFetch('http://localhost:1/test', undefined, {
      retries: 3,
      baseDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400', async () => {
    mockFetchOnce({ ok: false, status: 400, headers: new Headers() });

    const res = await apiFetch('http://localhost:1/test', undefined, { retries: 3 });
    expect(res.status).toBe(400);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401', async () => {
    mockFetchOnce({ ok: false, status: 401, headers: new Headers() });
    const res = await apiFetch('http://localhost:1/test', undefined, { retries: 3 });
    expect(res.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 403', async () => {
    mockFetchOnce({ ok: false, status: 403, headers: new Headers() });
    const res = await apiFetch('http://localhost:1/test', undefined, { retries: 3 });
    expect(res.status).toBe(403);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404', async () => {
    mockFetchOnce({ ok: false, status: 404, headers: new Headers() });
    const res = await apiFetch('http://localhost:1/test', undefined, { retries: 3 });
    expect(res.status).toBe(404);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('emits retry event with attempt detail on network error', async () => {
    mockFetchFail();
    mockFetchOnce({ ok: true, status: 200, headers: new Headers() });

    const details = await captureRetryEvents(async () => {
      const p = apiFetch('http://localhost:1/api', undefined, {
        retries: 3,
        baseDelayMs: 10,
      });
      await vi.runAllTimersAsync();
      await p;
    });

    expect(details.length).toBeGreaterThanOrEqual(1);
    expect((details[0] as any).attempt).toBe(0);
    expect((details[0] as any).url).toContain('localhost:1');
  });

  it('stops after retries exhausted and throws final error', async () => {
    // 4 failures: initial + 3 retries
    for (let i = 0; i < 4; i++) mockFetchFail();

    const p = apiFetch('http://localhost:1/test', undefined, {
      retries: 3,
      baseDelayMs: 10,
    });
    // Attach a no-op catch early so the rejection is never "unhandled"
    const silenced = p.catch(() => {});
    await vi.runAllTimersAsync();
    await silenced;

    await expect(p).rejects.toThrow(TypeError);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('honors Retry-After header for 429', async () => {
    const retryAfterSec = 2;
    const headers = new Headers({ 'Retry-After': String(retryAfterSec) });
    mockFetchOnce({ ok: false, status: 429, headers });
    mockFetchOnce({ ok: true, status: 200, headers: new Headers() });

    const promise = apiFetch('http://localhost:1/test', undefined, {
      retries: 3,
      baseDelayMs: 300,
    });

    // Should not have resolved without advancing time (Retry-After = 2 s)
    let resolved = false;
    promise.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(1000);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1500); // total 2.5 s → past 2 s
    const res = await promise;
    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('emits retry event for 502', async () => {
    mockFetchOnce({ ok: false, status: 502, headers: new Headers() });
    mockFetchOnce({ ok: true, status: 200, headers: new Headers() });

    const details = await captureRetryEvents(async () => {
      const p = apiFetch('http://localhost:1/api', undefined, {
        retries: 3,
        baseDelayMs: 10,
      });
      await vi.runAllTimersAsync();
      await p;
    });

    expect(details.length).toBeGreaterThanOrEqual(1);
    expect((details[0] as any).attempt).toBe(0);
  });
});

describe('daemonFetch', () => {
  it('prepends daemon URL and adds Authorization header', async () => {
    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => (key === 'pyrfor-token' ? 'test-token' : null)),
    });

    mockFetchOnce({ ok: true, status: 200, headers: new Headers() });

    await daemonFetch('/api/health', undefined, { retries: 0 });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/localhost:\d+\/api\/health$/),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      })
    );
  });
});
