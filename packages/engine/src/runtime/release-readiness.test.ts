import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { RELEASE_SECRET_ENV_VARS, RELEASE_SIDECAR_ARTIFACTS, getReleaseReadiness, resolveReleaseReadinessRoot } from './release-readiness';

describe('Release readiness', () => {
  it('reports missing signed release prerequisites without leaking env values or local paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'pyrfor-release-readiness-'));
    const snapshot = getReleaseReadiness({
      root,
      env: {
        APPLE_ID: 'person@example.test',
        TAURI_SIGNING_PRIVATE_KEY: 'super-secret-updater-key',
      },
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(snapshot).toMatchObject({
      checkedAt: '2026-05-05T00:00:00.000Z',
      statusSource: 'local-config',
      liveProbeSkipped: true,
      approvalRequired: true,
      status: 'unavailable',
      secrets: expect.arrayContaining([
        { name: 'APPLE_ID', configured: true },
        { name: 'TAURI_SIGNING_PRIVATE_KEY', configured: true },
        { name: 'APPLE_SIGNING_IDENTITY', configured: false },
      ]),
      artifacts: expect.arrayContaining([
        { name: 'pyrfor-daemon-aarch64-apple-darwin', present: false },
      ]),
    });
    expect(snapshot.reasons).toEqual(expect.arrayContaining([
      'Release secret env is missing: APPLE_SIGNING_IDENTITY.',
      'Release sidecar artifact is missing: pyrfor-daemon-aarch64-apple-darwin.',
      'Release contract failed: Tauri externalBin includes pyrfor-daemon.',
    ]));
    expect(JSON.stringify(snapshot)).not.toContain('super-secret-updater-key');
    expect(JSON.stringify(snapshot)).not.toContain('person@example.test');
    expect(JSON.stringify(snapshot)).not.toContain(root);
  });

  it('reports ready when release secrets, artifacts and local contracts are present', () => {
    const root = mkdtempSync(join(tmpdir(), 'pyrfor-release-readiness-'));
    createReleaseContractFixture(root);
    const env = Object.fromEntries(RELEASE_SECRET_ENV_VARS.map((name) => [name, `${name}-value`]));

    const snapshot = getReleaseReadiness({
      root,
      env,
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.reasons).toEqual(['Local release prerequisites are configured.']);
    expect(snapshot.secrets.every((secret) => secret.configured)).toBe(true);
    expect(snapshot.artifacts.every((artifact) => artifact.present)).toBe(true);
    expect(snapshot.contracts.every((contract) => contract.passed)).toBe(true);
  });

  it('resolves bundled resource roots from nested runtime files without relying on process cwd', () => {
    const appRoot = mkdtempSync(join(tmpdir(), 'pyrfor-release-bundle-'));
    const resourceRoot = join(appRoot, 'Contents', 'Resources');
    const runtimeFile = join(resourceRoot, '_app', 'dist', 'runtime', 'release-readiness.js');
    writeFile(appRoot, 'Contents/MacOS/pyrfor-daemon-aarch64-apple-darwin', '#!/bin/sh\nexec node _app/bin/pyrfor.cjs --daemon\n');
    writeFile(appRoot, 'Contents/Resources/_runtime/node', 'node');
    writeFile(appRoot, 'Contents/Resources/_app/bin/pyrfor.cjs', 'app');
    writeFile(appRoot, 'Contents/Resources/_app/dist/runtime/gateway.js', '/api/product-factory/templates /api/product-factory/plan /api/runs');
    writeFile(appRoot, 'Contents/Resources/_app/dist/runtime/cli.js', 'cli');
    writeFile(appRoot, 'Contents/Resources/_app/node_modules/server-only/index.js', 'server-only');
    writeFile(appRoot, 'Contents/Resources/_app/dist/runtime/release-readiness.js', 'runtime');
    const env = Object.fromEntries(RELEASE_SECRET_ENV_VARS.map((name) => [name, `${name}-value`]));

    const detectedRoot = resolveReleaseReadinessRoot(runtimeFile);
    const snapshot = getReleaseReadiness({
      root: detectedRoot,
      env,
      now: () => new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(detectedRoot).toBe(resourceRoot);
    expect(snapshot.artifacts).toEqual(expect.arrayContaining([
      { name: 'pyrfor-daemon-aarch64-apple-darwin', present: true },
      { name: '_runtime/node', present: true },
      { name: '_app/bin/pyrfor.cjs', present: true },
    ]));
    expect(snapshot.contracts.every((contract) => contract.passed)).toBe(true);
  });
});

function createReleaseContractFixture(root: string): void {
  writeFile(root, 'apps/pyrfor-ide/src-tauri/tauri.conf.json', JSON.stringify({
    bundle: {
      externalBin: ['binaries/pyrfor-daemon'],
      resources: { 'binaries/_runtime': '_runtime', 'binaries/_app': '_app' },
    },
    plugins: { updater: { active: true } },
  }));
  writeFile(root, 'apps/pyrfor-ide/src-tauri/src/sidecar.rs', 'PYRFOR_ALLOW_STANDALONE_ENGINE cfg!(debug_assertions)');
  writeFile(root, 'apps/pyrfor-ide/web/src/lib/apiFetch.ts', 'Pyrfor bundled sidecar port unavailable');
  writeFile(root, 'apps/pyrfor-ide/web/src/lib/api.ts', 'getProviderRoutingPreview /api/settings/provider-routing-preview');
  writeFile(root, 'packages/engine/src/runtime/gateway.ts', '/api/product-factory/templates /api/product-factory/plan /api/runs');
  writeFile(root, 'packages/engine/dist/runtime/gateway.js', '/api/product-factory/templates /api/product-factory/plan /api/runs');
  writeFile(root, 'apps/pyrfor-ide/src-tauri/binaries/pyrfor-daemon-aarch64-apple-darwin', '#!/bin/sh\nexec pyrfor --daemon\n');
  for (const artifact of RELEASE_SIDECAR_ARTIFACTS) {
    if (artifact === 'pyrfor-daemon-aarch64-apple-darwin') continue;
    writeFile(root, `apps/pyrfor-ide/src-tauri/binaries/${artifact}`, 'artifact');
  }
}

function writeFile(root: string, relativePath: string, content: string): void {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}
