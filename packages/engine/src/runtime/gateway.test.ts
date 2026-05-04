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
import { approvalFlow } from './approval-flow';

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
  const session = {
    id: 'sess-1',
    workspaceId: '/tmp/pyrfor-test-workspace',
    title: 'web:chat-1',
    mode: 'chat' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    messageCount: 2,
    summary: 'session summary',
  };
  const messages = [
    { id: 'msg-1', role: 'user' as const, content: 'remember this', createdAt: '2026-01-01T00:00:30.000Z' },
    { id: 'msg-2', role: 'assistant' as const, content: 'remembered', createdAt: '2026-01-01T00:01:00.000Z' },
  ];
  return {
    handleMessage: vi.fn().mockResolvedValue({ success: true, response }),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/pyrfor-test-workspace'),
    getMemorySnapshot: vi.fn().mockReturnValue({
      lines: ['pyrfor memory line'],
      files: ['MEMORY.md'],
      workspaceFiles: { 'MEMORY.md': { present: true, lineCount: 1 } },
      daily: [],
    }),
    getMemoryContinuityStatus: vi.fn().mockResolvedValue({
      workspaceId: '/tmp/pyrfor-test-workspace',
      projectId: 'project-1',
      generatedAt: '2026-01-01T00:06:00.000Z',
      workspaceFiles: {
        present: 1,
        total: 2,
        missing: ['SOUL.md'],
        files: {
          'MEMORY.md': { present: true, lineCount: 1 },
          'SOUL.md': { present: false, lineCount: 0 },
        },
      },
      latestDailyRollup: {
        status: 'ok',
        date: '2026-01-01',
        createdAt: '2026-01-01T00:02:00.000Z',
        artifact: {
          id: 'daily-rollup-1.json',
          kind: 'summary',
          uri: '/tmp/daily-rollup-1.json',
          sha256: 'sha-daily-rollup',
          createdAt: '2026-01-01T00:02:00.000Z',
          meta: { memoryKind: 'daily_rollup', workspaceId: '/tmp/pyrfor-test-workspace' },
        },
      },
      latestProjectRollup: {
        status: 'ok',
        projectId: 'project-1',
        createdAt: '2026-01-01T00:05:00.000Z',
        artifact: {
          id: 'project-rollup-1.json',
          kind: 'summary',
          uri: '/tmp/project-rollup-1.json',
          sha256: 'sha-project-rollup',
          createdAt: '2026-01-01T00:05:00.000Z',
          meta: { memoryKind: 'project_rollup', workspaceId: '/tmp/pyrfor-test-workspace', projectId: 'project-1' },
        },
      },
      latestOpenClawReport: {
        status: 'ok',
        createdAt: '2026-01-01T00:03:00.000Z',
        artifact: {
          id: 'openclaw-report-1.json',
          kind: 'summary',
          uri: '/tmp/openclaw-report-1.json',
          sha256: 'sha-openclaw-report',
          createdAt: '2026-01-01T00:03:00.000Z',
          meta: { memoryKind: 'openclaw_import_report', workspaceId: '/tmp/pyrfor-test-workspace' },
        },
        counts: { importable: 1, skipped: 0, personality: 1, memories: 0, skills: 0, redactions: 0 },
      },
      warnings: ['memory_files_missing'],
    }),
    searchMemory: vi.fn().mockResolvedValue({
      workspaceId: session.workspaceId,
      query: 'delivery',
      projectId: 'project-1',
      results: [{
        id: 'memory-1',
        summary: 'delivery memory',
        content: 'delivery evidence memory',
        createdAt: '2026-01-01T00:00:00.000Z',
        memoryType: 'semantic',
        importance: 0.9,
        workspaceId: session.workspaceId,
        projectId: 'project-1',
        source: 'durable',
        scopeVisibility: 'project',
        projectMemoryCategory: 'decision',
      }],
    }),
    createMemoryCorrection: vi.fn().mockResolvedValue({
      memory: {
        id: 'memory-correction-1',
        summary: 'corrected fact',
        content: 'corrected fact content',
        createdAt: '2026-01-01T00:02:00.000Z',
        memoryType: 'semantic',
        importance: 0.8,
        workspaceId: session.workspaceId,
        projectId: 'project-1',
        source: 'durable',
        scopeVisibility: 'project',
      },
    }),
    previewOpenClawMigration: vi.fn().mockResolvedValue({
      artifact: {
        id: 'openclaw-report-1.json',
        kind: 'summary',
        uri: '/tmp/openclaw-report-1.json',
        sha256: 'sha-openclaw-report',
        createdAt: '2026-01-01T00:03:00.000Z',
        meta: { memoryKind: 'openclaw_import_report', workspaceId: session.workspaceId },
      },
      report: {
        schemaVersion: 'openclaw_migration_report.v1',
        generatedAt: '2026-01-01T00:03:00.000Z',
        workspaceId: session.workspaceId,
        sourceRoot: '/tmp/openclaw-workspace',
        counts: { importable: 1, skipped: 0, personality: 1, memories: 0, skills: 0, redactions: 0 },
        entries: [{
          sourceRelPath: 'MEMORY.md',
          sourceKind: 'personality',
          memoryType: 'semantic',
          fingerprint: 'fp-1',
          bytes: 12,
          mtime: '2026-01-01T00:00:00.000Z',
          summary: 'MEMORY.md: imported memory',
          redactionCount: 0,
        }],
        skipped: [],
      },
    }),
    getLatestOpenClawMigrationReport: vi.fn().mockResolvedValue({
      artifact: {
        id: 'openclaw-report-1.json',
        kind: 'summary',
        uri: '/tmp/openclaw-report-1.json',
        sha256: 'sha-openclaw-report',
        createdAt: '2026-01-01T00:03:00.000Z',
        meta: { memoryKind: 'openclaw_import_report', workspaceId: session.workspaceId },
      },
      report: {
        schemaVersion: 'openclaw_migration_report.v1',
        generatedAt: '2026-01-01T00:03:00.000Z',
        workspaceId: session.workspaceId,
        sourceRoot: '/tmp/openclaw-workspace',
        counts: { importable: 1, skipped: 0, personality: 1, memories: 0, skills: 0, redactions: 0 },
        entries: [],
        skipped: [],
      },
    }),
    importOpenClawMigration: vi.fn().mockResolvedValue({
      imported: 1,
      skipped: 0,
      memoryIds: ['memory-import-1'],
      artifact: {
        id: 'openclaw-result-1.json',
        kind: 'summary',
        uri: '/tmp/openclaw-result-1.json',
        sha256: 'sha-openclaw-result',
        createdAt: '2026-01-01T00:04:00.000Z',
        meta: { workspaceId: session.workspaceId, memoryKind: 'openclaw_import_result' },
      },
    }),
    listSessions: vi.fn().mockResolvedValue([session]),
    getSession: vi.fn().mockImplementation(async (sessionId: string) => (
      sessionId === session.id ? { ...session, messages, metadata: { workspaceId: session.workspaceId } } : null
    )),
    getSessionTimeline: vi.fn().mockImplementation(async (sessionId: string) => (
      sessionId === session.id
        ? {
            sessionId: session.id,
            workspaceId: session.workspaceId,
            summary: session.summary,
            events: messages.map((message, index) => ({
              id: message.id,
              sessionId: session.id,
              type: 'message' as const,
              role: message.role,
              content: message.content,
              createdAt: message.createdAt,
              index,
            })),
          }
        : null
    )),
    createDailyMemoryRollup: vi.fn().mockResolvedValue({
      date: '2026-01-01',
      workspaceId: session.workspaceId,
      agentId: 'pyrfor-runtime',
      sessionCount: 1,
      messageCount: 2,
      ledgerEventCount: 0,
      runIds: [],
      summary: 'Daily rollup for 2026-01-01: 1 sessions, 2 messages, 0 ledger events.',
      content: '# Pyrfor daily memory rollup',
      memoryId: 'memory-1',
    }),
    createProjectMemoryRollup: vi.fn().mockResolvedValue({
      workspaceId: session.workspaceId,
      projectId: 'project-1',
      agentId: 'pyrfor-runtime',
      sessionCount: 1,
      ledgerEventCount: 2,
      runIds: ['run-1'],
      artifact: {
        id: 'project-rollup-1.json',
        kind: 'summary',
        uri: '/tmp/project-rollup-1.json',
        sha256: 'sha-project-rollup',
        createdAt: '2026-01-01T00:05:00.000Z',
        meta: { memoryKind: 'project_rollup' },
      },
      memories: [{
        category: 'decision',
        memoryType: 'semantic',
        summary: 'Decisions for project project-1: approved migration',
        content: 'approved migration',
        memoryId: 'project-memory-1',
      }],
    }),
    getRunContextPack: vi.fn().mockResolvedValue({
      artifact: {
        id: 'context-pack-1.json',
        kind: 'context_pack',
        uri: '/tmp/context-pack-1.json',
        sha256: 'sha-context-pack',
        createdAt: '2026-01-01T00:06:00.000Z',
      },
      pack: {
        schemaVersion: 'context_pack.v1',
        packId: 'ctx-run-1',
        hash: 'hash-context',
        compiledAt: '2026-01-01T00:06:00.000Z',
        runId: 'run-1',
        workspaceId: session.workspaceId,
        projectId: 'project-1',
        task: { title: 'Build product', description: `${'sensitive prompt '.repeat(80)}tail` },
        sections: [{
          id: 'project_memory',
          kind: 'memory',
          title: 'Project memory',
          priority: 50,
          content: `${'private memory '.repeat(80)}tail`,
          sources: [{ kind: 'memory', ref: 'memory-1', role: 'memory' }],
        }],
        sourceRefs: [],
      },
    }),
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

function parseSSE(raw: string): Array<{ event?: string; data: unknown }> {
  const messages: Array<{ event?: string; data: unknown }> = [];
  for (const frame of raw.split(/\n\n+/)) {
    if (!frame.trim()) continue;
    let event: string | undefined;
    let dataLine: string | undefined;
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice('event: '.length).trim();
      if (line.startsWith('data: ')) dataLine = line.slice('data: '.length).trim();
    }
    if (dataLine === undefined) continue;
    let data: unknown = dataLine;
    try { data = JSON.parse(dataLine); } catch { /* keep string */ }
    messages.push({ event, data });
  }
  return messages;
}

