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
