import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from './artifact-model';
import { loadBlock, activateBlock, deactivateBlock, deriveSideEffect } from './block-loader';
import type { BlockManifest } from './block-manifest';
import { BlockRegistry } from './block-registry';
import { ContractRegistry } from './contract-registry';
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
    const contractRegistry = new ContractRegistry();

    const result = await loadBlock(dir, {
      registry,
      toolRegistry,
      contractRegistry,
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
      sideEffect: 'execute',
      requiresApproval: true,
      idempotent: false,
    });
    expect(result.registeredContractRefs).toEqual(['ApprovalEvidence@1']);
    expect(contractRegistry.get('ApprovalEvidence@1')).toMatchObject({
      blockId: 'com.example.translate-block',
      direction: 'produces',
    });
  });

  it.each([
    ['local-llm:invoke', 'execute'],
    ['cloud-llm:invoke', 'network'],
    ['a2a:call', 'network'],
    ['mcp:connect', 'network'],
    ['memory:read', 'read'],
    ['memory:write', 'write'],
    ['artifact:create', 'write'],
    ['trust-panel:propose', 'write'],
    ['audit:write', 'write'],
    ['fs:delete', 'destructive'],
  ] as const)('classifies %s as %s side effect', (token, expected) => {
    expect(deriveSideEffect(token)).toBe(expected);
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

  it('projects manifest memory scopes when projectId is provided', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      capabilities: [
        { token: 'memory:read', reason: 'Read project memory', scope: 'project' },
        { token: 'memory:write', reason: 'Write block cache', scope: 'block' },
      ],
      memory_scope: {
        project_shared: ['estimate_items'],
        block_private: ['calculation_cache'],
      },
    }));
    const registry = new BlockRegistry();

    const result = await loadBlock(dir, { registry, projectId: 'project-1' });

    expect(result.ok).toBe(true);
    const memoryScopeMap = registry.get('com.example.translate-block')?.memoryScopeMap;
    expect(memoryScopeMap?.get('project_shared:estimate_items')?.scope).toBe('prj:project-1:shared:estimate_items');
    expect(memoryScopeMap?.get('block_private:calculation_cache')?.scope).toBe('blk:com.example.translate-block:private:calculation_cache');
  });

  it('warns and skips memory scope projection when projectId is required but missing', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      capabilities: [{ token: 'memory:read', reason: 'Read project memory', scope: 'project' }],
      memory_scope: { project_shared: ['estimate_items'] },
    }));
    const registry = new BlockRegistry();

    const result = await loadBlock(dir, { registry });

    expect(result.ok).toBe(true);
    expect(registry.get('com.example.translate-block')?.memoryScopeMap).toBeUndefined();
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('project_shared memory scope requires projectId'),
    ]));
  });

  it('keeps block_private scopes when project_shared cannot be resolved', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      capabilities: [
        { token: 'memory:read', reason: 'Read project memory', scope: 'project' },
        { token: 'memory:write', reason: 'Write block cache', scope: 'block' },
      ],
      memory_scope: {
        project_shared: ['estimate_items'],
        block_private: ['calculation_cache'],
      },
    }));
    const registry = new BlockRegistry();

    const result = await loadBlock(dir, { registry });

    expect(result.ok).toBe(true);
    const memoryScopeMap = registry.get('com.example.translate-block')?.memoryScopeMap;
    expect(memoryScopeMap?.get('project_shared:estimate_items')).toBeUndefined();
    expect(memoryScopeMap?.get('block_private:calculation_cache')?.scope).toBe('blk:com.example.translate-block:private:calculation_cache');
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('memory_scope.project_shared.estimate_items'),
    ]));
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

  it('warns instead of failing on duplicate contract refs', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest());
    const contractRegistry = new ContractRegistry();
    contractRegistry.register({
      ref: 'ApprovalEvidence@1',
      blockId: 'com.example.existing',
      direction: 'produces',
      registeredAt: '2026-05-15T00:00:00.000Z',
    });

    const result = await loadBlock(dir, { contractRegistry });

    expect(result.ok).toBe(true);
    expect(result.registeredContractRefs).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate contract ref "ApprovalEvidence@1"'),
    ]));
  });

  it('registers produced contract schema metadata with block-manifest provenance', async () => {
    writePackage(dir, { test: 'vitest run' });
    writeManifest(dir, manifest({
      contracts: {
        consumes: [{ ref: 'Document@1', from: 'any' }],
        produces: [{
          ref: 'ApprovalEvidence@1',
          schema: {
            path: 'contracts/approval-evidence.v1.schema.json',
            mediaType: 'application/schema+json',
            sha256: 'b'.repeat(64),
            validate: true,
          },
        }],
      },
    }));
    const contractRegistry = new ContractRegistry();
    const artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });

    const result = await loadBlock(dir, {
      contractRegistry,
      artifactStore,
      runId: 'run-block-contracts',
      dataRootDir: path.join(dir, 'data'),
    });

    expect(result.ok).toBe(true);
    expect(result.registeredContractRefs).toEqual(['Document@1', 'ApprovalEvidence@1']);
    expect(contractRegistry.get('Document@1')).toMatchObject({
      direction: 'consumes',
      from: 'any',
    });
    expect(contractRegistry.get('Document@1')?.schema).toBeUndefined();
    expect(contractRegistry.get('Document@1')?.provenance).toBeUndefined();
    expect(contractRegistry.get('ApprovalEvidence@1')).toMatchObject({
      direction: 'produces',
      schema: {
        path: 'contracts/approval-evidence.v1.schema.json',
        mediaType: 'application/schema+json',
        sha256: 'b'.repeat(64),
        validate: true,
      },
      provenance: {
        source: 'block-manifest',
        manifestPath: path.join(dir, 'block.json'),
        blockVersion: '0.1.0',
        manifestRef: result.manifestRef,
      },
    });
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