async function readSseUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (messages: Array<{ event?: string; data: unknown }>) => boolean,
): Promise<Array<{ event?: string; data: unknown }>> {
  const decoder = new TextDecoder();
  let raw = '';
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: undefined }>((resolve) => setTimeout(() => resolve({ done: true }), remaining)),
    ]);
    if (result.done && !result.value) break;
    if (result.value) raw += decoder.decode(result.value, { stream: true });
    const messages = parseSSE(raw);
    if (predicate(messages)) return messages;
  }
  return parseSSE(raw);
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
        connectorInventory: {
          getSnapshot: () => ({
            checkedAt: '2026-05-04T00:00:00.000Z',
            statusSource: 'local-config',
            connectors: [{
              id: 'telegram',
              name: 'Telegram',
              description: 'Telegram bridge',
              direction: 'bidirectional',
              sourceSystem: 'Telegram Bot API',
              operations: ['Receive commands'],
              credentials: [{ envVar: 'TELEGRAM_BOT_TOKEN', description: 'Bot token' }],
              apiSurface: [{ method: 'WEBHOOK', path: '/api/telegram/webhook', description: 'Webhook' }],
              stub: false,
              configured: false,
              missingSecrets: ['TELEGRAM_BOT_TOKEN'],
              hasProbe: true,
              readiness: {
                state: 'pending',
                reasons: ['Missing required env: TELEGRAM_BOT_TOKEN'],
                nextStep: 'Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor.',
              },
              probePreview: {
                mode: 'descriptor-status',
                requiresApproval: true,
                requiredEnvVars: ['TELEGRAM_BOT_TOKEN'],
                headerNames: [],
                bodyConfigured: false,
                note: 'Live status comes from the connector adapter and is not executed by inventory.',
              },
              liveProbeSkipped: true,
              statusSource: 'local-config',
            }],
            summary: { total: 1, configured: 0, pending: 1, stubs: 0, liveProbeSkipped: 1 },
          }),
        },
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

    it('GET /api/effects/pending returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/effects/pending');
      expect(status).toBe(401);
    });

    it('GET /api/approvals/pending returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/approvals/pending');
      expect(status).toBe(401);
    });

    it('GET /api/audit/events returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/audit/events');
      expect(status).toBe(401);
    });

    it('POST /api/approvals/:id/decision returns 401 without bearer token', async () => {
      const { status } = await post(port, '/api/approvals/approval-1/decision', { decision: 'approve' });
      expect(status).toBe(401);
    });

    it('POST /api/memory/project-rollup returns 401 without bearer token', async () => {
      const { status } = await post(port, '/api/memory/project-rollup', { projectId: 'project-1' });
      expect(status).toBe(401);
    });

    it('GET /api/memory/continuity returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/memory/continuity');
      expect(status).toBe(401);
    });

    it('GET /api/runs/:runId/actors returns 401 without bearer token', async () => {
      const { status } = await get(port, '/api/runs/run-1/actors');
      expect(status).toBe(401);
    });

    it('skill inspector routes return 401 without bearer token', async () => {
      expect((await get(port, '/api/skills')).status).toBe(401);
      expect((await post(port, '/api/skills/recommend', { task: 'Fix TypeScript error' })).status).toBe(401);
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

    it('derives verifier waiver operator identity from authenticated token label', async () => {
      const runtime = {
        createRunVerifierWaiver: vi.fn().mockResolvedValue({
          artifact: { id: 'artifact-waiver', kind: 'verifier_waiver' },
          waiver: { schemaVersion: 'pyrfor.verifier_waiver.v1', operator: { id: 'token:operator-a', name: 'operator-a' } },
          decision: { status: 'waived', rawStatus: 'blocked' },
          run: { run_id: 'run-pf-1', status: 'completed' },
        }),
      } as unknown as PyrforRuntime & { createRunVerifierWaiver: ReturnType<typeof vi.fn> };
      gw = createRuntimeGateway({
        config: makeConfig({
          bearerTokens: [{ value: 'operator-token', label: 'operator-a', expiresAt: FUTURE }],
        }),
        runtime,
        health: makeHealth(),
      });
      await gw.start();

      const result = await post(gw.port, '/api/runs/run-pf-1/verifier-waiver', {
        operatorId: 'spoofed-operator',
        operatorName: 'Spoofed Operator',
        reason: 'Accepted known risk',
      }, 'operator-token');

      expect(result.status).toBe(201);
      expect(runtime.createRunVerifierWaiver).toHaveBeenCalledWith('run-pf-1', {
        operatorId: 'token:operator-a',
        operatorName: 'operator-a',
        reason: 'Accepted known risk',
      });
    });

    it('derives memory correction operator identity from authenticated token label', async () => {
      const runtime = {
        createMemoryCorrection: vi.fn().mockResolvedValue({
          memory: {
            id: 'memory-correction-1',
            content: 'corrected fact',
            createdAt: '2026-01-01T00:00:00.000Z',
            memoryType: 'semantic',
            importance: 0.8,
            source: 'durable',
          },
        }),
      } as unknown as PyrforRuntime & { createMemoryCorrection: ReturnType<typeof vi.fn> };
      gw = createRuntimeGateway({
        config: makeConfig({
          bearerTokens: [{ value: 'operator-token', label: 'operator-a', expiresAt: FUTURE }],
        }),
        runtime,
        health: makeHealth(),
      });
      await gw.start();

      const result = await post(gw.port, '/api/memory/corrections', {
        content: 'corrected fact',
        operatorId: 'spoofed-operator',
      }, 'operator-token');

      expect(result.status).toBe(201);
      expect(runtime.createMemoryCorrection).toHaveBeenCalledWith(expect.objectContaining({
        content: 'corrected fact',
        operatorId: 'token:operator-a',
      }));
    });

    it('returns controlled error when memory correction is not durably persisted', async () => {
      const runtime = {
        createMemoryCorrection: vi.fn().mockRejectedValue(new Error('Memory correction was not durably persisted')),
      } as unknown as PyrforRuntime;
      gw = createRuntimeGateway({
        config: makeConfig(),
        runtime,
        health: makeHealth(),
      });
      await gw.start();

      const result = await post(gw.port, '/api/memory/corrections', {
        content: 'corrected fact',
      });

      expect(result.status).toBe(503);
      expect((result.body as Record<string, unknown>)['error']).toBe('memory_persistence_failed');
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
    listeners: [] as Array<(event: any) => void>,
    subscribe: vi.fn((listener: (event: any) => void) => {
      approvals.listeners.push(listener);
      return () => {
        approvals.listeners = approvals.listeners.filter((candidate) => candidate !== listener);
      };
    }),
  };

  beforeEach(async () => {
    approvals.getPending.mockClear();
    approvals.resolveDecision.mockClear();
    approvals.listAudit.mockClear();
    approvals.subscribe.mockClear();
    approvals.listeners = [];
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

  it('redacts sensitive approval metadata before returning pending approvals', async () => {
    approvals.getPending.mockReturnValueOnce([{
      id: 'req-secret',
      toolName: 'connector_live_probe',
      summary: 'Probe https://user:pass@example.test/status?api_key=abc',
      args: {
        connectorId: 'telegram',
        connectorName: 'Telegram',
        sourceSystem: 'Telegram Bot API',
        token: 'secret-token-value',
        path: 'file:///Users/aleksandrgrebeshok/.ssh/id_rsa',
        quotedPath: 'open "/Users/aleksandrgrebeshok/.ssh/id_rsa"',
        optPath: 'read /opt/pyrfor/secret.txt',
        singleSegmentPath: 'inspect "/tmp"',
      },
    }]);

    const { status, body } = await get(port, '/api/approvals/pending');

    expect(status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('secret-token-value');
    expect(serialized).not.toContain('/Users/aleksandrgrebeshok');
    expect(body).toMatchObject({
      approvals: [expect.objectContaining({
        summary: expect.stringContaining('api_key=[redacted]'),
        args: expect.objectContaining({
          token: '[redacted]',
          path: 'file://[redacted-path]',
          quotedPath: 'open "[redacted-path]"',
          optPath: 'read [redacted-path]',
          singleSegmentPath: 'inspect "[redacted-path]"',
        }),
      })],
    });
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

  it('redacts sensitive approval audit events', async () => {
    approvals.listAudit.mockReturnValueOnce([{
      id: 'audit-secret',
      ts: '2026-05-01T00:00:00.000Z',
      type: 'approval.requested',
      requestId: 'req-secret',
      toolName: 'research_live_search',
      summary: 'Search with token=secret-token-value',
      args: {
        runId: 'run-1',
        queryHash: 'hash',
        provider: 'brave',
        authorization: 'Bearer secret-token-value',
      },
      resultSummary: 'Fetched https://example.test/search?token=secret-token-value',
    }]);

    const { status, body } = await get(port, '/api/audit/events?limit=10');

    expect(status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('secret-token-value');
    expect(body).toMatchObject({
      events: [expect.objectContaining({
        summary: 'Search with token=[redacted]',
        args: expect.objectContaining({ authorization: '[redacted]' }),
        resultSummary: expect.stringContaining('token=[redacted]'),
      })],
    });
  });

  it('streams approval snapshot and live approval events', async () => {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    try {
      const snapshotMessages = await readSseUntil(reader, (messages) => messages.some((message) => message.event === 'snapshot'));
      expect(snapshotMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'snapshot',
          data: expect.objectContaining({
            approvals: expect.arrayContaining([expect.objectContaining({ id: 'req-1' })]),
          }),
        }),
      ]));

      approvals.listeners.forEach((listener) => listener({
        type: 'approval-resolved',
        request: approvals.pending[0],
        decision: 'approve',
      }));
      const resolvedMessages = await readSseUntil(reader, (messages) =>
        messages.some((message) => message.event === 'approval-resolved')
      );
      expect(resolvedMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'approval-resolved',
          data: expect.objectContaining({
            decision: 'approve',
            request: expect.objectContaining({ id: 'req-1' }),
          }),
        }),
      ]));
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });

  it('buffers approval events that arrive while the stream snapshot is being built', async () => {
    approvals.getPending.mockImplementationOnce(() => {
      approvals.listeners.forEach((listener) => listener({
        type: 'approval-requested',
        request: { id: 'req-race', toolName: 'exec', summary: 'exec: pnpm test', args: { command: 'pnpm test' } },
      }));
      return approvals.pending;
    });
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    try {
      const messages = await readSseUntil(reader, (items) =>
        items.some((message) => message.event === 'snapshot') &&
        items.some((message) => message.event === 'approval-requested')
      );
      expect(messages.map((message) => message.event)).toEqual(expect.arrayContaining(['snapshot', 'approval-requested']));
      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'approval-requested',
          data: expect.objectContaining({
            request: expect.objectContaining({ id: 'req-race' }),
          }),
        }),
      ]));
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
  });
});

