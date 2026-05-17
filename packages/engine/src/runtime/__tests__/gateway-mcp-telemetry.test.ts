// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRuntimeGateway } from '../gateway';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';
import type { McpLifecycleManager } from '../mcp-lifecycle-manager.js';
import { McpRestartRejectedError } from '../mcp-restart-error.js';
import { getEngineTracer, traceLifecycleStep } from '../../observability/engine-telemetry.js';

process.env.LOG_LEVEL = 'silent';

function makeConfig(): RuntimeConfig {
  return {
    gateway: {
      enabled: true,
      host: '127.0.0.1',
      port: 0,
      bearerToken: undefined,
      bearerTokens: [],
    },
    rateLimit: { enabled: false, capacity: 60, refillPerSec: 1, exemptPaths: ['/ping'] },
  } as unknown as RuntimeConfig;
}

function makeRuntime(): PyrforRuntime {
  return { handleMessage: async () => ({ success: true, response: '' }) } as unknown as PyrforRuntime;
}

async function startGateway(extra: Partial<Parameters<typeof createRuntimeGateway>[0]> = {}) {
  const gw = createRuntimeGateway({
    config: makeConfig(),
    runtime: makeRuntime(),
    portOverride: 0,
    ...extra,
  });
  await gw.start();
  const baseUrl = `http://127.0.0.1:${gw.port}`;
  return {
    gw,
    baseUrl,
    async stop() {
      await gw.stop().catch(() => {});
    },
  };
}

