// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDashboardServer } from './dashboard-server';

// ============================================================
// Helpers
// ============================================================

function baseProviders() {
  return {
    skills: vi.fn().mockResolvedValue([{ id: 'skill-1' }, { id: 'skill-2' }]),
    autoTools: vi.fn().mockResolvedValue([{ name: 'tool-a' }]),
    trajectories: vi.fn().mockResolvedValue([{ run: 1 }, { run: 2 }, { run: 3 }]),
    patterns: vi.fn().mockResolvedValue([{ pattern: 'p1' }]),
    costSummary: vi.fn().mockResolvedValue({ totalUsd: 0.42 }),
    experiments: vi.fn().mockResolvedValue([{ exp: 'e1' }, { exp: 'e2' }]),
    memorySummary: vi.fn().mockResolvedValue({ slots: 10 }),
  };
}

async function jsonGet(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ============================================================
// Tests
// ============================================================

describe('DashboardServer', () => {
  let server: ReturnType<typeof createDashboardServer>;
  let baseUrl: string;

  afterEach(async () => {
    await server?.stop().catch(() => {});
  });

  // ----------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------

  it('start returns valid URL with assigned port', async () => {
    server = createDashboardServer({ providers: baseProviders() });
    const { url, port } = await server.start();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    expect(port).toBeGreaterThan(0);
  });

  it('stop closes the server cleanly', async () => {
    server = createDashboardServer({ providers: baseProviders() });
    const { url } = await server.start();
    await server.stop();
    await expect(fetch(`${url}/health`)).rejects.toThrow();
  });

  it('stop before start is a no-op', async () => {
    server = createDashboardServer({ providers: baseProviders() });
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('start twice throws "already started"', async () => {
    server = createDashboardServer({ providers: baseProviders() });
    await server.start();
    await expect(server.start()).rejects.toThrow('already started');
  });

  // ----------------------------------------------------------
  // Routes list
  // ----------------------------------------------------------

  it('routes() lists all registered routes', async () => {
    server = createDashboardServer({ providers: baseProviders() });
    const list = server.routes();
    expect(list).toContain('/health');
    expect(list).toContain('/skills');
    expect(list).toContain('/tools/auto');
    expect(list).toContain('/trajectories');
    expect(list).toContain('/patterns');
    expect(list).toContain('/cost');
    expect(list).toContain('/experiments');
    expect(list).toContain('/memory');
    expect(list).toContain('/summary');
    expect(list.length).toBeGreaterThanOrEqual(10);
  });

  // ----------------------------------------------------------
  // /health
  // ----------------------------------------------------------

  it('/health returns 200 with ok:true', async () => {
    server = createDashboardServer({ providers: baseProviders() });
    const { url } = await server.start();
    const { status, body } = await jsonGet(`${url}/health`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true });
  });

  // ----------------------------------------------------------
  // /skills
  // ----------------------------------------------------------

  it('/skills returns provider data', async () => {
    const p = baseProviders();
    server = createDashboardServer({ providers: p, cacheTtlMs: 0 });
    const { url } = await server.start();
    const { status, body } = await jsonGet(`${url}/skills`);
    expect(status).toBe(200);
    expect(body).toEqual([{ id: 'skill-1' }, { id: 'skill-2' }]);
    expect(p.skills).toHaveBeenCalledOnce();
  });

  it('async provider is awaited', async () => {
    const p = {
      ...baseProviders(),
      skills: vi.fn().mockImplementation(() => new Promise(r => setTimeout(() => r([{ id: 'async-skill' }]), 10))),
    };
    server = createDashboardServer({ providers: p, cacheTtlMs: 0 });
    const { url } = await server.start();
    const { body } = await jsonGet(`${url}/skills`);
    expect(body).toEqual([{ id: 'async-skill' }]);
  });

  it('sync provider is supported', async () => {
    const p = {
      ...baseProviders(),
      skills: () => [{ id: 'sync-skill' }],
    };
    server = createDashboardServer({ providers: p, cacheTtlMs: 0 });
    const { url } = await server.start();
    const { body } = await jsonGet(`${url}/skills`);
    expect(body).toEqual([{ id: 'sync-skill' }]);
  });

  // ----------------------------------------------------------
  // Missing / throwing provider
  // ----------------------------------------------------------

  it('missing provider returns 503', async () => {
    server = createDashboardServer({ providers: {} });
    const { url } = await server.start();
    const { status, body } = await jsonGet(`${url}/skills`);
    expect(status).toBe(503);
    expect(body).toMatchObject({ error: 'provider not configured' });
  });

  it('throwing provider returns 500 with error message', async () => {
    const p = {
      ...baseProviders(),
      skills: vi.fn().mockRejectedValue(new Error('db exploded')),
    };
    server = createDashboardServer({ providers: p, cacheTtlMs: 0 });
    const { url } = await server.start();
    const { status, body } = await jsonGet(`${url}/skills`);
    expect(status).toBe(500);
    expect((body as any).error).toBe('db exploded');
  });

  // ----------------------------------------------------------
  // 404
  // ----------------------------------------------------------

  it('returns 404 for unknown routes', async () => {
    server = createDashboardServer({ providers: baseProviders() });
    const { url } = await server.start();
    const { status } = await jsonGet(`${url}/does-not-exist`);
    expect(status).toBe(404);
  });

  // ----------------------------------------------------------
  // Caching
  // ----------------------------------------------------------

  it('second call within TTL returns cached data without re-invoking provider', async () => {
    const p = baseProviders();
    server = createDashboardServer({ providers: p, cacheTtlMs: 10_000 });
    const { url } = await server.start();
    await jsonGet(`${url}/skills`);
    await jsonGet(`${url}/skills`);
    expect(p.skills).toHaveBeenCalledOnce();
  });

  it('after TTL expiry provider is re-invoked', async () => {
    let now = 0;
    const p = baseProviders();
    server = createDashboardServer({ providers: p, cacheTtlMs: 100, clock: () => now });
    const { url } = await server.start();
    await jsonGet(`${url}/skills`);
    now = 200; // advance past TTL
    await jsonGet(`${url}/skills`);
    expect(p.skills).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache(key) clears specific key', async () => {
    const p = baseProviders();
    server = createDashboardServer({ providers: p, cacheTtlMs: 10_000 });
    const { url } = await server.start();
    await jsonGet(`${url}/skills`);
    server.invalidateCache('/skills');
    await jsonGet(`${url}/skills`);
    expect(p.skills).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache() with no args clears all cached entries', async () => {
    const p = baseProviders();
    server = createDashboardServer({ providers: p, cacheTtlMs: 10_000 });
    const { url } = await server.start();
    await jsonGet(`${url}/skills`);
    await jsonGet(`${url}/tools/auto`);
    server.invalidateCache();
    await jsonGet(`${url}/skills`);
    await jsonGet(`${url}/tools/auto`);
    expect(p.skills).toHaveBeenCalledTimes(2);
    expect(p.autoTools).toHaveBeenCalledTimes(2);
  });

  // ----------------------------------------------------------
  // Auth token
  // ----------------------------------------------------------

  it('authToken: missing Authorization header returns 401', async () => {
    server = createDashboardServer({ providers: baseProviders(), authToken: 'secret' });
    const { url } = await server.start();
    const { status } = await jsonGet(`${url}/health`);
    expect(status).toBe(401);
  });

  it('authToken: wrong token returns 401', async () => {
    server = createDashboardServer({ providers: baseProviders(), authToken: 'secret' });
    const { url } = await server.start();
    const { status } = await jsonGet(`${url}/health`, { Authorization: 'Bearer wrong' });
    expect(status).toBe(401);
  });

  it('authToken: correct token returns 200', async () => {
    server = createDashboardServer({ providers: baseProviders(), authToken: 'secret' });
    const { url } = await server.start();
    const { status } = await jsonGet(`${url}/health`, { Authorization: 'Bearer secret' });
    expect(status).toBe(200);
  });

  it('authToken header comparison is case-insensitive for the header name', async () => {
    server = createDashboardServer({ providers: baseProviders(), authToken: 'tok123' });
    const { url } = await server.start();
    // Node's http lowercases incoming header names, so this covers the case-insensitive path
    const { status } = await jsonGet(`${url}/health`, { AUTHORIZATION: 'Bearer tok123' });
    expect(status).toBe(200);
  });

  // ----------------------------------------------------------
  // /summary
  // ----------------------------------------------------------

  it('/summary aggregates counts from providers', async () => {
    server = createDashboardServer({ providers: baseProviders(), cacheTtlMs: 0 });
    const { url } = await server.start();
    const { status, body } = await jsonGet(`${url}/summary`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      skills: 2,
      autoTools: 1,
      trajectories: 3,
      experiments: 2,
      costUsd: 0.42,
    });
  });

  // ----------------------------------------------------------
  // /trajectories query params
  // ----------------------------------------------------------

  it('/trajectories passes limit and sinceMs to provider', async () => {
    const p = baseProviders();
    server = createDashboardServer({ providers: p, cacheTtlMs: 0 });
    const { url } = await server.start();
    await jsonGet(`${url}/trajectories?limit=5&sinceMs=1000`);
    expect(p.trajectories).toHaveBeenCalledWith({ limit: 5, sinceMs: 1000 });
  });

  // ----------------------------------------------------------
  // /tools/auto
  // ----------------------------------------------------------

  it('/tools/auto returns autoTools provider data', async () => {
    const p = baseProviders();
    server = createDashboardServer({ providers: p, cacheTtlMs: 0 });
    const { url } = await server.start();
    const { status, body } = await jsonGet(`${url}/tools/auto`);
    expect(status).toBe(200);
    expect(body).toEqual([{ name: 'tool-a' }]);
  });

  // ----------------------------------------------------------
  // Root / returns HTML
  // ----------------------------------------------------------

  it('GET / returns HTML page listing route names', async () => {
    server = createDashboardServer({ providers: baseProviders() });
    const { url } = await server.start();
    const res = await fetch(`${url}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('/health');
    expect(html).toContain('/skills');
    expect(html).toContain('/summary');
  });
});
