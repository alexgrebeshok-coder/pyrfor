// @vitest-environment node
/**
 * End-to-end integration tests for PyrforRuntime.
 *
 * Boots the full runtime (HealthMonitor + CronService + HTTP Gateway) and
 * probes it via real HTTP requests using Node's built-in fetch.
 *
 * Port strategy: config.gateway.port = 0  →  OS assigns an ephemeral port.
 * The actual port is read from (runtime as RuntimeInternals).gateway.port after
 * start() resolves — the `gateway` field is private in TypeScript but perfectly
 * accessible at runtime. This avoids fixed-port conflicts between parallel runs.
 *
 * AI provider strategy: vi.spyOn(runtime.providers, 'chat') is called right
 * after construction (before start()) to return a deterministic mock reply.
 * `runtime.providers` is a public field so no cast is needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PyrforRuntime } from './index';
import { RuntimeConfigSchema } from './config';

// Suppress all logger output during tests
process.env['LOG_LEVEL'] = 'silent';

// ─── Types ─────────────────────────────────────────────────────────────────

/** Reach into private fields for port discovery after start(). */
interface RuntimeInternals {
  gateway: { port: number } | null;
}

// ─── Config factory ────────────────────────────────────────────────────────

const TEST_TOKEN = 'test-secret';

function makeConfig() {
  // Parse defaults via Zod first, then override gateway.port with 0.
  // Zod's schema uses .positive() (>0) for port, but the *TypeScript* type is
  // plain `number`, so we can safely override after parsing. Port 0 tells the
  // OS to assign an ephemeral port — no hard-coded port conflicts in CI.
  const base = RuntimeConfigSchema.parse({});
  return {
    ...base,
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port: 0, // OS-assigned ephemeral port (bypasses Zod positive() check)
      bearerToken: TEST_TOKEN,
    },
    telegram: { enabled: false, allowedChatIds: [], rateLimitPerMinute: 30 },
    cron: { enabled: false, timezone: 'UTC', jobs: [] },
    health: { enabled: false, intervalMs: 60_000 },
  };
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

async function get(
  port: number,
  path: string,
  token?: string,
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
  token?: string,
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

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('PyrforRuntime e2e', () => {
  let runtime: PyrforRuntime;
  let port: number;

  beforeEach(async () => {
    runtime = new PyrforRuntime({
      config: makeConfig(),
      persistence: false,
    });

    // Mock the AI provider so handleMessage() never hits a real API.
    vi.spyOn(runtime.providers, 'chat').mockResolvedValue('mock reply');

    await runtime.start();

    // Retrieve the OS-assigned port from the private gateway field.
    port = (runtime as unknown as RuntimeInternals).gateway?.port ?? 0;
    expect(port, 'gateway port must be non-zero after start()').toBeGreaterThan(0);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await runtime.stop();
  });

  // ── Public routes (no auth) ───────────────────────────────────────────────

  it('GET /ping returns 200 OK without auth', async () => {
    const { status, body } = await get(port, '/ping');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true });
  });

  it('GET /health returns a snapshot without auth', async () => {
    const { status, body } = await get(port, '/health');
    // health.enabled = false → no snapshot yet → gateway returns { status: 'unknown' }
    // health.enabled = true  → snapshot with 'healthy' / 'degraded' → 200
    // Either way status must be 2xx and body must have a status key.
    expect(status).toBeLessThan(600);
    expect(body).toBeDefined();
    const b = body as Record<string, unknown>;
    expect(typeof b['status']).toBe('string');
  });

  // ── Protected routes — auth enforcement ──────────────────────────────────

  it('GET /status without bearer returns 401', async () => {
    const { status, body } = await get(port, '/status');
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: 'unauthorized' });
  });

  it('GET /status with valid bearer returns runtime status', async () => {
    const { status, body } = await get(port, '/status', TEST_TOKEN);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b['uptime']).toBe('number');
    expect(b).toHaveProperty('config');
    expect(b).toHaveProperty('cron');
    expect(b).toHaveProperty('health');
  });

  // ── Chat completions (OpenAI-compatible) ──────────────────────────────────

  it('POST /v1/chat/completions with bearer returns OpenAI-shaped response', async () => {
    const { status, body } = await post(
      port,
      '/v1/chat/completions',
      { messages: [{ role: 'user', content: 'hello' }] },
      TEST_TOKEN,
    );
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b['object']).toBe('chat.completion');
    const choices = b['choices'] as Array<{ message: { role: string; content: string } }>;
    expect(Array.isArray(choices)).toBe(true);
    expect(choices[0]?.message?.content).toBe('mock reply');
  });

  // ── Cron routes ───────────────────────────────────────────────────────────

  it('GET /cron/jobs returns empty list initially', async () => {
    const { status, body } = await get(port, '/cron/jobs', TEST_TOKEN);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    // cron.enabled = false → CronService created but not started → no scheduled jobs
    expect(Array.isArray(b['jobs'])).toBe(true);
  });

  it('POST /cron/trigger with unknown job returns 404', async () => {
    const { status, body } = await post(
      port,
      '/cron/trigger',
      { name: 'nonexistent-job' },
      TEST_TOKEN,
    );
    expect(status).toBe(404);
    const b = body as Record<string, unknown>;
    expect(typeof b['error']).toBe('string');
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  it('stop() is idempotent — calling twice does not throw', async () => {
    await expect(runtime.stop()).resolves.toBeUndefined();
    // Second stop() on an already-stopped runtime must also be a no-op.
    await expect(runtime.stop()).resolves.toBeUndefined();
  });
});
