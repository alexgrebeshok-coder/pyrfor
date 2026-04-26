import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDaemonHealth } from '../useDaemonHealth';
import { apiEvents } from '../../lib/apiFetch';

vi.mock('../../lib/api', () => ({
  getDaemonPort: vi.fn().mockResolvedValue(18790),
}));

const INTERVAL = 5000;

function mockFetchOk() {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: true,
    status: 200,
  } as Response);
}

function mockFetchFail() {
  (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network error'));
}

/** Advance one poll cycle: tick the interval then flush all pending microtasks. */
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(INTERVAL);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useDaemonHealth', () => {
  it('returns connected after a successful poll', async () => {
    mockFetchOk();
    const { result } = renderHook(() => useDaemonHealth(INTERVAL));

    // Initial poll fires immediately (no timer needed)
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('connected');
    expect(result.current.lastOk).not.toBeNull();
  });

  it('transitions to reconnecting after 1 failure', async () => {
    mockFetchOk();
    const { result } = renderHook(() => useDaemonHealth(INTERVAL));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.status).toBe('connected');

    mockFetchFail();
    await tick();

    expect(result.current.status).toBe('reconnecting');
  });

  it('transitions to offline after 3 consecutive failures', async () => {
    mockFetchOk();
    const { result } = renderHook(() => useDaemonHealth(INTERVAL));
    await act(async () => { await Promise.resolve(); });

    for (let i = 0; i < 3; i++) {
      mockFetchFail();
      await tick();
    }

    expect(result.current.status).toBe('offline');
  });

  it('recovers to connected immediately on next success', async () => {
    mockFetchOk();
    const { result } = renderHook(() => useDaemonHealth(INTERVAL));
    await act(async () => { await Promise.resolve(); });

    for (let i = 0; i < 3; i++) {
      mockFetchFail();
      await tick();
    }
    expect(result.current.status).toBe('offline');

    mockFetchOk();
    await tick();
    expect(result.current.status).toBe('connected');
  });
});

describe('useDaemonHealth — apiEvents integration', () => {
  it('immediately transitions to reconnecting when apiEvents fires retry', async () => {
    // Start with a successful poll so status is 'connected'
    mockFetchOk();
    const { result } = renderHook(() => useDaemonHealth(INTERVAL));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.status).toBe('connected');

    // Fire a retry event (simulates daemonFetch hitting a transient error)
    await act(async () => {
      apiEvents.dispatchEvent(new CustomEvent('retry', {
        detail: { url: 'http://localhost:18790/api/models', attempt: 0, error: new TypeError('Failed to fetch') },
      }));
    });

    expect(result.current.status).toBe('reconnecting');
  });

  it('transitions to connected when apiEvents fires recovered', async () => {
    // Start in default reconnecting state (no successful poll yet)
    const { result } = renderHook(() => useDaemonHealth(INTERVAL));
    // First poll fails to make status stay reconnecting
    mockFetchFail();
    await act(async () => { await Promise.resolve(); });
    expect(result.current.status).toBe('reconnecting');

    // A daemonFetch recovered event should flip to connected immediately
    await act(async () => {
      apiEvents.dispatchEvent(new CustomEvent('recovered', {
        detail: { url: 'http://localhost:18790/api/models' },
      }));
    });

    expect(result.current.status).toBe('connected');
  });
});