describe('Product Factory API routes', () => {
  let gw: ReturnType<typeof createRuntimeGateway>;
  let port: number;
  const deliveryEvidenceSnapshot = {
    schemaVersion: 'pyrfor.delivery_evidence.v1',
    runId: 'run-pf-1',
    capturedAt: '2026-05-01T00:00:00.000Z',
    deliveryChecklist: [],
    git: {
      available: true,
      branch: 'main',
      headSha: 'abc123',
      ahead: 0,
      behind: 0,
      dirtyFiles: [],
      latestCommits: [],
      remote: {
        name: 'origin',
        url: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.git',
      },
    },
    github: {
      provider: 'github',
      available: false,
      repository: null,
      branch: null,
      pullRequests: [],
      workflowRuns: [],
      errors: [],
    },
  };
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
      artifact: {
        id: 'artifact-evidence',
        kind: 'delivery_evidence',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-evidence.json',
        sha256: 'evidence-sha',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      snapshot: deliveryEvidenceSnapshot,
    }),
    getRunDeliveryEvidence: vi.fn().mockResolvedValue({
      artifact: {
        id: 'artifact-evidence',
        kind: 'delivery_evidence',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-evidence.json',
        sha256: 'evidence-sha',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      snapshot: deliveryEvidenceSnapshot,
    }),
    createRunGithubDeliveryPlan: vi.fn().mockResolvedValue({
      artifact: {
        id: 'artifact-plan',
        kind: 'delivery_plan',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-plan.json',
        sha256: 'plan-sha',
        createdAt: '2026-05-01T00:01:00.000Z',
      },
      plan: { schemaVersion: 'pyrfor.github_delivery_plan.v1', runId: 'run-pf-1', mode: 'dry_run', applySupported: false },
      evidenceArtifact: {
        id: 'artifact-evidence',
        kind: 'delivery_evidence',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-evidence.json',
        sha256: 'evidence-sha',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
    }),
    getRunGithubDeliveryPlan: vi.fn().mockResolvedValue({
      artifact: {
        id: 'artifact-plan',
        kind: 'delivery_plan',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-plan.json',
        sha256: 'plan-sha',
        createdAt: '2026-05-01T00:01:00.000Z',
      },
      plan: { schemaVersion: 'pyrfor.github_delivery_plan.v1', runId: 'run-pf-1', mode: 'dry_run', applySupported: false },
    }),
    getRunGithubDeliveryApply: vi.fn().mockResolvedValue({
      artifact: {
        id: 'artifact-apply',
        kind: 'delivery_apply',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-apply.json',
        sha256: 'apply-sha',
        createdAt: '2026-05-01T00:02:00.000Z',
      },
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
      artifact: {
        id: 'artifact-apply',
        kind: 'delivery_apply',
        uri: 'file:///Users/aleksandrgrebeshok/pyrfor-dev/.pyrfor/artifacts/artifact-apply.json',
        sha256: 'apply-sha',
        createdAt: '2026-05-01T00:02:00.000Z',
      },
      result: {
        schemaVersion: 'pyrfor.github_delivery_apply.v1',
        runId: 'run-pf-1',
        draftPullRequest: { number: 12, url: 'https://github.com/acme/pyrfor/pull/12', title: 'Ship feature', draft: true },
      },
    }),
    getRunVerifierStatus: vi.fn().mockResolvedValue({
      decision: {
        status: 'blocked',
        rawStatus: 'blocked',
        reason: 'policy violation',
        waiverEligible: true,
        waiverPath: '/api/runs/run-pf-1/verifier-waiver',
      },
    }),
    createRunVerifierWaiver: vi.fn().mockResolvedValue({
      artifact: { id: 'artifact-waiver', kind: 'verifier_waiver' },
      waiver: {
        schemaVersion: 'pyrfor.verifier_waiver.v1',
        runId: 'run-pf-1',
        rawStatus: 'blocked',
        operator: { id: 'operator' },
        reason: 'Accepted known risk',
        scope: 'all',
        waivedAt: '2026-05-03T00:00:00.000Z',
      },
      decision: { status: 'waived', rawStatus: 'blocked', waiverEligible: true, waiverPath: '/api/runs/run-pf-1/verifier-waiver' },
      run: { run_id: 'run-pf-1', status: 'completed' },
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
    getRunVerifierStatus: ReturnType<typeof vi.fn>;
    createRunVerifierWaiver: ReturnType<typeof vi.fn>;
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
    runtime.getRunVerifierStatus.mockClear();
    runtime.createRunVerifierWaiver.mockClear();
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
    const response = await post(port, '/api/runs/run-pf-1/delivery-evidence', {
      issueNumber: 42,
      summary: 'Delivered',
    });
    expect(response).toMatchObject({
      status: 201,
      body: {
        artifact: expect.objectContaining({
          id: 'artifact-evidence',
          kind: 'delivery_evidence',
          sha256: 'evidence-sha',
          createdAt: '2026-05-01T00:00:00.000Z',
        }),
        snapshot: expect.objectContaining({ schemaVersion: 'pyrfor.delivery_evidence.v1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(response.body.snapshot.git.remote).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
    expect(JSON.stringify(response.body)).not.toContain('[redacted-path]');
    expect(runtime.captureRunDeliveryEvidence).toHaveBeenCalledWith('run-pf-1', {
      issueNumber: 42,
      summary: 'Delivered',
    });
  });

  it('returns latest delivery evidence through GET /api/runs/:runId/delivery-evidence', async () => {
    const response = await get(port, '/api/runs/run-pf-1/delivery-evidence');
    expect(response).toMatchObject({
      status: 200,
      body: {
        artifact: expect.objectContaining({
          id: 'artifact-evidence',
          kind: 'delivery_evidence',
          sha256: 'evidence-sha',
          createdAt: '2026-05-01T00:00:00.000Z',
        }),
        snapshot: expect.objectContaining({ runId: 'run-pf-1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(response.body.snapshot.git.remote).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
    expect(JSON.stringify(response.body)).not.toContain('[redacted-path]');
    expect(runtime.getRunDeliveryEvidence).toHaveBeenCalledWith('run-pf-1');
  });

  it('creates dry-run GitHub delivery plans through POST /api/runs/:runId/github-delivery-plan', async () => {
    const response = await post(port, '/api/runs/run-pf-1/github-delivery-plan', {
      issueNumber: 42,
      title: 'Ship feature',
    });
    expect(response).toMatchObject({
      status: 201,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-plan', kind: 'delivery_plan', sha256: 'plan-sha' }),
        evidenceArtifact: expect.objectContaining({ id: 'artifact-evidence', kind: 'delivery_evidence', sha256: 'evidence-sha' }),
        plan: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_plan.v1', mode: 'dry_run', applySupported: false }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(response.body.evidenceArtifact.uri).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
    expect(runtime.createRunGithubDeliveryPlan).toHaveBeenCalledWith('run-pf-1', {
      issueNumber: 42,
      title: 'Ship feature',
    });
  });

  it('returns latest dry-run GitHub delivery plan through GET /api/runs/:runId/github-delivery-plan', async () => {
    const response = await get(port, '/api/runs/run-pf-1/github-delivery-plan');
    expect(response).toMatchObject({
      status: 200,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-plan', kind: 'delivery_plan', sha256: 'plan-sha' }),
        plan: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_plan.v1', runId: 'run-pf-1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
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
    const response = await post(port, '/api/runs/run-pf-1/github-delivery-apply', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
      approvalId: 'approval-1',
    });
    expect(response).toMatchObject({
      status: 201,
      body: {
        status: 'applied',
        artifact: expect.objectContaining({ id: 'artifact-apply', kind: 'delivery_apply', sha256: 'apply-sha' }),
        result: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_apply.v1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
    expect(runtime.applyApprovedRunGithubDelivery).toHaveBeenCalledWith('run-pf-1', {
      planArtifactId: 'artifact-plan',
      expectedPlanSha256: 'plan-sha',
      approvalId: 'approval-1',
    });
  });

  it('returns latest GitHub delivery apply result through GET /api/runs/:runId/github-delivery-apply', async () => {
    const response = await get(port, '/api/runs/run-pf-1/github-delivery-apply');
    expect(response).toMatchObject({
      status: 200,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-apply', kind: 'delivery_apply', sha256: 'apply-sha' }),
        result: expect.objectContaining({ schemaVersion: 'pyrfor.github_delivery_apply.v1', runId: 'run-pf-1' }),
      },
    });
    expect(response.body.artifact.uri).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('/Users/aleksandrgrebeshok');
    expect(JSON.stringify(response.body)).not.toContain('file://');
    expect(runtime.getRunGithubDeliveryApply).toHaveBeenCalledWith('run-pf-1');
  });

  it('returns verifier status through GET /api/runs/:runId/verifier-status', async () => {
    await expect(get(port, '/api/runs/run-pf-1/verifier-status')).resolves.toMatchObject({
      status: 200,
      body: {
        decision: expect.objectContaining({
          status: 'blocked',
          rawStatus: 'blocked',
          waiverEligible: true,
        }),
      },
    });
    expect(runtime.getRunVerifierStatus).toHaveBeenCalledWith('run-pf-1');
  });

  it('creates verifier waivers through POST /api/runs/:runId/verifier-waiver', async () => {
    await expect(post(port, '/api/runs/run-pf-1/verifier-waiver', {
      operatorId: 'operator',
      reason: 'Accepted known risk',
      scope: 'all',
    })).resolves.toMatchObject({
      status: 201,
      body: {
        artifact: expect.objectContaining({ id: 'artifact-waiver', kind: 'verifier_waiver' }),
        waiver: expect.objectContaining({ schemaVersion: 'pyrfor.verifier_waiver.v1' }),
        decision: expect.objectContaining({ status: 'waived' }),
      },
    });
    expect(runtime.createRunVerifierWaiver).toHaveBeenCalledWith('run-pf-1', {
      operatorId: 'operator',
      reason: 'Accepted known risk',
      scope: 'all',
    });
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
      preview: 'cat "/Users/aleksandrgrebeshok/.ssh/id_rsa" token=stream-secret',
    });
    await eventLedger.append({
      type: 'verifier.completed',
      run_id: 'run-1',
      subject_id: 'run-1',
      status: 'warning',
      action: 'allow_with_warning',
      reason: 'smoke verifier warning',
    });
    await eventLedger.append({
      type: 'actor.spawned',
      run_id: 'run-1',
      actor_id: 'actor-planner',
      agent_id: 'planner',
      agent_name: 'Planner',
      role: 'planner',
      current_work: 'Plan the orchestration API',
      budget: { profile: 'standard', tokensUsed: 1200, tokenLimit: 4000 },
    });
    await eventLedger.append({
      type: 'actor.mailbox.enqueued',
      run_id: 'run-1',
      actor_id: 'actor-planner',
      task: 'Review worker frames',
    });
    await eventLedger.append({
      type: 'actor.work.started',
      run_id: 'run-1',
      actor_id: 'actor-planner',
      current_work: 'Review worker frames',
    });
    await eventLedger.append({
      type: 'actor.work.completed',
      run_id: 'run-1',
      actor_id: 'actor-planner',
      summary: 'Actor proof recorded',
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
    dag.addNode({
      id: 'actor-mailbox-1',
      kind: 'actor.mailbox.task',
      payload: {
        runId: 'run-1',
        actorId: 'actor-planner',
      },
      provenance: [{ kind: 'run', ref: 'run-1', role: 'input' }],
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
    expect(JSON.stringify(body)).not.toContain(tmpDir);
    const orchestration = (body as { orchestration?: Record<string, any> }).orchestration;
    expect(orchestration?.['runs']).toMatchObject({ total: 1, active: 1 });
    expect(orchestration?.['effects']).toMatchObject({ pending: 1 });
    expect(orchestration?.['approvals']).toMatchObject({ pending: 0 });
    expect(orchestration?.['workerFrames']).toMatchObject({ total: 1, lastType: 'tool_call' });
    expect(orchestration?.['verifier']).toMatchObject({ blocked: 0, status: 'warning' });
    expect(orchestration?.['dag']).toMatchObject({ total: 3, running: 1 });
    expect(orchestration?.['overlays']).toMatchObject({ total: 2, domainIds: ['ceoclaw', 'ochag'] });
    expect(orchestration?.['contextPack']).toMatchObject({ kind: 'context_pack', runId: 'run-1' });
  });

  it('lists pending effects derived from unsettled effect ledger events', async () => {
    await expect(get(port, '/api/effects/pending')).resolves.toMatchObject({
      status: 200,
      body: {
        effects: [
          expect.objectContaining({
            effect_id: 'effect-1',
            run_id: 'run-1',
            effect_kind: 'tool_call',
            tool: 'read_file',
            preview: 'cat "[redacted-path]" token=[redacted]',
          }),
        ],
      },
    });

    await eventLedger.append({ type: 'effect.denied', run_id: 'run-1', effect_id: 'effect-1', reason: 'test denial' });
    await expect(get(port, '/api/effects/pending')).resolves.toMatchObject({
      status: 200,
      body: { effects: [] },
    });
  });

  it('streams operator snapshot and live ledger events', async () => {
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events/stream`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    try {
      const snapshotMessages = await readSseUntil(reader, (messages) => messages.some((message) => message.event === 'snapshot'));
      expect(snapshotMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'snapshot',
          data: expect.objectContaining({
            runs: expect.arrayContaining([expect.objectContaining({ run_id: 'run-1' })]),
            effects: expect.arrayContaining([expect.objectContaining({
              effect_id: 'effect-1',
              preview: 'cat "[redacted-path]" token=[redacted]',
            })]),
          }),
        }),
      ]));
      expect(JSON.stringify(snapshotMessages)).not.toContain('/Users/aleksandrgrebeshok');
      expect(JSON.stringify(snapshotMessages)).not.toContain('stream-secret');
      expect(JSON.stringify(snapshotMessages)).not.toContain(tmpDir);

      await eventLedger.append({
        type: 'run.blocked',
        run_id: 'run-1',
        reason: 'stream test block at "/Users/aleksandrgrebeshok/.ssh/id_rsa" token=stream-secret',
      });
      const ledgerMessages = await readSseUntil(reader, (messages) =>
        messages.some((message) =>
          message.event === 'ledger'
          && (message.data as { event?: { type?: string; reason?: string } }).event?.type === 'run.blocked'
        )
      );
      expect(JSON.stringify(ledgerMessages)).not.toContain('/Users/aleksandrgrebeshok');
      expect(JSON.stringify(ledgerMessages)).not.toContain('stream-secret');
      expect(ledgerMessages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          event: 'ledger',
          data: expect.objectContaining({
            event: expect.objectContaining({
              type: 'run.blocked',
              reason: 'stream test block at "[redacted-path]" token=[redacted]',
            }),
          }),
        }),
      ]));
    } finally {
      controller.abort();
      await reader.cancel().catch(() => {});
    }
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
    await expect(get(port, '/api/runs/run-1/actors')).resolves.toMatchObject({
      status: 200,
      body: {
        runId: 'run-1',
        actors: expect.arrayContaining([
          expect.objectContaining({
            actorId: 'actor-planner',
            agentId: 'planner',
            agentName: 'Planner',
            status: 'idle',
            currentWork: 'Review worker frames',
            mailbox: expect.objectContaining({ pending: 2 }),
            budget: expect.objectContaining({ profile: 'standard', tokensUsed: 1200 }),
            outputs: expect.arrayContaining(['Actor proof recorded']),
          }),
        ]),
        totals: expect.objectContaining({ actors: 2, mailboxPending: 2 }),
      },
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
    const overlayList = await get(port, '/api/overlays');
    expect(overlayList).toMatchObject({
      status: 200,
      body: { overlays: expect.arrayContaining([expect.objectContaining({ domainId: 'ochag' })]) },
    });
    const legacyOchagOverlay = (overlayList.body as { overlays: Array<Record<string, unknown>> }).overlays
      .find((overlay) => overlay.domainId === 'ochag');
    expect(legacyOchagOverlay).toMatchObject({
      workflowTemplates: expect.any(Array),
      adapterRegistrations: expect.any(Array),
      toolPermissionOverrides: expect.any(Object),
    });

    const publicOverlayList = await get(port, '/api/overlay-summaries');
    expect(publicOverlayList).toMatchObject({
      status: 200,
      body: { overlays: expect.arrayContaining([expect.objectContaining({ domainId: 'ochag' })]) },
    });
    const publicOchagOverlay = (publicOverlayList.body as { overlays: Array<Record<string, unknown>> }).overlays
      .find((overlay) => overlay.domainId === 'ochag');
    expect(publicOchagOverlay).toMatchObject({
      workflowCount: expect.any(Number),
      adapterCount: expect.any(Number),
      privacyRuleIds: expect.any(Array),
      toolPermissionSummaries: expect.any(Array),
    });
    expect(publicOchagOverlay).not.toHaveProperty('workflowTemplates');
    expect(publicOchagOverlay).not.toHaveProperty('adapterRegistrations');
    expect(publicOchagOverlay).not.toHaveProperty('toolPermissionOverrides');
    expect(publicOchagOverlay).not.toHaveProperty('staticPolicyFacts');

    await expect(get(port, '/api/overlays/ochag')).resolves.toMatchObject({
      status: 200,
      body: { overlay: expect.objectContaining({ domainId: 'ochag', workflowTemplates: expect.any(Array) }) },
    });
    await expect(get(port, '/api/overlay-summaries/ceoclaw')).resolves.toMatchObject({
      status: 200,
      body: {
        overlay: expect.objectContaining({
          domainId: 'ceoclaw',
          workflowCount: expect.any(Number),
          adapterCount: expect.any(Number),
          toolPermissionSummaries: expect.arrayContaining(['network_write:deny']),
        }),
      },
    });
    const ceoclawOverlay = (await get(port, '/api/overlay-summaries/ceoclaw')).body as { overlay: Record<string, unknown> };
    expect(ceoclawOverlay.overlay).not.toHaveProperty('workflowTemplates');
    expect(ceoclawOverlay.overlay).not.toHaveProperty('adapterRegistrations');
    expect(ceoclawOverlay.overlay).not.toHaveProperty('toolPermissionOverrides');
    expect(ceoclawOverlay.overlay).not.toHaveProperty('staticPolicyFacts');
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
  let runtime: PyrforRuntime;
  let connectorProbeStatus: ReturnType<typeof vi.fn>;
  let researchSearchCapture: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    approvalFlow.resetForTests();
    tmpDir = mkdtempSync(pathModule.join(osTmpdir(), 'pyrfor-gw-test-'));
    goalStore = new GoalStore(tmpDir);
    runtime = makeRuntime();
    researchSearchCapture = vi.fn(async (_runId: string, input: { query: string; approvalId: string }) => ({
      artifact: {
        id: 'research-search-1.json',
        kind: 'summary',
        uri: '/tmp/research-search-1.json',
        sha256: 'sha-research-search',
        createdAt: '2026-05-04T00:02:00.000Z',
        meta: { artifactKind: 'research_evidence', sourceMode: 'governed_search' },
      },
      snapshot: {
        schemaVersion: 'pyrfor.research_evidence.v2',
        createdAt: '2026-05-04T00:02:00.000Z',
        runId: _runId,
        query: input.query,
        queryHash: 'query-hash',
        sourceMode: 'governed_search',
        effectsExecuted: [{
          kind: 'web_search',
          provider: 'brave',
          approvalId: input.approvalId,
          executedAt: '2026-05-04T00:02:00.000Z',
          maxResults: 5,
          resultCount: 1,
        }],
        sources: [{ url: 'https://example.com/search', title: 'Search result' }],
        summary: 'Governed brave search captured 1 source.',
        notes: [],
      },
    }));
    (runtime as unknown as { captureRunResearchSearch: typeof researchSearchCapture }).captureRunResearchSearch = researchSearchCapture;
    connectorProbeStatus = vi.fn(async () => ({
      id: 'telegram',
      name: 'Telegram',
      description: 'Telegram bridge',
      direction: 'bidirectional' as const,
      sourceSystem: 'Telegram Bot API',
      operations: ['Receive commands'],
      credentials: [{ envVar: 'TELEGRAM_BOT_TOKEN', description: 'Bot token' }],
      apiSurface: [{ method: 'WEBHOOK' as const, path: '/api/telegram/webhook', description: 'Webhook' }],
      stub: false,
      status: 'pending' as const,
      configured: false,
      checkedAt: '2026-05-04T00:01:00.000Z',
      message: 'Probe reached https://bot:secret@example.test/status?api_key=secret&ok=1 with token=telegram-token-123456 and Bearer abcdefghijk.',
      missingSecrets: ['TELEGRAM_BOT_TOKEN'],
      metadata: {
        probeUrl: 'https://bot:secret@example.test/status?api_key=secret&ok=1',
        authToken: 'secret',
        lastErrorMessage: 'upstream echoed password: hunter2 and api_key=telegram-token-123456',
      },
    }));
    gw = createRuntimeGateway({
      config: makeConfig(),
      runtime,
      goalStore,
      approvalSettingsPath: pathModule.join(tmpDir, 'approval-settings.json'),
      staticDir: ACTUAL_STATIC_DIR,
      connectorInventory: {
        getSnapshot: () => ({
          checkedAt: '2026-05-04T00:00:00.000Z',
          statusSource: 'local-config',
          connectors: [{
            id: 'telegram',
            name: 'Telegram',
            description: 'Telegram bridge',
            direction: 'bidirectional',
            sourceSystem: 'Telegram Bot API',
            operations: ['Receive commands'],
            credentials: [{ envVar: 'TELEGRAM_BOT_TOKEN', description: 'Bot token' }],
            apiSurface: [{ method: 'WEBHOOK', path: '/api/telegram/webhook', description: 'Webhook' }],
            stub: false,
            configured: false,
            missingSecrets: ['TELEGRAM_BOT_TOKEN'],
            hasProbe: true,
            readiness: {
              state: 'pending',
              reasons: ['Missing required env: TELEGRAM_BOT_TOKEN'],
              nextStep: 'Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor.',
            },
            probePreview: {
              mode: 'descriptor-status',
              requiresApproval: true,
              requiredEnvVars: ['TELEGRAM_BOT_TOKEN'],
              headerNames: [],
              bodyConfigured: false,
              note: 'Live status comes from the connector adapter and is not executed by inventory.',
            },
            liveProbeSkipped: true,
            statusSource: 'local-config',
          }],
          summary: { total: 1, configured: 0, pending: 1, stubs: 0, liveProbeSkipped: 1 },
        }),
        probeStatus: connectorProbeStatus,
      },
    });
    await gw.start();
    port = gw.port;
  });

  afterEach(async () => {
    await gw.stop();
    approvalFlow.resetForTests();
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

    it('GET /api/connectors/inventory returns local-only connector inventory', async () => {
      const { status, body } = await get(port, '/api/connectors/inventory');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        statusSource: 'local-config',
        summary: { total: 1, pending: 1, liveProbeSkipped: 1 },
        connectors: [expect.objectContaining({
          id: 'telegram',
          missingSecrets: ['TELEGRAM_BOT_TOKEN'],
          readiness: expect.objectContaining({
            state: 'pending',
            nextStep: 'Set TELEGRAM_BOT_TOKEN and refresh Connector Doctor.',
          }),
          probePreview: expect.objectContaining({
            mode: 'descriptor-status',
            requiredEnvVars: ['TELEGRAM_BOT_TOKEN'],
          }),
          liveProbeSkipped: true,
          statusSource: 'local-config',
        })],
      });
    });

    it('skill inspector routes return metadata only and bounded recommendations', async () => {
      const catalog = await get(port, '/api/skills');
      expect(catalog.status).toBe(200);
      expect(catalog.body).toMatchObject({
        total: expect.any(Number),
        skills: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            systemPromptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            stepsCount: expect.any(Number),
          }),
        ]),
      });
      for (const skill of (catalog.body as { skills: Array<Record<string, unknown>> }).skills) {
        expect(skill.systemPrompt).toBeUndefined();
      }

      const recommended = await post(port, '/api/skills/recommend', { task: 'Fix a TypeScript type error', limit: 50 });
      expect(recommended.status).toBe(200);
      expect(recommended.body).toMatchObject({
        limit: 10,
        recommendations: expect.any(Array),
      });
      for (const skill of (recommended.body as { recommendations: Array<Record<string, unknown>> }).recommendations) {
        expect(skill.systemPrompt).toBeUndefined();
      }
    });

    it('POST /api/skills/recommend rejects invalid input', async () => {
      const invalid = await post(port, '/api/skills/recommend', { task: '   ' });
      expect(invalid.status).toBe(400);
      expect(invalid.body).toMatchObject({ error: 'invalid_skill_task' });
    });

    it('POST /api/connectors/:id/probe requires approval before running live status probe', async () => {
      const requested = await post(port, '/api/connectors/telegram/probe', {});
      expect(requested.status).toBe(202);
      expect(requested.body).toMatchObject({
        status: 'approval_required',
        connectorId: 'telegram',
        liveProbe: true,
        approval: expect.objectContaining({
          id: 'connector-live-probe:telegram',
          toolName: 'connector_live_probe',
        }),
      });
      expect(connectorProbeStatus).not.toHaveBeenCalled();

      const pendingAttempt = await post(port, '/api/connectors/telegram/probe', { approvalId: 'connector-live-probe:telegram' });
      expect(pendingAttempt.status).toBe(409);
      expect(connectorProbeStatus).not.toHaveBeenCalled();

      const decision = await post(port, '/api/approvals/connector-live-probe:telegram/decision', { decision: 'approve' });
      expect(decision.status).toBe(200);

      const probed = await post(port, '/api/connectors/telegram/probe', { approvalId: 'connector-live-probe:telegram' });
      expect(probed.status).toBe(200);
      expect(probed.body).toMatchObject({
        status: 'probed',
        connectorId: 'telegram',
        liveProbe: true,
        connector: expect.objectContaining({
          id: 'telegram',
          status: 'pending',
          message: 'Probe reached https://redacted:redacted@example.test/status?api_key=[redacted] with token=[redacted] and Bearer [redacted]',
          missingSecrets: ['TELEGRAM_BOT_TOKEN'],
          metadata: {
            probeUrl: 'https://redacted:redacted@example.test/status?api_key=[redacted]',
            authToken: '[redacted]',
            lastErrorMessage: 'upstream echoed password: [redacted] and api_key=[redacted]',
          },
        }),
      });
      expect(connectorProbeStatus).toHaveBeenCalledWith('telegram');
    });

    it('redacts live probe exception text before returning or auditing failures', async () => {
      connectorProbeStatus.mockRejectedValueOnce(
        new Error('fetch failed for https://bot:secret@example.test/status?api_key=secret with token=telegram-token-123456 and Bearer abcdefghijk'),
      );

      const requested = await post(port, '/api/connectors/telegram/probe', {});
      expect(requested.status).toBe(202);
      const decision = await post(port, '/api/approvals/connector-live-probe:telegram/decision', { decision: 'approve' });
      expect(decision.status).toBe(200);

      const failed = await post(port, '/api/connectors/telegram/probe', { approvalId: 'connector-live-probe:telegram' });
      expect(failed.status).toBe(500);
      expect(failed.body).toMatchObject({
        error: 'connector_probe_failed',
        message: 'fetch failed for https://redacted:redacted@example.test/status?api_key=[redacted] with token=[redacted] and Bearer [redacted]',
      });

      const audit = await get(port, '/api/audit/events?limit=10');
      expect(audit.status).toBe(200);
      expect(JSON.stringify(audit.body)).not.toContain('telegram-token-123456');
      expect(JSON.stringify(audit.body)).not.toContain('bot:secret');
      expect(JSON.stringify(audit.body)).not.toContain('abcdefghijk');
    });

    it('POST /api/runs/:id/research-search requires approval before live search capture', async () => {
      const originalBraveKey = process.env['BRAVE_API_KEY'];
      process.env['BRAVE_API_KEY'] = 'test-brave-key';
      const requested = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        maxResults: 5,
      });
      expect(requested.status).toBe(202);
      expect(requested.body).toMatchObject({
        status: 'approval_required',
        runId: 'run-1',
        liveSearch: true,
        approval: expect.objectContaining({
          toolName: 'research_live_search',
          args: expect.objectContaining({
            runId: 'run-1',
            queryHash: expect.any(String),
            maxResults: 5,
            provider: 'brave',
          }),
        }),
      });
      expect(researchSearchCapture).not.toHaveBeenCalled();
      const approvalId = (requested.body as { approval: { id: string } }).approval.id;

      const narrowerRequest = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        maxResults: 1,
      });
      expect(narrowerRequest.status).toBe(202);
      expect((narrowerRequest.body as { approval: { id: string } }).approval.id).not.toBe(approvalId);

      const pendingAttempt = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        approvalId,
      });
      expect(pendingAttempt.status).toBe(409);
      expect(researchSearchCapture).not.toHaveBeenCalled();

      const mismatch = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        approvalId: 'research-search:wrong',
      });
      expect(mismatch.status).toBe(403);
      expect(researchSearchCapture).not.toHaveBeenCalled();

      const decision = await post(port, `/api/approvals/${approvalId}/decision`, { decision: 'approve' });
      expect(decision.status).toBe(200);

      const captured = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        approvalId,
      });
      expect(captured.status).toBe(201);
      expect((captured.body as { artifact: { uri?: string } }).artifact.uri).toBeUndefined();
      expect(captured.body).toMatchObject({
        status: 'captured',
        artifact: expect.objectContaining({ id: 'research-search-1.json' }),
        snapshot: expect.objectContaining({
          sourceMode: 'governed_search',
          sources: [expect.objectContaining({ url: 'https://example.com/search' })],
        }),
      });
      expect(researchSearchCapture).toHaveBeenCalledWith('run-1', {
        query: 'Pyrfor OpenClaw memory migration',
        maxResults: 5,
        provider: 'brave',
        approvalId,
      });

      const reused = await post(port, '/api/runs/run-1/research-search', {
        query: 'Pyrfor OpenClaw memory migration',
        approvalId,
      });
      expect(reused.status).toBe(409);
      const audit = await get(port, '/api/audit/events?limit=10');
      expect(JSON.stringify(audit.body)).not.toContain('Pyrfor OpenClaw memory migration');
      expect(JSON.stringify(audit.body)).toContain('queryHash');
      if (originalBraveKey === undefined) delete process.env['BRAVE_API_KEY'];
      else process.env['BRAVE_API_KEY'] = originalBraveKey;
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
    expect(body).toEqual([]);
  });

  it('GET /api/agents returns live runtime subagent summaries', async () => {
    (runtime as unknown as { listSubagents: ReturnType<typeof vi.fn> }).listSubagents = vi.fn().mockReturnValue([
      {
        id: 'sub-1',
        name: 'Research OpenClaw memory migration',
        status: 'running',
        startedAt: '2026-05-04T00:00:00.000Z',
      },
      {
        id: 'sub-2',
        name: 'Review connector manifest',
        status: 'completed',
        startedAt: '2026-05-04T00:01:00.000Z',
      },
    ]);

    const { status, body } = await get(port, '/api/agents');

    expect(status).toBe(200);
    expect(body).toEqual([
      {
        id: 'sub-1',
        name: 'Research OpenClaw memory migration',
        status: 'running',
        startedAt: '2026-05-04T00:00:00.000Z',
      },
      {
        id: 'sub-2',
        name: 'Review connector manifest',
        status: 'completed',
        startedAt: '2026-05-04T00:01:00.000Z',
      },
    ]);
  });

  // ── Memory ─────────────────────────────────────────────────────────────

  it('GET /api/memory → 200 JSON with lines and files arrays', async () => {
    const { status, body } = await get(port, '/api/memory');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(Array.isArray(d['lines'])).toBe(true);
    expect(Array.isArray(d['files'])).toBe(true);
    expect(d['lines']).toEqual(['pyrfor memory line']);
    expect(d).toHaveProperty('workspaceFiles');
    expect(d).toHaveProperty('daily');
  });

  it('GET /api/memory/continuity → returns read-only continuity doctor without local artifact URIs', async () => {
    const { status, body } = await get(port, '/api/memory/continuity?projectId=project-1');
    expect(status).toBe(200);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/tmp/daily-rollup-1.json');
    expect(serialized).not.toContain('/tmp/project-rollup-1.json');
    expect(serialized).not.toContain('/tmp/openclaw-report-1.json');
    expect(serialized).not.toContain('/tmp/pyrfor-test-workspace');
    expect(body).toMatchObject({
      workspaceId: 'current-workspace',
      projectId: 'project-1',
      workspaceFiles: {
        present: 1,
        total: 2,
        missing: ['SOUL.md'],
      },
      latestDailyRollup: {
        status: 'ok',
        date: '2026-01-01',
        artifact: { id: 'daily-rollup-1.json', sha256: 'sha-daily-rollup' },
      },
      latestProjectRollup: {
        status: 'ok',
        projectId: 'project-1',
        artifact: { id: 'project-rollup-1.json', sha256: 'sha-project-rollup' },
      },
      latestOpenClawReport: {
        status: 'ok',
        artifact: { id: 'openclaw-report-1.json', sha256: 'sha-openclaw-report' },
        counts: { importable: 1 },
      },
      warnings: ['memory_files_missing'],
    });
    expect(runtime.getMemoryContinuityStatus).toHaveBeenCalledWith({ projectId: 'project-1' });
  });

  it('GET /api/memory/continuity rejects client-controlled scope overrides', async () => {
    const { status, body } = await get(port, '/api/memory/continuity?workspaceId=/tmp/other');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('GET /api/memory/search → 200 JSON with durable memory hits', async () => {
    const { status, body } = await get(port, '/api/memory/search?q=delivery&projectId=project-1&limit=5');
    expect(status).toBe(200);
    const d = body as { workspaceId?: string; projectId?: string; results?: Array<Record<string, unknown>> };
    expect(d.workspaceId).toBe('current-workspace');
    expect(d.projectId).toBe('project-1');
    expect(d.results?.[0]).toMatchObject({
      id: 'memory-1',
      source: 'durable',
      projectMemoryCategory: 'decision',
    });
    expect(d.results?.[0]?.['workspaceId']).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('/tmp/pyrfor-test-workspace');
  });

  it('GET /api/memory/search without q → 400', async () => {
    const { status, body } = await get(port, '/api/memory/search');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_query');
  });

  it('GET /api/memory/search rejects client-controlled scope overrides', async () => {
    const { status, body } = await get(port, '/api/memory/search?q=delivery&workspaceId=/tmp/other');
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('POST /api/memory/corrections → creates durable operator correction', async () => {
    const { status, body } = await post(port, '/api/memory/corrections', {
      content: 'corrected fact content',
      summary: 'corrected fact',
      projectId: 'project-1',
    });
    expect(status).toBe(201);
    const d = body as { memory?: Record<string, unknown> };
    expect(d.memory).toMatchObject({
      id: 'memory-correction-1',
      source: 'durable',
      scopeVisibility: 'project',
    });
  });

  it('POST /api/memory/corrections rejects empty content', async () => {
    const { status, body } = await post(port, '/api/memory/corrections', { content: ' ' });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_content');
  });

  it('POST /api/memory/corrections rejects client-controlled scope overrides', async () => {
    const { status, body } = await post(port, '/api/memory/corrections', {
      content: 'corrected fact',
      workspaceId: '/tmp/other',
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('POST /api/memory/openclaw-import-report → creates dry-run report', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-import-report', {
      includePersonality: true,
      includeMemories: false,
    });
    expect(status).toBe(201);
    const d = body as {
      artifact?: { id?: string; sha256?: string; uri?: string; meta?: Record<string, unknown> };
      report?: { workspaceId?: string; sourceRoot?: string; counts?: { importable?: number } };
    };
    expect(d.artifact?.id).toBe('openclaw-report-1.json');
    expect(d.artifact?.sha256).toBe('sha-openclaw-report');
    expect(d.artifact?.uri).toBeUndefined();
    expect(d.artifact?.meta?.['workspaceId']).toBeUndefined();
    expect(d.report?.workspaceId).toBe('current-workspace');
    expect(d.report?.sourceRoot).toBe('openclaw-source');
    expect(d.report?.counts?.importable).toBe(1);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/tmp/openclaw-workspace');
    expect(serialized).not.toContain('/tmp/pyrfor-test-workspace');
    expect(serialized).not.toContain('/tmp/openclaw-report-1.json');
    expect(serialized).not.toContain('file://');
  });

  it('GET /api/memory/openclaw-import-report → returns latest dry-run report', async () => {
    const { status, body } = await get(port, '/api/memory/openclaw-import-report');
    expect(status).toBe(200);
    const d = body as {
      artifact?: { id?: string; uri?: string; meta?: Record<string, unknown> };
      report?: { workspaceId?: string; sourceRoot?: string };
    };
    expect(d.artifact?.id).toBe('openclaw-report-1.json');
    expect(d.artifact?.uri).toBeUndefined();
    expect(d.artifact?.meta?.['workspaceId']).toBeUndefined();
    expect(d.report?.workspaceId).toBe('current-workspace');
    expect(d.report?.sourceRoot).toBe('openclaw-source');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/tmp/openclaw-workspace');
    expect(serialized).not.toContain('/tmp/pyrfor-test-workspace');
    expect(serialized).not.toContain('/tmp/openclaw-report-1.json');
    expect(serialized).not.toContain('file://');
    expect(runtime.getLatestOpenClawMigrationReport).toHaveBeenCalledWith({});
  });

  it('GET /api/memory/openclaw-import-report scopes latest report by project id', async () => {
    const { status } = await get(port, '/api/memory/openclaw-import-report?projectId=project-a');
    expect(status).toBe(200);
    expect(runtime.getLatestOpenClawMigrationReport).toHaveBeenCalledWith({ projectId: 'project-a' });
  });

  it('POST /api/memory/openclaw-import → imports hash-bound report', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-import', {
      reportArtifactId: 'openclaw-report-1.json',
      expectedReportSha256: 'sha-openclaw-report',
    });
    expect(status).toBe(201);
    const d = body as {
      status?: string;
      result?: { imported?: number; memoryIds?: string[]; artifact?: { id?: string; sha256?: string; uri?: string; meta?: Record<string, unknown> } };
    };
    expect(d.status).toBe('imported');
    expect(d.result?.imported).toBe(1);
    expect(d.result?.memoryIds).toEqual(['memory-import-1']);
    expect(d.result?.artifact?.id).toBe('openclaw-result-1.json');
    expect(d.result?.artifact?.sha256).toBe('sha-openclaw-result');
    expect(d.result?.artifact?.uri).toBeUndefined();
    expect(d.result?.artifact?.meta?.['workspaceId']).toBeUndefined();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/tmp/openclaw-result-1.json');
    expect(serialized).not.toContain('/tmp/pyrfor-test-workspace');
  });

  it('POST /api/memory/openclaw-import forwards project scope for project reports', async () => {
    const { status } = await post(port, '/api/memory/openclaw-import', {
      reportArtifactId: 'openclaw-report-1.json',
      expectedReportSha256: 'sha-openclaw-report',
      projectId: 'project-a',
    });
    expect(status).toBe(201);
    expect(runtime.importOpenClawMigration).toHaveBeenCalledWith({
      reportArtifactId: 'openclaw-report-1.json',
      expectedReportSha256: 'sha-openclaw-report',
      projectId: 'project-a',
    });
  });

  it('POST /api/memory/openclaw-import rejects bad report reference', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-import', {
      reportArtifactId: 'openclaw-report-1.json',
    });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_report_reference');
  });

  it('POST /api/memory/openclaw-import-report rejects client scope overrides', async () => {
    const { status, body } = await post(port, '/api/memory/openclaw-import-report', { workspaceId: '/tmp/other' });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('GET /api/sessions → 200 JSON with workspace-scoped session summaries', async () => {
    const { status, body } = await get(port, '/api/sessions?limit=5');
    expect(status).toBe(200);
    const d = body as Record<string, unknown>;
    expect(d['workspaceId']).toBe('/tmp/pyrfor-test-workspace');
    expect(d['limit']).toBe(5);
    expect(Array.isArray(d['sessions'])).toBe(true);
    expect((d['sessions'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: 'sess-1',
      title: 'web:chat-1',
      messageCount: 2,
    });
  });

  it('GET /api/sessions/:id → 200 JSON with messages', async () => {
    const { status, body } = await get(port, '/api/sessions/sess-1');
    expect(status).toBe(200);
    const d = body as { session?: { id?: string; messages?: unknown[] } };
    expect(d.session?.id).toBe('sess-1');
    expect(d.session?.messages?.length).toBe(2);
  });

  it('GET /api/sessions/:id/timeline → 200 JSON with ordered message events', async () => {
    const { status, body } = await get(port, '/api/sessions/sess-1/timeline');
    expect(status).toBe(200);
    const d = body as { sessionId?: string; events?: Array<Record<string, unknown>> };
    expect(d.sessionId).toBe('sess-1');
    expect(d.events?.map((event) => event['content'])).toEqual(['remember this', 'remembered']);
  });

  it('GET /api/sessions/:id → 404 for missing session', async () => {
    const { status, body } = await get(port, '/api/sessions/missing');
    expect(status).toBe(404);
    expect((body as Record<string, unknown>)['error']).toBe('session_not_found');
  });

  it('POST /api/memory/rollup → promotes a daily memory rollup', async () => {
    const { status, body } = await post(port, '/api/memory/rollup', { date: '2026-01-01' });
    expect(status).toBe(201);
    const d = body as { rollup?: { date?: string; memoryId?: string; sessionCount?: number } };
    expect(d.rollup?.date).toBe('2026-01-01');
    expect(d.rollup?.memoryId).toBe('memory-1');
    expect(d.rollup?.sessionCount).toBe(1);
  });

  it('POST /api/memory/rollup invalid date → 400', async () => {
    const { status, body } = await post(port, '/api/memory/rollup', { date: 'not-a-date' });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('invalid_date');
  });

  it('POST /api/memory/rollup rejects client-controlled memory scope', async () => {
    const { status, body } = await post(port, '/api/memory/rollup', { agentId: 'other-agent' });
    expect(status).toBe(400);
    expect((body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');
  });

  it('POST /api/memory/project-rollup → promotes project continuity memories', async () => {
    const { status, body } = await post(port, '/api/memory/project-rollup', {
      projectId: 'project-1',
      sessionLimit: 200,
    });
    expect(status).toBe(201);
    const d = body as { rollup?: { projectId?: string; artifact?: { uri?: string }; memories?: Array<{ category?: string; memoryId?: string }> } };
    expect(d.rollup?.projectId).toBe('project-1');
    expect(d.rollup?.artifact?.uri).toBeUndefined();
    expect(d.rollup?.memories).toEqual([
      expect.objectContaining({ category: 'decision', memoryId: 'project-memory-1' }),
    ]);
  });

  it('POST /api/memory/project-rollup rejects invalid input and client-controlled scope', async () => {
    const missingProject = await post(port, '/api/memory/project-rollup', {});
    expect(missingProject.status).toBe(400);
    expect((missingProject.body as Record<string, unknown>)['error']).toBe('project_id_required');

    const scopeOverride = await post(port, '/api/memory/project-rollup', { projectId: 'project-1', workspaceId: '/tmp/other' });
    expect(scopeOverride.status).toBe(400);
    expect((scopeOverride.body as Record<string, unknown>)['error']).toBe('scope_override_not_allowed');

    const invalidLimit = await post(port, '/api/memory/project-rollup', { projectId: 'project-1', sessionLimit: 501 });
    expect(invalidLimit.status).toBe(400);
    expect((invalidLimit.body as Record<string, unknown>)['error']).toBe('invalid_session_limit');
  });

  it('GET /api/runs/:runId/context-pack returns public context pack artifact', async () => {
    const { status, body } = await get(port, '/api/runs/run-1/context-pack');
    expect(status).toBe(200);
    expect((body as { artifact: { uri?: string } }).artifact.uri).toBeUndefined();
    expect(body).toMatchObject({
      artifact: expect.objectContaining({ id: 'context-pack-1.json', kind: 'context_pack' }),
      pack: expect.objectContaining({
        schemaVersion: 'context_pack.v1',
        packId: 'ctx-run-1',
        projectId: 'project-1',
      }),
    });
    const pack = (body as { pack: { task: { description: string }; sections: Array<{ content: string }> } }).pack;
    expect(pack.task.description.length).toBeLessThanOrEqual(600);
    expect(pack.sections[0].content.length).toBeLessThanOrEqual(600);
  });

  it('GET /api/runs/:runId/context-pack returns 404 when absent', async () => {
    (runtime as unknown as { getRunContextPack: ReturnType<typeof vi.fn> }).getRunContextPack.mockResolvedValueOnce(null);
    const { status, body } = await get(port, '/api/runs/run-missing/context-pack');
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: 'context_pack_not_found' });
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
