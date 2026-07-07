// @vitest-environment node
/**
 * Block C + E1: gateway stability stress, blocks/load, KS reconciliation HTTP E2E.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRuntimeGateway } from '../gateway';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';
import type { BlockManifest } from '../block-manifest';

process.env.LOG_LEVEL = 'silent';

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../../fixtures/reconciliation-mvp',
);

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

async function startGateway() {
  const gw = createRuntimeGateway({
    config: makeConfig(),
    runtime: makeRuntime(),
    portOverride: 0,
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

async function post(baseUrl: string, route: string, payload: unknown, init?: RequestInit) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    ...init,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

function writePackage(root: string, scripts: Record<string, string>): void {
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }, null, 2), 'utf8');
}

function writeManifest(root: string, body: BlockManifest): void {
  writeFileSync(path.join(root, 'block.json'), JSON.stringify(body, null, 2), 'utf8');
}

function manifest(overrides: Partial<BlockManifest> = {}): BlockManifest {
  return {
    pyrfor_manifest_version: '1',
    id: 'com.example.translate-block',
    name: 'Translate Block',
    version: '0.1.0',
    description: 'Stress test block',
    author: 'Example',
    license: 'MIT',
    runtime: {
      mode: 'local-worker',
      engine_version_range: '>=1.2.0 <2.0.0',
      sandbox: 'process-isolated',
    },
    entrypoints: { main: 'dist/index.js' },
    scripts: { test: 'vitest run' },
    capabilities: [{ token: 'local-llm:invoke', reason: 'Translate text locally' }],
    contracts: { consumes: [], produces: [{ ref: 'ApprovalEvidence@1' }] },
    optimizer_policy: {
      editable: true,
      editable_fields: ['prompts'],
      never_editable: ['id', 'version', 'capabilities', 'security', 'signing'],
      requires_human_approval: ['runtime', 'entrypoints', 'scripts'],
    },
    security: {
      sandbox: 'process-isolated',
      allow_fs_read: [],
      allow_fs_write: [],
      allow_network: false,
      allow_child_process: false,
      secrets_access: [],
      max_memory_mb: 256,
      max_cpu_pct: 30,
    },
    certification: { state: 'dev' },
    ...overrides,
  };
}

describe('gateway stress — Block C1', () => {
  let handle: Awaited<ReturnType<typeof startGateway>> | null = null;

  beforeEach(async () => {
    handle = await startGateway();
  });

  afterEach(async () => {
    await handle?.stop();
    handle = null;
  });

  it('serves GET /health with 200', async () => {
    const { status } = await get(handle!.baseUrl, '/health');
    expect(status).toBe(200);
  });

  it('serves 100 sequential GET /ping without error', async () => {
    for (let i = 0; i < 100; i++) {
      const { status } = await get(handle!.baseUrl, '/ping');
      expect(status).toBe(200);
    }
  });

  it('serves 10 parallel GET /ping successfully', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => get(handle!.baseUrl, '/ping')),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
  });

  it('rejects requests after stop and recovers after restart', async () => {
    const port = handle!.gw.port;
    await handle!.gw.stop();

    await expect(fetch(`http://127.0.0.1:${port}/ping`)).rejects.toThrow();

    await handle!.gw.start();
    const { status } = await get(`http://127.0.0.1:${handle!.gw.port}`, '/ping');
    expect(status).toBe(200);
  });

  it('returns 400 invalid_json for malformed JSON POST', async () => {
    const { status, body } = await post(handle!.baseUrl, '/api/blocks/load', '{invalid');
    expect(status).toBe(400);
    expect(body).toEqual({ error: 'invalid_json' });
  });

  it('returns 404 for unknown routes', async () => {
    const { status } = await get(handle!.baseUrl, '/api/nonexistent');
    expect(status).toBe(404);
  });

  it('client abort does not hang the gateway', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetch(`${handle!.baseUrl}/ping`, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe('gateway stress — Block C2 blocks/load', () => {
  let handle: Awaited<ReturnType<typeof startGateway>> | null = null;
  let blockDir = '';

  beforeEach(async () => {
    blockDir = mkdtempSync(path.join(tmpdir(), 'pyrfor-gw-block-stress-'));
    handle = await startGateway();
  });

  afterEach(async () => {
    await handle?.stop();
    if (blockDir) rmSync(blockDir, { recursive: true, force: true });
    handle = null;
    blockDir = '';
  });

  it('POST /api/blocks/load returns 200 for valid manifest', async () => {
    writePackage(blockDir, { test: 'vitest run' });
    writeManifest(blockDir, manifest());
    const { status, body } = await post(handle!.baseUrl, '/api/blocks/load', { path: blockDir });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true });
  });

  it('POST /api/blocks/load returns 400 for invalid manifest', async () => {
    writePackage(blockDir, { test: 'vitest run' });
    writeManifest(blockDir, manifest({
      capabilities: [{ token: 'fs:*', reason: 'too broad' }],
    }));
    const { status, body } = await post(handle!.baseUrl, '/api/blocks/load', { path: blockDir });
    expect(status).toBe(400);
    expect(body).toMatchObject({ ok: false });
  });
});

describe('gateway stress — Block C2/E1 KS reconciliation HTTP', () => {
  let handle: Awaited<ReturnType<typeof startGateway>> | null = null;

  beforeEach(async () => {
    handle = await startGateway();
  });

  afterEach(async () => {
    await handle?.stop();
    handle = null;
  });

  it('POST /api/ks/reconciliation/review-pack returns five findings D-01..D-05', async () => {
    const { status, body } = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      runId: 'run-http-ks-1',
      fixturePath: FIXTURE_DIR,
    });
    const expected = JSON.parse(
      readFileSync(path.join(FIXTURE_DIR, 'expected_findings.json'), 'utf8'),
    ) as { expectedFindings: Array<{ id: string; finding_type: string }> };

    expect(status).toBe(200);
    expect(body.findings).toHaveLength(5);
    expect(body.findings.map((f: { ground_truth_id: string }) => f.ground_truth_id)).toEqual(
      expected.expectedFindings.map((e) => e.id),
    );
    for (const exp of expected.expectedFindings) {
      const actual = body.findings.find((f: { ground_truth_id: string }) => f.ground_truth_id === exp.id);
      expect(actual?.finding_type).toBe(exp.finding_type);
    }
  });

  it('POST /api/ks/reconciliation/finalize after accepting all five findings', async () => {
    const runId = 'run-http-ks-finalize';
    const approvalId = `ks-reconciliation-review-${runId}`;
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      runId,
      fixturePath: FIXTURE_DIR,
    });
    const reviews = (pack.body.findings as Array<{ finding_id: string }>).map((finding, index) => ({
      findingId: finding.finding_id,
      action: 'accept' as const,
      reviewerId: `operator-${index + 1}`,
      reviewedAt: `2026-05-15T01:0${index}:00.000Z`,
      reviewerComment: 'accepted in stress test',
    }));

    expect(pack.body.metrics.recall).toBe(1);
    expect(pack.body.metrics.falsePositives).toBe(0);

    const { status, body } = await post(handle!.baseUrl, '/api/ks/reconciliation/finalize', {
      runId,
      approvalId,
      reviews,
    });

    expect(status).toBe(200);
    expect(body.approval).toMatchObject({ approvalId, decision: 'approve' });
    expect(body.summary.findingsReviewed).toBe(5);
    expect(body.findings.every((f: { status: string }) => f.status === 'ACCEPTED')).toBe(true);
  });

  it('full KS reconciliation E2E via HTTP', async () => {
    const runId = 'run-http-ks-e2e';
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      runId,
      fixturePath: FIXTURE_DIR,
    });
    expect(review.status).toBe(200);

    const findingIds = (review.body.findings as Array<{ finding_id: string; ground_truth_id: string }>)
      .map((f) => ({ findingId: f.finding_id, groundTruth: f.ground_truth_id }));
    expect(findingIds.map((f) => f.groundTruth)).toEqual(['D-01', 'D-02', 'D-03', 'D-04', 'D-05']);

    const reviews = findingIds.map((f, i) => ({
      findingId: f.findingId,
      action: 'accept' as const,
      reviewerId: `e2e-operator-${i + 1}`,
      reviewedAt: new Date().toISOString(),
    }));

    const finalize = await post(handle!.baseUrl, '/api/ks/reconciliation/finalize', {
      runId,
      approvalId: `ks-reconciliation-review-${runId}`,
      reviews,
    });

    expect(review.body.metrics).toMatchObject({
      recall: 1,
      falsePositives: 0,
      producedFindings: 5,
    });
    expect(finalize.status).toBe(200);
    expect(finalize.body.summary.findingsReviewed).toBe(5);
    expect(finalize.body.findings.every((f: { status: string }) => f.status === 'ACCEPTED')).toBe(true);
  });
});

describe('gateway stress — integration v3 MCP, telemetry, KS review', () => {
  let handle: Awaited<ReturnType<typeof startGateway>> | null = null;

  beforeEach(async () => {
    handle = await startGateway();
  });

  afterEach(async () => {
    await handle?.stop();
    handle = null;
  });

  it('GET /api/mcp/status returns 200 with servers array', async () => {
    const { status, body } = await get(handle!.baseUrl, '/api/mcp/status');
    expect(status).toBe(200);
    expect(Array.isArray(body.servers)).toBe(true);
  });

  it('POST /api/mcp/servers/:name/health-check returns name and healthy', async () => {
    const { status, body } = await post(handle!.baseUrl, '/api/mcp/servers/demo/health-check');
    expect(status).toBe(200);
    expect(body).toMatchObject({ name: 'demo', healthy: expect.any(Boolean) });
  });

  it('GET /api/telemetry/spans honors limit query', async () => {
    const { status, body } = await get(handle!.baseUrl, '/api/telemetry/spans?limit=5');
    expect(status).toBe(200);
    expect(body.limit).toBe(5);
    expect(Array.isArray(body.spans)).toBe(true);
  });

  it('POST /api/ks/reconciliation/review accepts defer action', async () => {
    const runId = 'run-v3-defer';
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId, fixturePath: FIXTURE_DIR });
    const findingId = pack.body.findings[0].finding_id as string;
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId,
      action: 'defer',
      reviewerId: 'operator-defer',
      reviewerComment: 'waiting on vendor',
    });
    expect(review.status).toBe(200);
    expect(review.body.finding.status).toBe('DEFERRED');
  });

  it('POST /api/ks/reconciliation/review accepts escalate action', async () => {
    const runId = 'run-v3-escalate';
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId, fixturePath: FIXTURE_DIR });
    const findingId = pack.body.findings[1].finding_id as string;
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId,
      action: 'escalate',
      reviewerId: 'operator-escalate',
      reviewerComment: 'needs manager',
    });
    expect(review.status).toBe(200);
    expect(review.body.finding.status).toBe('ESCALATED');
  });

  it('POST /api/ks/reconciliation/review accepts reject with comment', async () => {
    const runId = 'run-v3-reject';
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId, fixturePath: FIXTURE_DIR });
    const findingId = pack.body.findings[2].finding_id as string;
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId,
      action: 'reject',
      reviewerId: 'operator-reject',
      reviewerComment: 'false positive',
    });
    expect(review.status).toBe(200);
    expect(review.body.finding.status).toBe('REJECTED');
  });

  it('POST /api/ks/reconciliation/review returns 400 when required fields missing', async () => {
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', { runId: 'x' });
    expect(review.status).toBe(400);
  });

  it('POST /api/ks/reconciliation/finalize still accepts explicit reviews[]', async () => {
    const runId = 'run-v3-finalize-explicit';
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId, fixturePath: FIXTURE_DIR });
    const reviews = (pack.body.findings as Array<{ finding_id: string }>).map((finding, index) => ({
      findingId: finding.finding_id,
      action: 'accept' as const,
      reviewerId: `explicit-${index + 1}`,
      reviewerComment: 'explicit finalize path',
    }));
    const finalize = await post(handle!.baseUrl, '/api/ks/reconciliation/finalize', {
      runId,
      approvalId: `ks-reconciliation-review-${runId}`,
      reviews,
    });
    expect(finalize.status).toBe(200);
    expect(finalize.body.summary.findingsAccepted).toBe(5);
  });

  it.each(['accept', 'defer', 'escalate'])('KS review action %s updates reviewHistory length', async (action) => {
    const runId = `run-v3-action-${action}`;
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId, fixturePath: FIXTURE_DIR });
    const findingId = pack.body.findings[0].finding_id as string;
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId,
      action,
      reviewerId: `operator-${action}`,
      reviewerComment: action === 'reject' ? 'must not happen' : `${action} comment`,
    });
    expect(review.status).toBe(200);
    expect(review.body.reviewPack.reviewHistory).toHaveLength(1);
  });

  it('POST /api/mcp/servers/:name/restart returns 404 for unknown server via default stub', async () => {
    const { status } = await post(handle!.baseUrl, '/api/mcp/servers/unknown-server/restart');
    expect(status).toBe(404);
  });

  it('GET /api/telemetry/spans default limit is 50', async () => {
    const { body } = await get(handle!.baseUrl, '/api/telemetry/spans');
    expect(body.limit).toBe(50);
  });

  it('POST /api/ks/reconciliation/review-pack without runId generates one', async () => {
    const { status, body } = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      fixturePath: FIXTURE_DIR,
    });
    expect(status).toBe(200);
    expect(typeof body.runId).toBe('string');
    expect(body.runId.length).toBeGreaterThan(0);
  });

  it('POST /api/ks/reconciliation/review returns reviewPack schema version', async () => {
    const runId = 'run-v3-schema';
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId, fixturePath: FIXTURE_DIR });
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId: pack.body.findings[0].finding_id,
      action: 'accept',
      reviewerId: 'operator-schema',
    });
    expect(review.body.reviewPack.schemaVersion).toBe('pyrfor.ks_reconciliation_review_pack.v1');
  });

  it('POST /api/ks/reconciliation/finalize report includes schema version', async () => {
    const runId = 'run-v3-report-schema';
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId, fixturePath: FIXTURE_DIR });
    for (const finding of pack.body.findings as Array<{ finding_id: string }>) {
      await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
        runId,
        findingId: finding.finding_id,
        action: 'accept',
        reviewerId: 'operator-report',
      });
    }
    const finalize = await post(handle!.baseUrl, '/api/ks/reconciliation/finalize', {
      runId,
      approvalId: `ks-reconciliation-review-${runId}`,
    });
    expect(finalize.body.schemaVersion).toBe('pyrfor.ks_reconciliation_report.v1');
  });
});
