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
      const { status } = await get(port, '/status');
      expect(status).toBe(401);
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
      const { status } = await post(
        port,
        '/cron/trigger',
        { name: 'daily' },
        'wrong-token'
      );
      expect(status).toBe(401);
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
});
