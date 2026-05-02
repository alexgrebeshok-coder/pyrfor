// @vitest-environment node
/**
 * Tests for runtime HTTP gateway.
 *
 * Uses port 0 so the OS assigns an ephemeral port — no conflicts between runs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RuntimeConfig } from './config';
import type { HealthMonitor } from './health';
import type { CronService } from './cron';
import type { PyrforRuntime } from './index';
import { createRuntimeGateway } from './gateway';

// Silence logger output during tests
process.env.LOG_LEVEL = 'silent';

// ─── Minimal config factory ────────────────────────────────────────────────

function makeConfig(
  overrides?: Partial<RuntimeConfig['gateway']>,
  rateLimitOverrides?: Partial<RuntimeConfig['rateLimit']>
): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port: 0, // OS-assigned
      bearerToken: undefined,
      bearerTokens: [],
      ...overrides,
    },
    rateLimit: {
      enabled: false,
      capacity: 60,
      refillPerSec: 1,
      exemptPaths: ['/ping', '/health', '/metrics'],
      ...rateLimitOverrides,
    },
  } as unknown as RuntimeConfig;
}

// ─── Minimal mock runtime ──────────────────────────────────────────────────

function makeRuntime(response = 'hello from mock'): PyrforRuntime {
  return {
    handleMessage: vi.fn().mockResolvedValue({ success: true, response }),
  } as unknown as PyrforRuntime;
}

// ─── Minimal mock health monitor ──────────────────────────────────────────

function makeHealth(status: 'healthy' | 'unhealthy' = 'healthy'): HealthMonitor {
  return {
    getLastSnapshot: vi.fn().mockReturnValue({ status, checks: {} }),
  } as unknown as HealthMonitor;
}

// ─── Minimal mock cron service ─────────────────────────────────────────────

function makeCron(): CronService {
  return {
    getStatus: vi.fn().mockReturnValue([{ name: 'daily', enabled: true }]),
    triggerJob: vi.fn().mockResolvedValue(undefined),
  } as unknown as CronService;
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

async function get(
  port: number,
  path: string,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function post(
  port: number,
  path: string,
  payload: unknown,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function options(
  port: number,
  path: string
): Promise<{ status: number; headers: Headers }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'OPTIONS' });
  return { status: res.status, headers: res.headers };
}

/** Send raw string body (e.g. malformed JSON) via POST. */
async function postRaw(
  port: number,
  path: string,
  body: string,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Send GET with a raw Authorization header value (no automatic "Bearer " prefix). */
async function getRawAuth(
  port: number,
  path: string,
  authHeader: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { Authorization: authHeader },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('createRuntimeGateway', () => {
  let port: number;

  describe('no auth configured', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;
    let runtime: PyrforRuntime;
    let cron: CronService;

    beforeEach(async () => {
      runtime = makeRuntime();
      cron = makeCron();
      gw = createRuntimeGateway({
        config: makeConfig(),
        runtime,
        health: makeHealth(),
        cron,
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => {
      await gw.stop();
    });

    it('GET /ping returns 200 { ok: true } without auth', async () => {
      const { status, body } = await get(port, '/ping');
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true });
    });

    it('GET /health returns 200 with snapshot', async () => {
      const { status, body } = await get(port, '/health');
      expect(status).toBe(200);
      expect(body).toMatchObject({ status: 'healthy' });
    });

    it('GET /health returns 503 when status is unhealthy', async () => {
      const gwUnhealthy = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: makeHealth('unhealthy'),
      });
      await gwUnhealthy.start();
      const p = gwUnhealthy.port;
      const { status } = await get(p, '/health');
      await gwUnhealthy.stop();
      expect(status).toBe(503);
    });

    it('GET /status returns uptime, config, cron, health', async () => {
      const { status, body } = await get(port, '/status');
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(typeof b['uptime']).toBe('number');
      expect(b).toHaveProperty('config');
      expect(b).toHaveProperty('cron');
      expect(b).toHaveProperty('health');
    });

    it('GET /cron/jobs returns job list', async () => {
      const { status, body } = await get(port, '/cron/jobs');
      expect(status).toBe(200);
      expect((body as { jobs: unknown[] }).jobs).toHaveLength(1);
    });

    it('POST /cron/trigger calls cron.triggerJob', async () => {
      const { status, body } = await post(port, '/cron/trigger', { name: 'daily' });
      expect(status).toBe(200);
      expect(body).toMatchObject({ ok: true, name: 'daily' });
      expect(vi.mocked(cron.triggerJob)).toHaveBeenCalledWith('daily');
    });

    it('POST /cron/trigger returns 400 when name missing', async () => {
      const { status } = await post(port, '/cron/trigger', {});
      expect(status).toBe(400);
    });

    it('POST /v1/chat/completions returns OpenAI-shaped response', async () => {
      const { status, body } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: 'Hi there' }],
      });
      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(b['object']).toBe('chat.completion');
      const choices = b['choices'] as Array<{
        index: number;
        message: { role: string; content: string };
        finish_reason: string;
      }>;
      expect(choices).toHaveLength(1);
      expect(choices[0].index).toBe(0);
      expect(choices[0].message.role).toBe('assistant');
      expect(choices[0].message.content).toBe('hello from mock');
      expect(choices[0].finish_reason).toBe('stop');
      expect(typeof b['id']).toBe('string');
      expect(typeof b['created']).toBe('number');
    });

    it('POST /v1/chat/completions forwards channel/userId/chatId to runtime', async () => {
      await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: 'ping' }],
        channel: 'telegram',
        userId: 'u1',
        chatId: 'c1',
      });
      expect(vi.mocked(runtime.handleMessage)).toHaveBeenCalledWith(
        'telegram',
        'u1',
        'c1',
        'ping'
      );
    });

    it('POST /v1/chat/completions returns 400 when messages empty', async () => {
      const { status } = await post(port, '/v1/chat/completions', { messages: [] });
      expect(status).toBe(400);
    });

    it('OPTIONS returns 204 with CORS headers', async () => {
      const { status, headers } = await options(port, '/v1/chat/completions');
      expect(status).toBe(204);
      expect(headers.get('access-control-allow-origin')).toBe('*');
      expect(headers.get('access-control-allow-methods')).toContain('POST');
    });

    it('unknown route returns 404', async () => {
      const { status } = await get(port, '/not-a-real-route');
      expect(status).toBe(404);
    });

    it('GET /metrics returns 200 text/plain with Prometheus format', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const body = await res.text();
      expect(body).toContain('# HELP pyrfor_runtime_uptime_seconds');
      expect(body).toContain('# TYPE pyrfor_runtime_uptime_seconds gauge');
      expect(body).toContain('pyrfor_runtime_uptime_seconds');
      expect(body).toContain('pyrfor_cron_jobs_registered');
    });

    it('GET /metrics includes cron and health data when deps provided', async () => {
      const gwFull = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: makeHealth('healthy'),
        cron: makeCron(),
      });
      await gwFull.start();
      const p = gwFull.port;
      try {
        const res = await fetch(`http://127.0.0.1:${p}/metrics`);
        expect(res.status).toBe(200);
        const body = await res.text();
        // Health data (makeHealth returns checks: {} so no check lines, but snapshot exists)
        expect(body).toContain('pyrfor_runtime_uptime_seconds');
        // Cron data (makeCron returns [{name:'daily', ...}])
        expect(body).toContain('pyrfor_cron_jobs_registered 1');
      } finally {
        await gwFull.stop();
      }
    });

    it('stop() closes server cleanly (no hanging handles)', async () => {
      await gw.stop();
      // Double stop should not throw
      await gw.stop();
    });
  });

  describe('bearer auth configured', () => {
    const TOKEN = 'test-secret-token';
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig({ bearerToken: TOKEN }),
        runtime: makeRuntime(),
        health: makeHealth(),
        cron: makeCron(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => {
      await gw.stop();
    });

    it('GET /ping accessible without auth', async () => {
      const { status } = await get(port, '/ping');
      expect(status).toBe(200);
    });

    it('GET /health accessible without auth', async () => {
      const { status } = await get(port, '/health');
      expect(status).toBe(200);
    });

    it('GET /metrics returns 401 without bearer token', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/metrics`);
      expect(res.status).toBe(401);
    });

    it('GET /metrics returns 200 with valid bearer token', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/metrics`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
    });

    it('GET /api/agents returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/agents');
      expect(status).toBe(401);
    });

    it('GET /api/settings returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/settings');
      expect(status).toBe(401);
    });

    it('GET /api/stats returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/stats');
      expect(status).toBe(401);
    });

    it('GET /status returns 401 without bearer token', async () => {
      const { status, body } = await get(port, '/status');
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['error']).toBe('unauthorized');
    });

    it('GET /status returns 200 with valid bearer token', async () => {
      const { status } = await get(port, '/status', TOKEN);
      expect(status).toBe(200);
    });

    it('POST /v1/chat/completions returns 401 without bearer token', async () => {
      const { status } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: 'hi' }],
      });
      expect(status).toBe(401);
    });

    it('POST /v1/chat/completions returns 200 with valid bearer token', async () => {
      const { status } = await post(
        port,
        '/v1/chat/completions',
        { messages: [{ role: 'user', content: 'hi' }] },
        TOKEN
      );
      expect(status).toBe(200);
    });

    it('POST /cron/trigger returns 401 with wrong token', async () => {
      const { status, body } = await post(
        port,
        '/cron/trigger',
        { name: 'daily' },
        'wrong-token'
      );
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['reason']).toBe('unknown');
    });
  });

  describe('bearer token rotation', () => {
    const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
    const PAST = new Date(Date.now() - 86_400_000).toISOString();
    let gw: ReturnType<typeof createRuntimeGateway>;

    afterEach(async () => {
      await gw.stop();
    });

    it('accepts a valid rotated token from bearerTokens list', async () => {
      gw = createRuntimeGateway({
        config: makeConfig({
          bearerTokens: [{ value: 'rotatedtoken1', label: 'v2', expiresAt: FUTURE }],
        }),
        runtime: makeRuntime(),
        health: makeHealth(),
      });
      await gw.start();
      const { status } = await get(gw.port, '/status', 'rotatedtoken1');
      expect(status).toBe(200);
    });

    it('rejects an expired token from bearerTokens list with reason expired', async () => {
      gw = createRuntimeGateway({
        config: makeConfig({
          bearerTokens: [{ value: 'expiredtoken1', label: 'old', expiresAt: PAST }],
        }),
        runtime: makeRuntime(),
        health: makeHealth(),
      });
      await gw.start();
      const { status, body } = await get(gw.port, '/status', 'expiredtoken1');
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['reason']).toBe('expired');
    });
  });

  describe('rate limiting', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig(undefined, {
          enabled: true,
          capacity: 2,
          refillPerSec: 1,
          exemptPaths: ['/ping', '/health', '/metrics'],
        }),
        runtime: makeRuntime(),
        health: makeHealth(),
        cron: makeCron(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => {
      await gw.stop();
    });

    it('third request to /status returns 429 with Retry-After', async () => {
      const first = await get(port, '/status');
      expect(first.status).toBe(200);

      const second = await get(port, '/status');
      expect(second.status).toBe(200);

      const third = await get(port, '/status');
      expect(third.status).toBe(429);
      expect((third.body as Record<string, unknown>)['error']).toBe('rate_limited');
      expect((third.body as Record<string, unknown>)['retryAfterMs']).toBeGreaterThan(0);
    });

    it('429 response includes Retry-After header in seconds', async () => {
      await get(port, '/status');
      await get(port, '/status');
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      expect(res.status).toBe(429);
      const retryAfter = res.headers.get('retry-after');
      expect(retryAfter).toBeTruthy();
      expect(Number(retryAfter)).toBeGreaterThan(0);
    });

    it('exempt paths are not rate-limited', async () => {
      // Exhaust the rate limit via /status
      await get(port, '/status');
      await get(port, '/status');
      expect((await get(port, '/status')).status).toBe(429);

      // Exempt paths should still respond normally
      expect((await get(port, '/ping')).status).toBe(200);
      expect((await get(port, '/health')).status).toBe(200);
    });
  });

  // ─── NEW: wrong HTTP method ─────────────────────────────────────────────

  describe('wrong HTTP method on known paths', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: makeHealth(),
        cron: makeCron(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('GET /v1/chat/completions (expects POST) returns 404', async () => {
      const { status } = await get(port, '/v1/chat/completions');
      expect(status).toBe(404);
    });

    it('POST /ping (expects GET) returns 404', async () => {
      const { status } = await post(port, '/ping', {});
      expect(status).toBe(404);
    });

    it('POST /health (expects GET) returns 404', async () => {
      const { status } = await post(port, '/health', {});
      expect(status).toBe(404);
    });

    it('404 body includes path field', async () => {
      const { status, body } = await get(port, '/totally-unknown');
      expect(status).toBe(404);
      const b = body as Record<string, unknown>;
      expect(b['error']).toBeTruthy();
      expect(b['path']).toBe('/totally-unknown');
    });
  });

  // ─── NEW: malformed JSON body ───────────────────────────────────────────

  describe('malformed JSON body', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: makeHealth(),
        cron: makeCron(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('POST /v1/chat/completions with invalid JSON returns 400 invalid_json', async () => {
      const { status, body } = await postRaw(port, '/v1/chat/completions', '{not valid json');
      expect(status).toBe(400);
      expect((body as Record<string, unknown>)['error']).toBe('invalid_json');
    });

    it('POST /cron/trigger with invalid JSON returns 400 invalid_json', async () => {
      const { status, body } = await postRaw(port, '/cron/trigger', 'not-json-at-all');
      expect(status).toBe(400);
      expect((body as Record<string, unknown>)['error']).toBe('invalid_json');
    });

    it('POST /v1/chat/completions with truncated JSON returns 400', async () => {
      const { status } = await postRaw(port, '/v1/chat/completions', '{"messages":[');
      expect(status).toBe(400);
    });
  });

  // ─── NEW: missing required fields ──────────────────────────────────────

  describe('missing required fields in /v1/chat/completions', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('no messages field returns 400', async () => {
      const { status, body } = await post(port, '/v1/chat/completions', {});
      expect(status).toBe(400);
      expect((body as Record<string, unknown>)['error']).toMatch(/messages/i);
    });

    it('messages array with entry lacking content returns 400', async () => {
      const { status, body } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user' }],
      });
      expect(status).toBe(400);
      expect((body as Record<string, unknown>)['error']).toMatch(/content/i);
    });

    it('messages with empty string content returns 400', async () => {
      const { status } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: '' }],
      });
      expect(status).toBe(400);
    });
  });

  // ─── NEW: cron trigger 404 / runtime 500 ───────────────────────────────

  describe('cron trigger errors', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;
    let cron: CronService;

    beforeEach(async () => {
      cron = makeCron();
      gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime(), cron });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('POST /cron/trigger returns 404 when triggerJob throws', async () => {
      vi.mocked(cron.triggerJob).mockRejectedValue(new Error('job not found: unknown'));
      const { status, body } = await post(port, '/cron/trigger', { name: 'unknown' });
      expect(status).toBe(404);
      expect((body as Record<string, unknown>)['error']).toContain('job not found');
    });

    it('POST /cron/trigger returns 503 when cron service not available', async () => {
      const gwNoCron = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
      await gwNoCron.start();
      const p = gwNoCron.port;
      try {
        const { status, body } = await post(p, '/cron/trigger', { name: 'daily' });
        expect(status).toBe(503);
        expect((body as Record<string, unknown>)['error']).toMatch(/CronService/i);
      } finally {
        await gwNoCron.stop();
      }
    });
  });

  describe('runtime.handleMessage rejection returns 500', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;
    let runtime: PyrforRuntime;

    beforeEach(async () => {
      runtime = makeRuntime();
      vi.mocked(runtime.handleMessage).mockRejectedValue(new Error('boom'));
      gw = createRuntimeGateway({ config: makeConfig(), runtime });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('returns 500 with generic error message', async () => {
      const { status, body } = await post(port, '/v1/chat/completions', {
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(status).toBe(500);
      expect((body as Record<string, unknown>)['error']).toBe('Internal server error');
    });
  });

  // ─── NEW: /health response shape ───────────────────────────────────────

  describe('/health response shape', () => {
    it('snapshot includes status and uptimeMs when health monitor provided', async () => {
      const healthMock = {
        getLastSnapshot: vi.fn().mockReturnValue({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptimeMs: 12345,
          restartCount: 0,
          checks: {},
        }),
      } as unknown as HealthMonitor;

      const gw = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        health: healthMock,
      });
      await gw.start();
      try {
        const res = await fetch(`http://127.0.0.1:${gw.port}/health`);
        expect(res.status).toBe(200);
        const body = await res.json() as Record<string, unknown>;
        expect(body['status']).toBe('healthy');
        expect(typeof body['uptimeMs']).toBe('number');
        expect(body['uptimeMs']).toBe(12345);
      } finally {
        await gw.stop();
      }
    });

    it('returns { status: "unknown" } when no health monitor', async () => {
      const gw = createRuntimeGateway({ config: makeConfig(), runtime: makeRuntime() });
      await gw.start();
      try {
        const res = await fetch(`http://127.0.0.1:${gw.port}/health`);
        expect(res.status).toBe(200);
        const body = await res.json() as Record<string, unknown>;
        expect(body['status']).toBe('unknown');
      } finally {
        await gw.stop();
      }
    });
  });

  // ─── NEW: /metrics Prometheus counter lines ─────────────────────────────

  describe('/metrics Prometheus counter format', () => {
    it('includes # TYPE ... counter line for cron job runs', async () => {
      const cronWithRuns = {
        getStatus: vi.fn().mockReturnValue([
          { name: 'nightly', enabled: true, successCount: 5, failureCount: 1 },
        ]),
        triggerJob: vi.fn(),
      } as unknown as CronService;

      const gw = createRuntimeGateway({
        config: makeConfig(),
        runtime: makeRuntime(),
        cron: cronWithRuns,
      });
      await gw.start();
      try {
        const res = await fetch(`http://127.0.0.1:${gw.port}/metrics`);
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('# TYPE pyrfor_cron_job_runs_total counter');
        expect(body).toContain('pyrfor_cron_job_runs_total{job="nightly"} 6');
        expect(body).toContain('pyrfor_cron_job_failures_total{job="nightly"} 1');
      } finally {
        await gw.stop();
      }
    });
  });

  // ─── NEW: bearer token edge cases ──────────────────────────────────────

  describe('bearer token edge cases', () => {
    const TOKEN = 'secret-edge-token';
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig({ bearerToken: TOKEN }),
        runtime: makeRuntime(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('Authorization without "Bearer " prefix is treated as raw token (wrong value → 401)', async () => {
      // Sending "token-value" without "Bearer " prefix — the gateway uses the whole header as token
      const { status, body } = await getRawAuth(port, '/status', 'not-the-right-token');
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['error']).toBe('unauthorized');
    });

    it('Authorization without "Bearer " prefix matching actual token → 200', async () => {
      // Gateway falls back to treating the whole header value as the token
      const { status } = await getRawAuth(port, '/status', TOKEN);
      expect(status).toBe(200);
    });

    it('empty token after "Bearer " returns 401', async () => {
      const { status, body } = await getRawAuth(port, '/status', 'Bearer ');
      expect(status).toBe(401);
      expect((body as Record<string, unknown>)['reason']).toBe('unknown');
    });

    it('missing Authorization header returns 401', async () => {
      const { status } = await get(port, '/status'); // no token arg
      expect(status).toBe(401);
    });
  });

  // ─── NEW: rate-limit capacity=1 ────────────────────────────────────────

  describe('rate-limit with capacity=1', () => {
    let gw: ReturnType<typeof createRuntimeGateway>;

    beforeEach(async () => {
      gw = createRuntimeGateway({
        config: makeConfig(undefined, {
          enabled: true,
          capacity: 1,
          refillPerSec: 0.001, // near-zero refill so bucket stays empty
          exemptPaths: ['/ping', '/health', '/metrics'],
        }),
        runtime: makeRuntime(),
        health: makeHealth(),
      });
      await gw.start();
      port = gw.port;
    });

    afterEach(async () => { await gw.stop(); });

    it('first request succeeds, second is 429', async () => {
      const first = await get(port, '/status');
      expect(first.status).toBe(200);

      const second = await get(port, '/status');
      expect(second.status).toBe(429);
      expect((second.body as Record<string, unknown>)['error']).toBe('rate_limited');
    });

    it('429 includes Retry-After header', async () => {
      await get(port, '/status');
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      expect(res.status).toBe(429);
      const retryAfter = res.headers.get('retry-after');
      expect(retryAfter).not.toBeNull();
      expect(Number(retryAfter)).toBeGreaterThan(0);
    });

    it('429 body includes retryAfterMs > 0', async () => {
      await get(port, '/status');
      const { body } = await get(port, '/status');
      expect((body as Record<string, unknown>)['retryAfterMs']).toBeGreaterThan(0);
    });
  });
});

