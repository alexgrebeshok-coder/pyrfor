import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiEvents, daemonFetch } from '../apiFetch';
import { clearBearerToken, getBearerToken, syncGatewayBearerFromConfig } from '../authStorage';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(async () => {
  global.fetch = vi.fn();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'get_daemon_port') return Promise.resolve(18790);
    return Promise.resolve(null);
  });
  await clearBearerToken();
});

afterEach(async () => {
  await clearBearerToken();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

describe('P1-1 gateway bearer token sync', () => {
  it('syncGatewayBearerFromConfig stores daemon token from runtime.json', async () => {
    const secrets = new Map<string, string>();
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_daemon_port') return Promise.resolve(18790);
      if (cmd === 'read_pyrfor_config') {
        return Promise.resolve({ gateway: { bearerToken: 'a'.repeat(64) } });
      }
      if (cmd === 'get_secret') {
        const key = String(args?.key ?? '');
        return Promise.resolve(secrets.get(key) ?? '');
      }
      if (cmd === 'set_secret') {
        secrets.set(String(args?.key ?? ''), String(args?.value ?? ''));
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });

    expect(await syncGatewayBearerFromConfig()).toBe(true);
    expect(await getBearerToken()).toBe('a'.repeat(64));
    expect(invokeMock.mock.calls.some(([cmd]) => cmd === 'read_pyrfor_config')).toBe(true);
  });

  it('daemonFetch retries once after syncing token on 401', async () => {
    const syncedToken = 'synced-token-12345678901234567890123456789012';
    const secrets = new Map<string, string>();
    invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'get_daemon_port') return Promise.resolve(18790);
      if (cmd === 'read_pyrfor_config') {
        return Promise.resolve({ gateway: { bearerToken: syncedToken } });
      }
      if (cmd === 'get_secret') {
        const key = String(args?.key ?? '');
        return Promise.resolve(secrets.get(key) ?? '');
      }
      if (cmd === 'set_secret') {
        secrets.set(String(args?.key ?? ''), String(args?.value ?? ''));
        return Promise.resolve(undefined);
      }
      return Promise.resolve(null);
    });

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });

    const res = await daemonFetch('/api/status', undefined, { retries: 0 });

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ${syncedToken}`,
    });
  });

  it('daemonFetch emits auth-required when sync cannot recover 401', async () => {
    invokeMock.mockResolvedValueOnce(null);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: new Headers(),
    });

    const events: unknown[] = [];
    const handler = (e: Event) => events.push((e as CustomEvent).detail);
    apiEvents.addEventListener('auth-required', handler);

    const res = await daemonFetch('/api/status', undefined, { retries: 0 });

    apiEvents.removeEventListener('auth-required', handler);
    expect(res.status).toBe(401);
    expect(events).toHaveLength(1);
  });
});
