import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as apiFetch from '../apiFetch';

beforeEach(() => {
  apiFetch.resetDaemonPortCache();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('probeDaemonHealth', () => {
  it('returns true when default port responds', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 });

    await expect(apiFetch.probeDaemonHealth()).resolves.toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:${apiFetch.DEFAULT_DAEMON_PORT}/health`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('returns false when all ports fail', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));

    await expect(apiFetch.probeDaemonHealth()).resolves.toBe(false);
  });
});