// ─── Mini App tests ────────────────────────────────────────────────────────

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir as osTmpdir } from 'os';
import pathModule from 'path';
import { fileURLToPath } from 'node:url';
import { GoalStore } from './goal-store';
import { ArtifactStore } from './artifact-model';
import { DomainOverlayRegistry } from './domain-overlay';
import { createCeoclawOverlayManifest, createOchagOverlayManifest } from './domain-overlay-presets';
import { DurableDag } from './durable-dag';
import { EventLedger } from './event-ledger';
import { RunLedger } from './run-ledger';

describe('Approval and audit routes', () => {
  let gw: ReturnType<typeof createRuntimeGateway>;
  let port: number;
  const approvals = {
    pending: [
      { id: 'req-1', toolName: 'exec', summary: 'exec: npm install', args: { command: 'npm install' } },
    ],
    audit: [
      {
        id: 'audit-1',
        ts: '2026-05-01T00:00:00.000Z',
        type: 'approval.requested',
        requestId: 'req-1',
        toolName: 'exec',
        summary: 'exec: npm install',
        args: { command: 'npm install' },
      },
    ],
    getPending: vi.fn(() => approvals.pending),
    resolveDecision: vi.fn((id: string) => id === 'req-1'),
    listAudit: vi.fn(() => approvals.audit),
  };

  beforeEach(async () => {
    approvals.getPending.mockClear();
    approvals.resolveDecision.mockClear();
    approvals.listAudit.mockClear();
    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime: makeRuntime(),
      approvalFlow: approvals,
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
  });

  it('lists pending approvals', async () => {
    const { status, body } = await get(port, '/api/approvals/pending');
    expect(status).toBe(200);
    expect(body).toMatchObject({ approvals: approvals.pending });
  });

  it('accepts approval decisions', async () => {
    const { status, body } = await post(port, '/api/approvals/req-1/decision', { decision: 'approve' });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, decision: 'approve' });
    expect(approvals.resolveDecision).toHaveBeenCalledWith('req-1', 'approve');
  });

  it('lists audit events', async () => {
    const { status, body } = await get(port, '/api/audit/events?limit=10');
    expect(status).toBe(200);
    expect(body).toMatchObject({ events: approvals.audit });
    expect(approvals.listAudit).toHaveBeenCalledWith(10);
  });
});