async function get(baseUrl: string, route: string) {
  const res = await fetch(`${baseUrl}${route}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function post(baseUrl: string, route: string, payload: unknown = {}) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function makeMockMcpLifecycle(overrides: Partial<McpLifecycleManager> = {}): McpLifecycleManager {
  return {
    healthCheck: async () => true,
    restart: async () => {},
    shutdown: async () => {},
    getRegisteredServerNames: () => ['alpha', 'beta'],
    listToolCount: (name) => (name === 'alpha' ? 3 : 1),
    ...overrides,
  };
}

describe('gateway MCP routes', () => {
  let handle: Awaited<ReturnType<typeof startGateway>> | null = null;

  beforeEach(async () => {
    handle = await startGateway();
  });

  afterEach(async () => {
    await handle?.stop();
    handle = null;
  });

  it('GET /api/mcp/status returns empty servers by default', async () => {
    const { status, body } = await get(handle!.baseUrl, '/api/mcp/status');
    expect(status).toBe(200);
    expect(body).toEqual({ servers: [] });
  });

  it('GET /api/mcp/status returns injected lifecycle servers', async () => {
    await handle!.stop();
    handle = await startGateway({
      mcpLifecycle: makeMockMcpLifecycle(),
    });
    const { status, body } = await get(handle!.baseUrl, '/api/mcp/status');
    expect(status).toBe(200);
    expect(body.servers).toHaveLength(2);
    expect(body.servers[0]).toMatchObject({
      name: 'alpha',
      healthy: true,
      configured: true,
      connected: true,
      toolCount: 3,
    });
  });

  it('POST /api/mcp/servers/:name/restart succeeds for known server', async () => {
    await handle!.stop();
    handle = await startGateway({ mcpLifecycle: makeMockMcpLifecycle() });
    const { status, body } = await post(handle!.baseUrl, '/api/mcp/servers/alpha/restart');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, name: 'alpha' });
  });

  it('POST /api/mcp/servers/:name/restart maps unknown server to 404', async () => {
    await handle!.stop();
    handle = await startGateway({
      mcpLifecycle: makeMockMcpLifecycle({
        restart: async () => {
          throw new McpRestartRejectedError('mcp_server_unknown', 'unknown server');
        },
      }),
    });
    const { status, body } = await post(handle!.baseUrl, '/api/mcp/servers/missing/restart');
    expect(status).toBe(404);
    expect(body.code).toBe('mcp_server_unknown');
  });

  it('POST /api/mcp/servers/:name/restart maps lifecycle unavailable to 503', async () => {
    await handle!.stop();
    handle = await startGateway({
      mcpLifecycle: makeMockMcpLifecycle({
        restart: async () => {
          throw new McpRestartRejectedError('mcp_lifecycle_unavailable', 'lifecycle unavailable');
        },
      }),
    });
    const { status, body } = await post(handle!.baseUrl, '/api/mcp/servers/alpha/restart');
    expect(status).toBe(503);
    expect(body.code).toBe('mcp_lifecycle_unavailable');
  });

  it('POST /api/mcp/servers/:name/restart handles encoded server names', async () => {
    await handle!.stop();
    handle = await startGateway({ mcpLifecycle: makeMockMcpLifecycle() });
    const { status, body } = await post(handle!.baseUrl, '/api/mcp/servers/alpha%2Fsidecar/restart');
    expect(status).toBe(200);
    expect(body.name).toBe('alpha/sidecar');
  });

  it('GET /api/mcp/status marks disconnected when healthCheck is false', async () => {
    await handle!.stop();
    handle = await startGateway({
      mcpLifecycle: makeMockMcpLifecycle({
        healthCheck: async () => false,
        listToolCount: () => 0,
      }),
    });
    const { body } = await get(handle!.baseUrl, '/api/mcp/status');
    expect(body.servers[0]).toMatchObject({ healthy: false, connected: false, toolCount: 0 });
  });

  it('POST /api/mcp/servers/:name/health-check returns healthy flag', async () => {
    await handle!.stop();
    handle = await startGateway({
      mcpLifecycle: makeMockMcpLifecycle({
        healthCheck: async (name) => name === 'beta',
      }),
    });
    const alpha = await post(handle!.baseUrl, '/api/mcp/servers/alpha/health-check');
    const beta = await post(handle!.baseUrl, '/api/mcp/servers/beta/health-check');
    expect(alpha.body).toEqual({ name: 'alpha', healthy: false });
    expect(beta.body).toEqual({ name: 'beta', healthy: true });
  });
});

describe('gateway telemetry routes', () => {
  let handle: Awaited<ReturnType<typeof startGateway>> | null = null;

  beforeEach(async () => {
    handle = await startGateway();
  });

  afterEach(async () => {
    await handle?.stop();
    handle = null;
  });

  it('GET /api/telemetry/spans returns empty spans by default', async () => {
    const { status, body } = await get(handle!.baseUrl, '/api/telemetry/spans');
    expect(status).toBe(200);
    expect(body).toEqual({ limit: 50, spans: [] });
  });

  it('GET /api/telemetry/spans includes recent traced spans', async () => {
    await traceLifecycleStep('plan', 'run-telemetry-1', async () => 'ok');
    const { status, body } = await get(handle!.baseUrl, '/api/telemetry/spans?limit=10');
    expect(status).toBe(200);
    expect(body.limit).toBe(10);
    expect(body.spans.some((span: { name: string }) => span.name === 'lifecycle.plan')).toBe(true);
    const match = body.spans.find((span: { name: string }) => span.name === 'lifecycle.plan');
    expect(match.attrs).toBeDefined();
    expect(match.events).toBeDefined();
  });

  it('GET /api/telemetry/spans filters by runId', async () => {
    await traceLifecycleStep('plan', 'run-filter-a', async () => 'a');
    await traceLifecycleStep('execute', 'run-filter-b', async () => 'b');
    const { body } = await get(handle!.baseUrl, '/api/telemetry/spans?limit=50&runId=run-filter-a');
    expect(body.spans.length).toBeGreaterThan(0);
    expect(body.spans.every((span: { attrs: Record<string, unknown> }) => span.attrs['run.id'] === 'run-filter-a')).toBe(true);
  });

  it('GET /api/telemetry/spans caps limit at 200', async () => {
    const { body } = await get(handle!.baseUrl, '/api/telemetry/spans?limit=999');
    expect(body.limit).toBe(200);
  });

  it('GET /api/telemetry/spans returns no matches for unknown runId', async () => {
    await traceLifecycleStep('plan', 'run-known', async () => 'ok');
    const { body } = await get(handle!.baseUrl, '/api/telemetry/spans?runId=run-absent');
    expect(body.spans).toEqual([]);
  });

  it('GET /api/telemetry/spans serializes span status and error fields', async () => {
    await getEngineTracer().withSpan('test.error.span', async (span) => {
      span.setStatus('error', 'boom');
      return null;
    });
    const { body } = await get(handle!.baseUrl, '/api/telemetry/spans?limit=5');
    const errored = body.spans.find((span: { name: string }) => span.name === 'test.error.span');
    expect(errored?.status).toBe('error');
    expect(errored?.error).toBe('boom');
  });

  it('GET /api/telemetry/spans includes parentId when present', async () => {
    await getEngineTracer().withSpan('parent.span', async () => {
      await getEngineTracer().withSpan('child.span', async () => null);
    });
    const { body } = await get(handle!.baseUrl, '/api/telemetry/spans?limit=20');
    const child = body.spans.find((span: { name: string }) => span.name === 'child.span');
    expect(child?.parentId).toBeDefined();
  });

  it('GET /api/telemetry/spans returns durationMs for each span', async () => {
    await traceLifecycleStep('execute', 'run-duration', async () => 'done');
    const { body } = await get(handle!.baseUrl, '/api/telemetry/spans?limit=5');
    const span = body.spans.find((item: { name: string }) => item.name === 'lifecycle.execute');
    expect(typeof span?.durationMs).toBe('number');
  });
});
