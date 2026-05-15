import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from './artifact-model';
import { loadBlock, activateBlock, deactivateBlock } from './block-loader';
import type { BlockManifest } from './block-manifest';
import { BlockRegistry } from './block-registry';
import { EventLedger } from './event-ledger';
import { ToolRegistry } from './permission-engine';

describe('BlockLoader', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-block-loader-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads, validates, and registers a local block without executing scripts', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest());
    const registry = new BlockRegistry();
    const toolRegistry = new ToolRegistry();

    const result = await loadBlock(dir, {
      registry,
      toolRegistry,
      dataRootDir: path.join(dir, 'data'),
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('inactive');
    expect(registry.get('com.example.translate-block')).toMatchObject({
      status: 'inactive',
      version: '0.1.0',
    });
    expect(result.entry?.dataDir).toBe(path.join(dir, 'data', 'com.example.translate-block'));
    expect(statSync(result.entry?.dataDir ?? '').isDirectory()).toBe(true);
    expect(toolRegistry.get('block:com.example.translate-block:local-llm:invoke')).toMatchObject({
      defaultPermission: 'ask_once',
      sideEffect: 'read',
      requiresApproval: false,
    });
  });

  it('returns a structured failure for invalid manifests', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      capabilities: [{ token: 'fs:*', reason: 'too broad' }],
    }));

    const result = await loadBlock(dir);

    expect(result.ok).toBe(false);
    expect(result.status).toBe('error');
    expect(result.report?.errors.map((error) => error.code)).toContain('capability_wildcard');
  });

  it('writes manifest artifacts and block.loaded events when stores are provided', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest());
    const registry = new BlockRegistry();
    const artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });
    const ledger = new EventLedger(path.join(dir, 'events.jsonl'));

    const result = await loadBlock(dir, {
      registry,
      artifactStore,
      ledger,
      runId: 'run-block-1',
      dataRootDir: path.join(dir, 'data'),
    });

    expect(result.ok).toBe(true);
    expect(result.manifestRef).toMatchObject({
      kind: 'block_manifest',
      runId: 'run-block-1',
      meta: { blockId: 'com.example.translate-block', version: '0.1.0' },
    });
    expect(result.resultRef).toMatchObject({
      kind: 'block_load_result',
      runId: 'run-block-1',
      meta: { blockId: 'com.example.translate-block', status: 'inactive' },
    });
    const events = await ledger.byRun('run-block-1');
    expect(events).toEqual([
      expect.objectContaining({
        type: 'block.loaded',
        block_id: 'com.example.translate-block',
        status: 'inactive',
        result_ref: expect.objectContaining({ kind: 'block_load_result' }),
      }),
    ]);
  });

  it('activates and deactivates loaded blocks with ledger events', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest());
    const registry = new BlockRegistry();
    const ledger = new EventLedger(path.join(dir, 'events.jsonl'));
    await loadBlock(dir, { registry, ledger, runId: 'run-block-2' });

    const activated = await activateBlock('com.example.translate-block', registry, { ledger, runId: 'run-block-2' });
    const deactivated = await deactivateBlock('com.example.translate-block', registry, { ledger, runId: 'run-block-2' });

    expect(activated.ok).toBe(true);
    expect(deactivated.ok).toBe(true);
    expect(registry.get('com.example.translate-block')?.status).toBe('inactive');
    expect((await ledger.byRun('run-block-2')).map((event) => event.type)).toEqual([
      'block.loaded',
      'block.activated',
      'block.deactivated',
    ]);
  });

  it('reports duplicate registry loads without replacing the existing entry', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest());
    const registry = new BlockRegistry();

    expect((await loadBlock(dir, { registry })).ok).toBe(true);
    const duplicate = await loadBlock(dir, { registry });

    expect(duplicate.ok).toBe(false);
    expect(duplicate.error).toContain('duplicate block id');
    expect(registry.size()).toBe(1);
  });

  it('fails activation for unknown blocks', async () => {
    const result = await activateBlock('com.example.missing', new BlockRegistry());

    expect(result).toMatchObject({
      ok: false,
      blockId: 'com.example.missing',
      status: 'error',
      error: 'unknown block id',
    });
  });
});

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
    description: 'Local LLM translation demo.',
    author: 'Example',
    license: 'MIT',
    runtime: {
      mode: 'local-worker',
      engine_version_range: '>=1.2.0 <2.0.0',
      sandbox: 'process-isolated',
    },
    entrypoints: { main: 'dist/index.js' },
    scripts: { test: 'vitest run' },
    capabilities: [
      { token: 'local-llm:invoke', reason: 'Translate text locally' },
    ],
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
