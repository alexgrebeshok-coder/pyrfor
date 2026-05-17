// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureRuntimePermissionEngine, setSandboxProvider, setWorkspaceRoot } from './tools';
import { executeBlockMain } from './block-executor';
import type { BlockRegistryEntry } from './block-registry';
import type { BlockManifest } from './block-manifest';

describe('block-executor', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-block-exec-'));
    setWorkspaceRoot(dir);
    setSandboxProvider(null);
    configureRuntimePermissionEngine({
      profile: 'autonomous',
      overrides: { exec: 'auto_allow' },
    });
  });

  afterEach(() => {
    configureRuntimePermissionEngine(null);
    setSandboxProvider(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs manifest entrypoints.main in the block root', async () => {
    const mainPath = path.join(dir, 'main.js');
    writeFileSync(mainPath, 'console.log("block-ok");', 'utf8');
    const entry = sampleEntry(dir, mainPath);

    const result = await executeBlockMain(entry, { runId: 'run-block-exec' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.stdout).toContain('block-ok');
  });

  it('returns structured error when entrypoint is missing', async () => {
    const entry = sampleEntry(dir, path.join(dir, 'missing.js'));
    const result = await executeBlockMain(entry);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/entrypoint not found/i);
  });
});

function sampleEntry(rootDir: string, mainPath: string): BlockRegistryEntry {
  const manifest: BlockManifest = {
    pyrfor_manifest_version: '1',
    id: 'com.example.exec-block',
    name: 'Exec Block',
    version: '0.1.0',
    description: 'test',
    author: 'test',
    license: 'MIT',
    runtime: { mode: 'local-worker', engine_version_range: '>=1.0.0', sandbox: 'process-isolated' },
    entrypoints: { main: path.relative(rootDir, mainPath) },
    scripts: { test: 'node main.js' },
    capabilities: [],
    contracts: { consumes: [], produces: [] },
    optimizer_policy: { editable: false },
    security: {
      sandbox: 'process-isolated',
      allow_fs_read: [],
      allow_fs_write: [],
      allow_network: false,
      allow_child_process: false,
      secrets_access: [],
      max_memory_mb: 128,
      max_cpu_pct: 30,
    },
    certification: { state: 'dev' },
  };

  return {
    blockId: manifest.id,
    version: manifest.version,
    manifest,
    status: 'active',
    registeredAt: new Date().toISOString(),
    rootDir,
    manifestPath: path.join(rootDir, 'block.json'),
    dataDir: path.join(rootDir, 'data'),
  };
}