describe('Product Factory API routes', () => {
  let gw: ReturnType<typeof createRuntimeGateway>;
  let port: number;
  const runtime = {
    handleMessage: vi.fn().mockResolvedValue({ success: true, response: 'ok' }),
    listProductFactoryTemplates: vi.fn().mockReturnValue([
      {
        id: 'feature',
        title: 'Feature delivery',
        description: 'Feature template',
        recommendedDomainIds: [],
        clarifications: [],
        deliveryArtifacts: ['implementation_summary'],
        qualityGates: ['build'],
      },
    ]),
    previewProductFactoryPlan: vi.fn().mockReturnValue({
      intent: { id: 'pf-1', templateId: 'feature', title: 'Build a feature', goal: 'Build a feature', domainIds: [] },
      template: { id: 'feature', title: 'Feature delivery' },
      missingClarifications: [],
      scopedPlan: { objective: 'Build a feature', scope: [], assumptions: [], risks: [], qualityGates: ['build'] },
      dagPreview: { nodes: [{ id: 'pf-1/plan', kind: 'product_factory.scoped_plan' }] },
      deliveryChecklist: ['implementation_summary'],
    }),
    createProductFactoryRun: vi.fn().mockResolvedValue({
      run: { run_id: 'run-pf-1', task_id: 'pf-1', mode: 'pm', status: 'planned' },
      preview: { intent: { id: 'pf-1' } },
      artifact: { id: 'artifact-1', kind: 'plan' },
    }),
    executeProductFactoryRun: vi.fn().mockResolvedValue({
      run: { run_id: 'run-pf-1', task_id: 'pf-1', mode: 'pm', status: 'completed' },
      deliveryArtifact: { id: 'artifact-delivery', kind: 'summary' },
      deliveryEvidenceArtifact: { id: 'artifact-evidence', kind: 'delivery_evidence' },
      deliveryEvidence: { schemaVersion: 'pyrfor.delivery_evidence.v1', runId: 'run-pf-1' },
      summary: 'Product Factory executed',
    }),
    captureRunDeliveryEvidence: vi.fn().mockResolvedValue({
      artifact: { id: 'artifact-evidence', kind: 'delivery_evidence' },
      snapshot: { schemaVersion: 'pyrfor.delivery_evidence.v1', runId: 'run-pf-1' },
    }),
    getRunDeliveryEvidence: vi.fn().mockResolvedValue({
      artifact: { id: 'artifact-evidence', kind: 'delivery_evidence' },
      snapshot: { schemaVersion: 'pyrfor.delivery_evidence.v1', runId: 'run-pf-1' },
    }),
    createRunGithubDeliveryPlan: vi.fn().mockResolvedValue({
      artifact: { id: 'artifact-plan', kind: 'delivery_plan', sha256: 'plan-sha' },
      plan: { schemaVersion: 'pyrfor.github_delivery_plan.v1', runId: 'run-pf-1', mode: 'dry_run', applySupported: false },
      evidenceArtifact: { id: 'artifact-evidence', kind: 'delivery_evidence' },
    }),
    getRunGithubDeliveryPlan: vi.fn().mockResolvedValue({
      artifact: { id: 'artifact-plan', kind: 'delivery_plan', sha256: 'plan-sha' },
      plan: { schemaVersion: 'pyrfor.github_delivery_plan.v1', runId: 'run-pf-1', mode: 'dry_run', applySupported: false },
    }),
    getRunGithubDeliveryApply: vi.fn().mockResolvedValue({
      artifact: { id: 'artifact-apply', kind: 'delivery_apply' },
      result: {
        schemaVersion: 'pyrfor.github_delivery_apply.v1',
        runId: 'run-pf-1',
        draftPullRequest: { number: 12, url: 'https://github.com/acme/pyrfor/pull/12', title: 'Ship feature', draft: true },
      },
    }),
    requestRunGithubDeliveryApply: vi.fn().mockResolvedValue({
      status: 'awaiting_approval',
      approval: { id: 'approval-1', toolName: 'github_delivery_apply', summary: 'Create draft PR', args: {} },
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
    }),
    applyApprovedRunGithubDelivery: vi.fn().mockResolvedValue({
      status: 'applied',
      artifact: { id: 'artifact-apply', kind: 'delivery_apply' },
      result: {
        schemaVersion: 'pyrfor.github_delivery_apply.v1',
        runId: 'run-pf-1',
        draftPullRequest: { number: 12, url: 'https://github.com/acme/pyrfor/pull/12', title: 'Ship feature', draft: true },
      },
    }),
  } as unknown as PyrforRuntime & {
    listProductFactoryTemplates: ReturnType<typeof vi.fn>;
    previewProductFactoryPlan: ReturnType<typeof vi.fn>;
    createProductFactoryRun: ReturnType<typeof vi.fn>;
    executeProductFactoryRun: ReturnType<typeof vi.fn>;
    captureRunDeliveryEvidence: ReturnType<typeof vi.fn>;
    getRunDeliveryEvidence: ReturnType<typeof vi.fn>;
    createRunGithubDeliveryPlan: ReturnType<typeof vi.fn>;
    getRunGithubDeliveryPlan: ReturnType<typeof vi.fn>;
    getRunGithubDeliveryApply: ReturnType<typeof vi.fn>;
    requestRunGithubDeliveryApply: ReturnType<typeof vi.fn>;
    applyApprovedRunGithubDelivery: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    runtime.listProductFactoryTemplates.mockClear();
    runtime.previewProductFactoryPlan.mockClear();
    runtime.createProductFactoryRun.mockClear();
    runtime.executeProductFactoryRun.mockClear();
    runtime.captureRunDeliveryEvidence.mockClear();
    runtime.getRunDeliveryEvidence.mockClear();
    runtime.createRunGithubDeliveryPlan.mockClear();
    runtime.getRunGithubDeliveryPlan.mockClear();
    runtime.getRunGithubDeliveryApply.mockClear();
    runtime.requestRunGithubDeliveryApply.mockClear();
    runtime.applyApprovedRunGithubDelivery.mockClear();
    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime,
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
  });

  it('lists and previews product factory templates', async () => {
    await expect(get(port, '/api/product-factory/templates')).resolves.toMatchObject({
      status: 200,
      body: { templates: [expect.objectContaining({ id: 'feature' })] },
    });

    await expect(post(port, '/api/product-factory/plan', {
      templateId: 'feature',
      prompt: 'Build a feature',
    })).resolves.toMatchObject({
      status: 200,
      body: { preview: expect.objectContaining({ intent: expect.objectContaining({ id: 'pf-1' }) }) },
    });
    expect(runtime.previewProductFactoryPlan).toHaveBeenCalledWith({
      templateId: 'feature',
      prompt: 'Build a feature',
    });
  });

  it('rejects unknown product factory templates before runtime dispatch', async () => {
    await expect(post(port, '/api/product-factory/plan', {
      templateId: 'unknown_template',
      prompt: 'Build a feature',
    })).resolves.toMatchObject({
      status: 400,
      body: { error: 'templateId and prompt are required' },
    });
    expect(runtime.previewProductFactoryPlan).not.toHaveBeenCalled();
  });

  it('creates product factory runs through POST /api/runs', async () => {
    await expect(post(port, '/api/runs', {
      productFactory: {
        templateId: 'feature',
        prompt: 'Build a feature',
        answers: {
          acceptance: 'Visible to users',
          surface: 'operator console',
        },
      },
    })).resolves.toMatchObject({
      status: 201,
      body: {
        run: expect.objectContaining({ run_id: 'run-pf-1', mode: 'pm', status: 'planned' }),
        artifact: expect.objectContaining({ id: 'artifact-1' }),
      },
    });
    expect(runtime.createProductFactoryRun).toHaveBeenCalledWith({
      templateId: 'feature',
      prompt: 'Build a feature',
      answers: {
        acceptance: 'Visible to users',
        surface: 'operator console',
      },
    });
  });

  it('rejects product factory run creation until required clarifications are answered', async () => {
    await expect(post(port, '/api/runs', {
      productFactory: {
        templateId: 'feature',
        prompt: 'Build a feature',
      },
    })).resolves.toMatchObject({
      status: 400,
      body: {
        error: 'missing_required_clarifications',
        missingClarifications: ['acceptance', 'surface'],
      },
    });
    expect(runtime.createProductFactoryRun).not.toHaveBeenCalled();
  });

  it('executes product factory runs through run control', async () => {
    await expect(post(port, '/api/runs/run-pf-1/control', { action: 'execute' })).resolves.toMatchObject({
      status: 200,
      body: {
        ok: true,
        action: 'execute',
        run: expect.objectContaining({ run_id: 'run-pf-1', status: 'completed' }),
        deliveryArtifact: expect.objectContaining({ id: 'artifact-delivery', kind: 'summary' }),
        deliveryEvidenceArtifact: expect.objectContaining({ id: 'artifact-evidence', kind: 'delivery_evidence' }),
      },
    });
    expect(runtime.executeProductFactoryRun).toHaveBeenCalledWith('run-pf-1');
  });

  it('captures delivery evidence through POST /api/runs/:runId/delivery-evidence', async () => {
    await expect(post(port, '/api/runs/run-pf-1/delivery-evidence', {
      issueNumber: 42,
      summary: 'Delivered',
    })).resolves.toMatchObject({
      status: 201,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-evidence', kind: 'delivery_evidence' }),
        snapshot: expect.objectContaining({ schemaVersion: 'pyrfor.delivery_evidence.v1' }),
      },
    });
    expect(runtime.captureRunDeliveryEvidence).toHaveBeenCalledWith('run-pf-1', {
      issueNumber: 42,
      summary: 'Delivered',
    });
  });

  it('returns latest delivery evidence through GET /api/runs/:runId/delivery-evidence', async () => {
    await expect(get(port, '/api/runs/run-pf-1/delivery-evidence')).resolves.toMatchObject({
      status: 200,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-evidence', kind: 'delivery_evidence' }),
        snapshot: expect.objectContaining({ runId: 'run-pf-1' }),
      },
    });
    expect(runtime.getRunDeliveryEvidence).toHaveBeenCalledWith('run-pf-1');
  });

  it('creates dry-run GitHub delivery plans through POST /api/runs/:runId/github-delivery-plan', async () => {
    await expect(post(port, '/api/runs/run-pf-1/github-delivery-plan', {
      issueNumber: 42,
      title: 'Ship feature',
    })).resolves.toMatchObject({
      status: 201,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-plan', kind: 'delivery_plan' }),
        plan: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_plan.v1', mode: 'dry_run', applySupported: false }),
      },
    });
    expect(runtime.createRunGithubDeliveryPlan).toHaveBeenCalledWith('run-pf-1', {
      issueNumber: 42,
      title: 'Ship feature',
    });
  });

  it('returns latest dry-run GitHub delivery plan through GET /api/runs/:runId/github-delivery-plan', async () => {
    await expect(get(port, '/api/runs/run-pf-1/github-delivery-plan')).resolves.toMatchObject({
      status: 200,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-plan', kind: 'delivery_plan' }),
        plan: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_plan.v1', runId: 'run-pf-1' }),
      },
    });
    expect(runtime.getRunGithubDeliveryPlan).toHaveBeenCalledWith('run-pf-1');
  });

  it('requests GitHub delivery apply approval through POST /api/runs/:runId/github-delivery-apply', async () => {
    await expect(post(port, '/api/runs/run-pf-1/github-delivery-apply', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
    })).resolves.toMatchObject({
      status: 202,
      body: {
        status: 'awaiting_approval',
        approval: expect.objectContaining({ id: 'approval-1' }),
      },
    });
    expect(runtime.requestRunGithubDeliveryApply).toHaveBeenCalledWith('run-pf-1', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
    });
  });

  it('applies approved GitHub delivery through POST /api/runs/:runId/github-delivery-apply', async () => {
    await expect(post(port, '/api/runs/run-pf-1/github-delivery-apply', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
      approvalId: 'approval-1',
    })).resolves.toMatchObject({
      status: 201,
      body: {
        status: 'applied',
        artifact: expect.objectContaining({ id: 'artifact-apply', kind: 'delivery_apply' }),
        result: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_apply.v1' }),
      },
    });
    expect(runtime.applyApprovedRunGithubDelivery).toHaveBeenCalledWith('run-pf-1', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
      approvalId: 'approval-1',
    });
  });

  it('returns latest GitHub delivery apply result through GET /api/runs/:runId/github-delivery-apply', async () => {
    await expect(get(port, '/api/runs/run-pf-1/github-delivery-apply')).resolves.toMatchObject({
      status: 200,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-apply', kind: 'delivery_apply' }),
        result: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_apply.v1', runId: 'run-pf-1' }),
      },
    });
    expect(runtime.getRunGithubDeliveryApply).toHaveBeenCalledWith('run-pf-1');
  });

  it('maps CEOClaw brief routes to business_brief product factory input', async () => {
    await expect(post(port, '/api/ceoclaw/briefs/preview', {
      decision: 'Approve supplier contract',
      evidence: ['contract.pdf', 'finance-note.md'],
      deadline: 'Friday',
    })).resolves.toMatchObject({
      status: 200,
      body: { preview: expect.objectContaining({ intent: expect.objectContaining({ id: 'pf-1' }) }) },
    });
    expect(runtime.previewProductFactoryPlan).toHaveBeenLastCalledWith({
      templateId: 'business_brief',
      prompt: 'Approve supplier contract',
      answers: {
        decision: 'Approve supplier contract',
        evidence: 'contract.pdf,finance-note.md',
        deadline: 'Friday',
      },
      domainIds: ['ceoclaw'],
    });

    await expect(post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve supplier contract',
      evidence: 'contract.pdf',
    })).resolves.toMatchObject({
      status: 201,
      body: { run: expect.objectContaining({ run_id: 'run-pf-1' }) },
    });
    expect(runtime.createProductFactoryRun).toHaveBeenLastCalledWith({
      templateId: 'business_brief',
      prompt: 'Approve supplier contract',
      answers: {
        decision: 'Approve supplier contract',
        evidence: 'contract.pdf',
      },
      domainIds: ['ceoclaw'],
    });
  });

  it('maps Ochag reminder create route to ochag_family_reminder product factory input', async () => {
    await expect(post(port, '/api/ochag/reminders', {
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00 daily',
      audience: 'parents',
      visibility: 'family',
    })).resolves.toMatchObject({
      status: 201,
      body: { run: expect.objectContaining({ run_id: 'run-pf-1' }) },
    });

    expect(runtime.createProductFactoryRun).toHaveBeenLastCalledWith({
      templateId: 'ochag_family_reminder',
      prompt: 'Send dinner reminder',
      answers: {
        familyId: 'fam-1',
        dueAt: '18:00 daily',
        audience: 'parents',
        visibility: 'family',
      },
      domainIds: ['ochag'],
    });
  });

  it('rejects Ochag reminder creation until required scheduling context is present', async () => {
    await expect(post(port, '/api/ochag/reminders', {
      title: 'Send dinner reminder',
    })).resolves.toMatchObject({
      status: 400,
      body: {
        error: 'missing_required_clarifications',
        missingClarifications: ['familyId', 'audience', 'dueAt', 'visibility'],
      },
    });
    expect(runtime.createProductFactoryRun).not.toHaveBeenCalled();
  });

  it('rejects CEOClaw brief creation until evidence is present', async () => {
    await expect(post(port, '/api/ceoclaw/briefs', {
      decision: 'Approve supplier contract',
    })).resolves.toMatchObject({
      status: 400,
      body: {
        error: 'missing_required_clarifications',
        missingClarifications: ['evidence'],
      },
    });
    expect(runtime.createProductFactoryRun).not.toHaveBeenCalled();
  });
});

