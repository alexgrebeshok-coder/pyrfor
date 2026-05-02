// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
      '/api/runs',
      '/api/runs/{runId}',
      '/api/runs/{runId}/events',
      '/api/runs/{runId}/dag',
      '/api/overlays',
      '/api/overlays/{domainId}',
    ];

    for (const path of documentedPaths) {
      expect(openapi).toContain(`  ${path}:`);
    }
  });
});
