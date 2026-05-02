// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_FACTORY_TEMPLATE_IDS } from './product-factory';

const here = dirname(fileURLToPath(import.meta.url));
const openapi = readFileSync(join(here, 'openapi.yaml'), 'utf-8');

describe('runtime OpenAPI contract coverage', () => {
  it('documents the Engine/App gateway seam routes', () => {
    const documentedPaths = [
      '/api/runtime/credentials',
      '/api/workspace',
      '/api/workspace/open',
      '/api/fs/list',
      '/api/fs/read',
      '/api/fs/write',
      '/api/fs/search',
      '/api/chat',
      '/api/chat/stream',
      '/api/exec',
      '/api/pty/spawn',
      '/api/pty/list',
      '/api/git/status',
      '/api/settings/active-model',
      '/api/approvals/pending',
      '/api/approvals/{id}/decision',
      '/api/audit/events',
      '/api/product-factory/templates',
      '/api/product-factory/plan',
      '/api/ochag/privacy',
      '/api/ochag/reminders/preview',
      '/api/ochag/reminders',
      '/api/ceoclaw/briefs/preview',
      '/api/ceoclaw/briefs',
      '/api/runs',
      '/api/runs/{runId}',
      '/api/runs/{runId}/events',
      '/api/runs/{runId}/dag',
      '/api/runs/{runId}/frames',
      '/api/runs/{runId}/delivery-evidence',
      '/api/runs/{runId}/github-delivery-plan',
      '/api/runs/{runId}/github-delivery-apply',
      '/api/runs/{runId}/control',
      '/api/overlays',
      '/api/overlays/{domainId}',
    ];

    for (const path of documentedPaths) {
      expect(openapi).toContain(`  ${path}:`);
    }
  });

  it('pins orchestration/product operation ids and template enum contract', () => {
    const operationIds = [
      'listProductFactoryTemplates',
      'previewProductFactoryPlan',
      'createProductFactoryRun',
      'getOchagPrivacy',
      'previewOchagReminder',
      'createOchagReminderRun',
      'previewCeoclawBrief',
      'createCeoclawBriefRun',
      'listRuns',
      'getRun',
      'listRunEvents',
      'listRunDag',
      'listRunFrames',
      'getRunDeliveryEvidence',
      'captureRunDeliveryEvidence',
      'getRunGithubDeliveryPlan',
      'createRunGithubDeliveryPlan',
      'getRunGithubDeliveryApply',
      'requestRunGithubDeliveryApply',
      'controlRun',
      'listOverlays',
      'getOverlay',
    ];

    for (const operationId of operationIds) {
      expect(openapi).toContain(`operationId: ${operationId}`);
    }

    expect(openapi).toContain(`enum: [${PRODUCT_FACTORY_TEMPLATE_IDS.join(', ')}]`);
    expect(openapi).toContain('enum: [execute, replay, continue, abort]');
    expect(openapi).toContain('pyrfor.delivery_evidence.v1');
    expect(openapi).toContain('pyrfor.github_delivery_plan.v1');
    expect(openapi).toContain('pyrfor.github_delivery_apply.v1');
  });
});