describe('Orchestration API routes', () => {
  let gw: ReturnType<typeof createRuntimeGateway>;
  let port: number;
  let tmpDir: string;
  let eventLedger: EventLedger;

  beforeEach(async () => {
    tmpDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-gw-orch-test-'));
    eventLedger = new EventLedger(pathModule.join(tmpDir, 'events.jsonl'));
    const runLedger = new RunLedger({ ledger: eventLedger });
    await runLedger.createRun({
      run_id: 'run-1',
      workspace_id: 'workspace-1',
      repo_id: 'repo-1',
      mode: 'autonomous',
      task_id: 'task-1',
      goal: 'Expose orchestration API',
    });
    await runLedger.transition('run-1', 'planned', 'test plan');
    await runLedger.transition('run-1', 'running', 'test run');
    await eventLedger.append({
      type: 'effect.proposed',
      run_id: 'run-1',
      effect_id: 'effect-1',
      effect_kind: 'tool_call',
      tool: 'read_file',
    });
    await eventLedger.append({
      type: 'verifier.completed',
      run_id: 'run-1',
      subject_id: 'run-1',
      status: 'warning',
      action: 'allow_with_warning',
      reason: 'smoke verifier warning',
    });

    const dag = new DurableDag({ storePath: pathModule.join(tmpDir, 'dag.json') });
    const dagNode = dag.addNode({
      id: 'node-1',
      kind: 'test.node',
      payload: { runId: 'run-1' },
      provenance: [{ kind: 'run', ref: 'run-1', role: 'input' }],
    });
    dag.leaseNode(dagNode.id, 'test', 60_000);
    dag.addNode({
      id: 'frame-node-1',
      kind: 'worker.frame.tool_call',
      payload: {
        runId: 'run-1',
        frameType: 'tool_call',
        source: 'freeclaude',
        disposition: 'applied',
        seq: 1,
      },
      provenance: [
        { kind: 'run', ref: 'run-1', role: 'input' },
        { kind: 'worker_frame', ref: 'frame-1', role: 'input' },
      ],
    });

    const artifactStore = new ArtifactStore({ rootDir: pathModule.join(tmpDir, 'artifacts') });
    await artifactStore.writeJSON('context_pack', {
      schemaVersion: 'context_pack.v1',
      hash: 'abc123',
      sections: [],
    }, { runId: 'run-1' });

    const overlays = new DomainOverlayRegistry();
    overlays.register({
      manifest: createCeoclawOverlayManifest(),
    });
    overlays.register({
      manifest: createOchagOverlayManifest(),
    });

    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime: makeRuntime(),
      orchestration: { runLedger, eventLedger, dag, artifactStore, overlays },
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
    await eventLedger.close();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('adds orchestration summary to dashboard', async () => {
    const { status, body } = await get(port, '/api/dashboard');
    expect(status).toBe(200);
    const orchestration = (body as { orchestration?: Record<string, any> }).orchestration;
    expect(orchestration?.['runs']).toMatchObject({ total: 1, active: 1 });
    expect(orchestration?.['effects']).toMatchObject({ pending: 1 });
    expect(orchestration?.['approvals']).toMatchObject({ pending: 0 });
    expect(orchestration?.['workerFrames']).toMatchObject({ total: 1, lastType: 'tool_call' });
    expect(orchestration?.['verifier']).toMatchObject({ blocked: 0, status: 'warning' });
    expect(orchestration?.['dag']).toMatchObject({ total: 2, running: 1 });
    expect(orchestration?.['overlays']).toMatchObject({ total: 2, domainIds: ['ceoclaw', 'ochag'] });
    expect(orchestration?.['contextPack']).toMatchObject({ kind: 'context_pack', runId: 'run-1' });
  });

  it('lists runs and returns run details/events/DAG nodes', async () => {
    await expect(get(port, '/api/runs')).resolves.toMatchObject({
      status: 200,
      body: { runs: [expect.objectContaining({ run_id: 'run-1' })] },
    });
    await expect(get(port, '/api/runs/run-1')).resolves.toMatchObject({
      status: 200,
      body: { run: expect.objectContaining({ run_id: 'run-1', status: 'running' }) },
    });
    const events = await get(port, '/api/runs/run-1/events');
    expect(events.status).toBe(200);
    expect((events.body as { events: Array<{ type: string }> }).events.map((event) => event.type)).toContain('effect.proposed');
    const dagResponse = await get(port, '/api/runs/run-1/dag');
    expect(dagResponse.status).toBe(200);
    expect((dagResponse.body as { nodes: Array<{ id: string }> }).nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'node-1' })]),
    );
    await expect(get(port, '/api/runs/run-1/frames')).resolves.toMatchObject({
      status: 200,
      body: { frames: [expect.objectContaining({ frame_id: 'frame-1', type: 'tool_call', disposition: 'applied' })] },
    });
  });

  it('controls runs with replay and abort actions', async () => {
    await expect(post(port, '/api/runs/run-1/control', { action: 'replay' })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, action: 'replay', run: expect.objectContaining({ run_id: 'run-1' }) },
    });
    await expect(post(port, '/api/runs/run-1/control', { action: 'abort' })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, action: 'abort', run: expect.objectContaining({ run_id: 'run-1', status: 'cancelled' }) },
    });
  });

  it('lists overlay manifests and folds kernel ledger events into audit timeline', async () => {
    await expect(get(port, '/api/overlays')).resolves.toMatchObject({
      status: 200,
      body: { overlays: expect.arrayContaining([expect.objectContaining({ domainId: 'ochag' })]) },
    });
    await expect(get(port, '/api/overlays/ochag')).resolves.toMatchObject({
      status: 200,
      body: { overlay: expect.objectContaining({ domainId: 'ochag' }) },
    });
    await expect(get(port, '/api/overlays/ceoclaw')).resolves.toMatchObject({
      status: 200,
      body: {
        overlay: expect.objectContaining({
          domainId: 'ceoclaw',
          workflowTemplates: expect.arrayContaining([expect.objectContaining({ id: 'evidence-approval' })]),
          adapterRegistrations: expect.arrayContaining([expect.objectContaining({ id: 'ceoclaw-mcp' })]),
          toolPermissionOverrides: expect.objectContaining({ network_write: 'deny' }),
        }),
      },
    });
    const audit = await get(port, '/api/audit/events?limit=20');
    expect(audit.status).toBe(200);
    expect((audit.body as { events: Array<{ type: string }> }).events.map((event) => event.type)).toContain('effect.proposed');
  });

  it('exposes Ochag privacy and reminder preview through real overlay/Product Factory fallback', async () => {
    await expect(get(port, '/api/ochag/privacy')).resolves.toMatchObject({
      status: 200,
      body: {
        domainId: 'ochag',
        privacyRules: expect.arrayContaining([
          expect.objectContaining({ id: 'member-private-memory' }),
          expect.objectContaining({ id: 'family-visibility-boundary' }),
        ]),
        toolPermissionOverrides: expect.objectContaining({ telegram_send: 'ask_once' }),
        adapterRegistrations: expect.arrayContaining([expect.objectContaining({ target: 'telegram' })]),
      },
    });

    await expect(post(port, '/api/ochag/reminders/preview', {
      title: 'Send dinner reminder',
      familyId: 'fam-1',
      dueAt: '18:00 daily',
      audience: 'parents',
      visibility: 'family',
    })).resolves.toMatchObject({
      status: 200,
      body: {
        preview: expect.objectContaining({
          intent: expect.objectContaining({ domainIds: ['ochag'] }),
          missingClarifications: [],
          dagPreview: expect.objectContaining({
            nodes: expect.arrayContaining([
              expect.objectContaining({ kind: 'ochag.privacy_check' }),
              expect.objectContaining({ kind: 'ochag.telegram_notify' }),
            ]),
          }),
        }),
      },
    });
  });
});

