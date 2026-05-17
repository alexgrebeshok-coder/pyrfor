// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeGateway } from '../gateway';
import type { RuntimeConfig } from '../config';
import type { PyrforRuntime } from '../index';

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

async function post(baseUrl: string, route: string, payload: unknown) {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe('gateway KS per-finding review', () => {
  let handle: Awaited<ReturnType<typeof startGateway>> | null = null;

  beforeEach(async () => {
    handle = await startGateway();
  });

  afterEach(async () => {
    await handle?.stop();
    handle = null;
  });

  it('accepts a single finding and returns ACCEPTED status', async () => {
    const runId = 'run-ks-review-accept';
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      runId,
      fixturePath: FIXTURE_DIR,
    });
    const findingId = pack.body.findings[0].finding_id as string;

    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId,
      action: 'accept',
      reviewerId: 'operator-1',
      reviewerComment: 'looks valid',
    });

    expect(review.status).toBe(200);
    expect(review.body.finding.status).toBe('ACCEPTED');
    expect(review.body.reviewPack.reviewHistory).toHaveLength(1);
  });

  it('rejects without comment returns 400', async () => {
    const runId = 'run-ks-review-reject-400';
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      runId,
      fixturePath: FIXTURE_DIR,
    });
    const findingId = pack.body.findings[0].finding_id as string;

    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId,
      action: 'reject',
      reviewerId: 'operator-1',
    });

    expect(review.status).toBe(400);
    expect(review.body.error).toContain('reviewerComment');
  });

  it('sequential reviews persist in cached review-pack', async () => {
    const runId = 'run-ks-review-seq';
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      runId,
      fixturePath: FIXTURE_DIR,
    });
    const findingIds = (pack.body.findings as Array<{ finding_id: string }>).slice(0, 2).map((f) => f.finding_id);

    for (const [index, findingId] of findingIds.entries()) {
      await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
        runId,
        findingId,
        action: 'accept',
        reviewerId: `operator-${index + 1}`,
        reviewerComment: `accepted ${findingId}`,
      });
    }

    const cached = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId });
    expect(cached.body.reviewHistory).toHaveLength(2);
    expect(cached.body.findings.filter((f: { status: string }) => f.status === 'ACCEPTED')).toHaveLength(2);
  });

  it('review-pack returns cached pack without rebuilding', async () => {
    const runId = 'run-ks-review-cache';
    const initial = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      runId,
      fixturePath: FIXTURE_DIR,
    });
    const findingId = initial.body.findings[0].finding_id as string;
    await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId,
      action: 'defer',
      reviewerId: 'operator-cache',
      reviewerComment: 'need more evidence',
    });

    const cached = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId });
    expect(cached.body.reviewHistory).toHaveLength(1);
    expect(cached.body.findings[0].status).toBe('DEFERRED');
  });

  it('finalize uses accumulated cached reviews when reviews[] omitted', async () => {
    const runId = 'run-ks-review-finalize-cache';
    const approvalId = `ks-reconciliation-review-${runId}`;
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      runId,
      fixturePath: FIXTURE_DIR,
    });
    for (const finding of pack.body.findings as Array<{ finding_id: string }>) {
      await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
        runId,
        findingId: finding.finding_id,
        action: 'accept',
        reviewerId: 'operator-finalize',
        reviewerComment: 'batch accepted',
      });
    }

    const finalize = await post(handle!.baseUrl, '/api/ks/reconciliation/finalize', {
      runId,
      approvalId,
    });

    expect(finalize.status).toBe(200);
    expect(finalize.body.summary.findingsReviewed).toBe(5);
    expect(finalize.body.findings.every((f: { status: string }) => f.status === 'ACCEPTED')).toBe(true);
  });

  it('returns 404 for unknown finding id', async () => {
    const runId = 'run-ks-review-missing-finding';
    await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId, fixturePath: FIXTURE_DIR });
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId: 'F-missing',
      action: 'accept',
      reviewerId: 'operator-1',
    });
    expect(review.status).toBe(404);
  });

  it.each([
    ['runId'],
    ['findingId'],
    ['action'],
    ['reviewerId'],
  ])('returns 400 when %s is missing', async (missingField) => {
    const payload: Record<string, string> = {
      runId: 'run-ks-missing-field',
      findingId: 'F-001',
      action: 'accept',
      reviewerId: 'operator-1',
    };
    delete payload[missingField];
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', payload);
    expect(review.status).toBe(400);
  });

  it.each([0, 1, 2, 3, 4])('accepts finding index %i via per-finding review', async (index) => {
    const runId = `run-ks-accept-index-${index}`;
    const pack = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', {
      runId,
      fixturePath: FIXTURE_DIR,
    });
    const findingId = pack.body.findings[index].finding_id as string;
    const review = await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId,
      action: 'accept',
      reviewerId: `operator-${index}`,
      reviewerComment: `accepted index ${index}`,
    });
    expect(review.status).toBe(200);
    expect(review.body.finding.status).toBe('ACCEPTED');
  });

  it('finalize returns 400 when approvalId is missing', async () => {
    const finalize = await post(handle!.baseUrl, '/api/ks/reconciliation/finalize', {
      runId: 'run-ks-no-approval',
    });
    expect(finalize.status).toBe(400);
  });

  it('finalize returns 400 when no reviews and no cached history', async () => {
    const finalize = await post(handle!.baseUrl, '/api/ks/reconciliation/finalize', {
      runId: 'run-ks-empty-finalize',
      approvalId: 'approval-empty',
      reviews: [],
    });
    expect(finalize.status).toBe(400);
  });

  it('review-pack without fixturePath still returns cached reviews after edits', async () => {
    const runId = 'run-ks-cache-no-fixture';
    await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId, fixturePath: FIXTURE_DIR });
    const findingId = 'F-001';
    await post(handle!.baseUrl, '/api/ks/reconciliation/review', {
      runId,
      findingId,
      action: 'accept',
      reviewerId: 'operator-cache-2',
    });
    const cached = await post(handle!.baseUrl, '/api/ks/reconciliation/review-pack', { runId });
    expect(cached.body.findings.find((f: { finding_id: string }) => f.finding_id === findingId)?.status).toBe('ACCEPTED');
  });
});