const __testFilename = fileURLToPath(import.meta.url);
const ACTUAL_STATIC_DIR = pathModule.join(pathModule.dirname(__testFilename), 'telegram', 'app');

describe('Mini App routes', () => {
  let port: number;
  let gw: ReturnType<typeof createRuntimeGateway>;
  let tmpDir: string;
  let goalStore: GoalStore;

  beforeEach(async () => {
    tmpDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-gw-test-'));
    goalStore = new GoalStore(tmpDir);
    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime: makeRuntime(),
      goalStore,
      approvalSettingsPath: pathModule.join(tmpDir, 'approval-settings.json'),
      staticDir: ACTUAL_STATIC_DIR,
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ── Static files ───────────────────────────────────────────────────────

  it('GET /app → 200 with text/html', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const text = await res.text();
    expect(text).toContain('<title');
  });

  it('GET /app/ → 200 index.html', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<title');
  });

  it('GET /app/index.html → 200 text/html with <title', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('<title');
  });

  it('GET /app/style.css → 200 text/css', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('GET /app/app.js → 200 application/javascript', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });

  it('GET /app/missing.css → 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/app/missing.css`);
    expect(res.status).toBe(404);
  });

  // ── OPTIONS preflight ──────────────────────────────────────────────────

  it('OPTIONS preflight → 204 with CORS headers', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/goals`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  // ── Dashboard ──────────────────────────────────────────────────────────

  it('GET /api/dashboard → 200 JSON with required keys', async () => {
    const { status, body } = await get(port, '/api/dashboard');
    const res = await fetch(`http://127.0.0.1:${port}/api/dashboard`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(d).toHaveProperty('status');
    expect(d).toHaveProperty('model');
    expect(d).toHaveProperty('costToday');
    expect(d).toHaveProperty('sessionsCount');
    expect(d).toHaveProperty('activeGoals');
    expect(d).toHaveProperty('recentActivity');
    expect(d).toHaveProperty('workspaceRoot');
    expect(d).toHaveProperty('cwd');
    expect(Array.isArray(d['activeGoals'])).toBe(true);
    expect(Array.isArray(d['recentActivity'])).toBe(true);
  });

  // ── Goals CRUD ─────────────────────────────────────────────────────────

  it('GET /api/goals → 200 empty array initially', async () => {
    const { status, body } = await get(port, '/api/goals');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/goals → creates goal, GET returns it', async () => {
    const { status: s1, body: b1 } = await post(port, '/api/goals', { title: 'test goal' });
    expect(s1).toBe(200);
    const created = b1 as Record<string, unknown>;
    expect(created['description']).toBe('test goal');
    expect(created['status']).toBe('active');
    expect(created['id']).toBeTruthy();

    const { body: list } = await get(port, '/api/goals');
    const goals = list as { description: string }[];
    expect(goals.some(g => g.description === 'test goal')).toBe(true);
  });

  it('POST /api/goals missing title → 400', async () => {
    const { status } = await post(port, '/api/goals', {});
    expect(status).toBe(400);
  });

  it('POST /api/goals/:id/done → marks done', async () => {
    const { body: created } = await post(port, '/api/goals', { title: 'to be done' });
    const id = (created as Record<string, unknown>)['id'] as string;

    const { status, body } = await post(port, `/api/goals/${id}/done`, {});
    expect(status).toBe(200);
    expect((body as Record<string, unknown>)['status']).toBe('done');
  });

  it('POST /api/goals/:id/done for unknown id → 404', async () => {
    const { status } = await post(port, '/api/goals/nonexistent/done', {});
    expect(status).toBe(404);
  });

  it('DELETE /api/goals/:id → cancels goal', async () => {
    const { body: created } = await post(port, '/api/goals', { title: 'to cancel' });
    const id = (created as Record<string, unknown>)['id'] as string;

    const res = await fetch(`http://127.0.0.1:${port}/api/goals/${id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['status']).toBe('cancelled');
  });

  it('DELETE /api/goals/:id for unknown id → 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/goals/nope`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  // ── Agents ─────────────────────────────────────────────────────────────

  it('GET /api/agents → 200 empty array', async () => {
    const { status, body } = await get(port, '/api/agents');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  // ── Memory ─────────────────────────────────────────────────────────────

  it('GET /api/memory → 200 JSON with lines and files arrays', async () => {
    const { status, body } = await get(port, '/api/memory');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(Array.isArray(d['lines'])).toBe(true);
    expect(Array.isArray(d['files'])).toBe(true);
  });

  // ── Settings ───────────────────────────────────────────────────────────

  it('GET /api/settings → 200 JSON with required keys', async () => {
    const { status, body } = await get(port, '/api/settings');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(d).toHaveProperty('defaultAction');
    expect(d).toHaveProperty('whitelist');
    expect(d).toHaveProperty('blacklist');
    expect(Array.isArray(d['whitelist'])).toBe(true);
    expect(Array.isArray(d['blacklist'])).toBe(true);
  });

  it('POST /api/settings → updates and returns ok', async () => {
    const { status, body } = await post(port, '/api/settings', {
      defaultAction: 'approve',
      whitelist: ['read', 'write'],
      blacklist: ['sudo'],
    });
    expect(status).toBe(200);
    expect((body as Record<string, unknown>)['ok']).toBe(true);

    // Verify persistence
    const { body: s2 } = await get(port, '/api/settings');
    const d = s2 as Record<string, unknown>;
    expect(d['defaultAction']).toBe('approve');
    expect(d['whitelist']).toEqual(['read', 'write']);
    expect(d['blacklist']).toEqual(['sudo']);
  });

  it('POST /api/settings invalid defaultAction → 400', async () => {
    const { status } = await post(port, '/api/settings', { defaultAction: 'invalid' });
    expect(status).toBe(400);
  });

  // ── Stats ──────────────────────────────────────────────────────────────

  it('GET /api/stats → 200 JSON with uptime', async () => {
    const { status, body } = await get(port, '/api/stats');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(typeof d['uptime']).toBe('number');
    expect(d).toHaveProperty('costToday');
    expect(d).toHaveProperty('sessionsCount');
  });
});
