// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BlockCatalogStore, type BlockCatalogSnapshot } from './block-catalog-persistence';
import { BlockRegistry, type BlockRegistryEntry } from './block-registry';
import { ContractRegistry } from './contract-registry';
import { ToolRegistry as CapabilityToolRegistry } from './permission-engine';
import type { BlockManifest } from './block-manifest';

describe('BlockCatalogStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-block-catalog-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ── flush ────────────────────────────────────────────────────────────────

  it('flush writes a valid JSON catalog file', () => {
    const store = new BlockCatalogStore(path.join(dir, 'block-catalog.json'));
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha'));

    store.flush(registry);

    const raw = readFileSync(path.join(dir, 'block-catalog.json'), 'utf8');
    const snapshot = JSON.parse(raw) as BlockCatalogSnapshot;
    expect(snapshot.version).toBe(1);
    expect(snapshot.blocks).toHaveLength(1);
    expect(snapshot.blocks[0]!.blockId).toBe('com.example.alpha');
    expect(snapshot.blocks[0]!.status).toBe('inactive');
  });

  it('flush persists projectId for project-scoped entries', () => {
    const store = new BlockCatalogStore(path.join(dir, 'block-catalog.json'));
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha', 'inactive', 'proj-42'));

    store.flush(registry);

    const snapshot = readSnapshot(path.join(dir, 'block-catalog.json'));
    expect(snapshot.blocks[0]!.projectId).toBe('proj-42');
  });

  it('flush persists revoked status without modification', () => {
    const store = new BlockCatalogStore(path.join(dir, 'block-catalog.json'));
    const registry = new BlockRegistry();
    registry.register(entry('com.example.revoked', 'revoked'));

    store.flush(registry);

    const snapshot = readSnapshot(path.join(dir, 'block-catalog.json'));
    expect(snapshot.blocks[0]!.status).toBe('revoked');
  });

  it('flush overwrites existing file atomically', () => {
    const catalogPath = path.join(dir, 'block-catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha'));

    store.flush(registry);
    registry.register(entry('com.example.beta'));
    store.flush(registry);

    const snapshot = readSnapshot(catalogPath);
    expect(snapshot.blocks).toHaveLength(2);
  });

  it('flush creates parent directories if missing', () => {
    const nestedPath = path.join(dir, 'sub', 'nested', 'catalog.json');
    const store = new BlockCatalogStore(nestedPath);
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha'));

    expect(() => store.flush(registry)).not.toThrow();
    expect(existsSync(nestedPath)).toBe(true);
  });

  // ── hydrate ───────────────────────────────────────────────────────────────

  it('hydrate returns zero restored when no file exists', () => {
    const store = new BlockCatalogStore(path.join(dir, 'missing.json'));
    const registry = new BlockRegistry();

    const result = store.hydrate(registry);

    expect(result.restored).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.warnings).toHaveLength(0);
    expect(registry.size()).toBe(0);
  });

  it('hydrate restores a basic local entry', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha', 'active'));
    store.flush(registry);

    const registry2 = new BlockRegistry();
    const result = store.hydrate(registry2);

    expect(result.restored).toBe(1);
    expect(result.skipped).toBe(0);
    expect(registry2.get('com.example.alpha')).toMatchObject({
      blockId: 'com.example.alpha',
      status: 'active',
      version: '0.1.0',
    });
  });

  it('hydrate restores project-scoped entries under correct scope', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha', 'inactive', 'project-X'));
    store.flush(registry);

    const registry2 = new BlockRegistry();
    const result = store.hydrate(registry2);

    expect(result.restored).toBe(1);
    expect(registry2.get('com.example.alpha', 'project-X')).toMatchObject({
      blockId: 'com.example.alpha',
      projectId: 'project-X',
      status: 'inactive',
    });
    // should not be visible without projectId
    expect(registry2.get('com.example.alpha')).toBeUndefined();
  });

  it('hydrate preserves revoked status and does not register capability tools', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const srcRegistry = new BlockRegistry();
    srcRegistry.register(entry('com.example.revoked', 'revoked'));
    store.flush(srcRegistry);

    const registry = new BlockRegistry();
    const toolRegistry = new CapabilityToolRegistry();
    const result = store.hydrate(registry, { capabilityToolRegistry: toolRegistry });

    expect(result.restored).toBe(1);
    const restored = registry.get('com.example.revoked');
    expect(restored?.status).toBe('revoked');
    // No capability tools should be registered for revoked blocks
    expect(toolRegistry.get('block:com.example.revoked:local-llm:invoke')).toBeUndefined();
  });

  it('hydrate does not execute lifecycle code – no lifecycle side effects', () => {
    // This verifies that hydration never calls validateBlockPackage or loadBlockManifest.
    // We achieve this by persisting an entry whose rootDir points to a non-existent path;
    // if filesystem access were attempted, the test would throw.
    const catalogPath = path.join(dir, 'catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const srcRegistry = new BlockRegistry();
    const e = entry('com.example.nosuchdir');
    e.rootDir = '/this/path/does/not/exist/and/must/not/be/accessed';
    e.manifestPath = '/this/path/does/not/exist/block.json';
    srcRegistry.register(e);
    store.flush(srcRegistry);

    const registry = new BlockRegistry();
    expect(() => store.hydrate(registry)).not.toThrow();
    expect(registry.get('com.example.nosuchdir')).toBeDefined();
  });

  it('hydrate rebuilds capability tools from manifest (non-revoked)', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const srcRegistry = new BlockRegistry();
    srcRegistry.register(entry('com.example.alpha', 'inactive'));
    store.flush(srcRegistry);

    const registry = new BlockRegistry();
    const toolRegistry = new CapabilityToolRegistry();
    store.hydrate(registry, { capabilityToolRegistry: toolRegistry });

    expect(toolRegistry.get('block:com.example.alpha:local-llm:invoke')).toMatchObject({
      sideEffect: 'execute',
      requiresApproval: true,
    });
  });

  it('hydrate rebuilds contract registry entries (non-revoked)', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const srcRegistry = new BlockRegistry();
    srcRegistry.register(entry('com.example.alpha', 'inactive'));
    store.flush(srcRegistry);

    const registry = new BlockRegistry();
    const contractRegistry = new ContractRegistry();
    store.hydrate(registry, { contractRegistry });

    expect(contractRegistry.get('ApprovalEvidence@1')).toMatchObject({
      blockId: 'com.example.alpha',
      direction: 'produces',
    });
  });

  it('hydrate skips duplicate entries already in registry (idempotent)', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const srcRegistry = new BlockRegistry();
    srcRegistry.register(entry('com.example.alpha'));
    store.flush(srcRegistry);

    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha')); // pre-registered

    const result = store.hydrate(registry);
    expect(result.restored).toBe(0);
    expect(result.skipped).toBe(1);
    expect(registry.size()).toBe(1); // still only one
  });

  it('hydrate returns a warning for corrupt JSON files', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const { writeFileSync } = require('node:fs');
    writeFileSync(catalogPath, '{ this is not json', 'utf8');

    const registry = new BlockRegistry();
    const result = new BlockCatalogStore(catalogPath).hydrate(registry);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/block-catalog/);
    expect(registry.size()).toBe(0);
  });

  it('hydrate returns a warning for unrecognised snapshot versions', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const { writeFileSync } = require('node:fs');
    writeFileSync(catalogPath, JSON.stringify({ version: 99, blocks: [] }), 'utf8');

    const registry = new BlockRegistry();
    const result = new BlockCatalogStore(catalogPath).hydrate(registry);

    expect(result.warnings).toHaveLength(1);
  });

  it('round-trip: flush then hydrate restores multiple mixed entries', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const srcRegistry = new BlockRegistry();
    srcRegistry.register(entry('com.example.alpha', 'active'));
    srcRegistry.register(entry('com.example.beta', 'inactive', 'proj-1'));
    srcRegistry.register(entry('com.example.gamma', 'revoked'));
    store.flush(srcRegistry);

    const registry = new BlockRegistry();
    const result = store.hydrate(registry);

    expect(result.restored).toBe(3);
    expect(registry.get('com.example.alpha')?.status).toBe('active');
    expect(registry.get('com.example.beta', 'proj-1')?.status).toBe('inactive');
    expect(registry.get('com.example.gamma')?.status).toBe('revoked');
    expect(registry.size()).toBe(3);
  });

  it('round-trip: hydrated entries list is consistent with original', () => {
    const catalogPath = path.join(dir, 'catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const srcRegistry = new BlockRegistry();
    srcRegistry.register(entry('com.example.alpha', 'active', 'proj-x'));
    store.flush(srcRegistry);

    const registry = new BlockRegistry();
    store.hydrate(registry);

    const listed = registry.list({ projectId: 'proj-x' });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.blockId).toBe('com.example.alpha');
    expect(listed[0]!.projectId).toBe('proj-x');
  });
});

// ── Runtime integration: catalog persists across simulated restarts ────────────

describe('BlockCatalogStore runtime restart simulation', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-block-catalog-restart-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('survives a registry teardown and reconstruction (simulated restart)', () => {
    const catalogPath = path.join(dir, 'block-catalog.json');

    // ── "before restart": populate and persist ────────────────────────────
    const store = new BlockCatalogStore(catalogPath);
    const registry1 = new BlockRegistry();
    registry1.register(entry('com.example.alpha', 'active'));
    registry1.register(entry('com.example.beta', 'inactive', 'project-1'));
    registry1.register(entry('com.example.gamma', 'revoked'));
    store.flush(registry1);

    // ── "after restart": fresh registries ────────────────────────────────
    const store2 = new BlockCatalogStore(catalogPath);
    const registry2 = new BlockRegistry();
    const toolRegistry = new CapabilityToolRegistry();
    const contractRegistry = new ContractRegistry();

    const result = store2.hydrate(registry2, { capabilityToolRegistry: toolRegistry, contractRegistry });

    expect(result.restored).toBe(3);
    expect(result.warnings).toHaveLength(0);

    // active entry survives
    expect(registry2.get('com.example.alpha')).toMatchObject({ status: 'active' });

    // project-scoped entry survives under correct scope
    expect(registry2.get('com.example.beta', 'project-1')).toMatchObject({
      status: 'inactive',
      projectId: 'project-1',
    });

    // revoked entry remains revoked
    expect(registry2.get('com.example.gamma')).toMatchObject({ status: 'revoked' });

    // non-revoked capability tools are re-registered
    expect(toolRegistry.get('block:com.example.alpha:local-llm:invoke')).toBeDefined();
    expect(toolRegistry.get('block:com.example.beta:local-llm:invoke')).toBeDefined();

    // revoked block has NO tools
    expect(toolRegistry.get('block:com.example.gamma:local-llm:invoke')).toBeUndefined();

    // contracts are re-registered for non-revoked blocks
    expect(contractRegistry.get('ApprovalEvidence@1')).toBeDefined();
  });

  it('status changes made before restart are preserved', () => {
    const catalogPath = path.join(dir, 'block-catalog.json');
    const store = new BlockCatalogStore(catalogPath);
    const registry1 = new BlockRegistry();
    registry1.register(entry('com.example.alpha', 'inactive'));

    // Simulate activate + persist
    registry1.updateStatus('com.example.alpha', 'active');
    store.flush(registry1);

    // Simulate restart
    const registry2 = new BlockRegistry();
    store.hydrate(registry2);

    expect(registry2.get('com.example.alpha')?.status).toBe('active');
  });

  it('re-flush after hydration adds newly loaded blocks correctly', () => {
    const catalogPath = path.join(dir, 'block-catalog.json');

    // First "session": one block
    const store1 = new BlockCatalogStore(catalogPath);
    const registry1 = new BlockRegistry();
    registry1.register(entry('com.example.alpha', 'active'));
    store1.flush(registry1);

    // Second "session": hydrate then load another block, flush again
    const store2 = new BlockCatalogStore(catalogPath);
    const registry2 = new BlockRegistry();
    store2.hydrate(registry2);
    registry2.register(entry('com.example.beta', 'inactive', 'project-2'));
    store2.flush(registry2);

    // Third "session": verify both survive
    const store3 = new BlockCatalogStore(catalogPath);
    const registry3 = new BlockRegistry();
    store3.hydrate(registry3);

    expect(registry3.get('com.example.alpha')?.status).toBe('active');
    expect(registry3.get('com.example.beta', 'project-2')?.status).toBe('inactive');
    expect(registry3.size()).toBe(2);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function entry(
  blockId: string,
  status: BlockRegistryEntry['status'] = 'inactive',
  projectId?: string,
): BlockRegistryEntry {
  return {
    blockId,
    ...(projectId ? { projectId } : {}),
    manifest: manifest(blockId),
    status,
    registeredAt: '2026-05-15T00:00:00.000Z',
    version: '0.1.0',
  };
}

function manifest(blockId: string): BlockManifest {
  return {
    pyrfor_manifest_version: '1',
    id: blockId,
    name: 'Example Block',
    version: '0.1.0',
    description: 'Example block.',
    author: 'Example',
    license: 'MIT',
    runtime: {
      mode: 'local-worker',
      engine_version_range: '>=1.2.0 <2.0.0',
      sandbox: 'process-isolated',
    },
    entrypoints: { main: 'dist/index.js' },
    scripts: { test: 'vitest run' },
    capabilities: [{ token: 'local-llm:invoke', reason: 'Use local LLM' }],
    contracts: { consumes: [], produces: [{ ref: 'ApprovalEvidence@1' }] },
    optimizer_policy: {
      editable: true,
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
  };
}

function readSnapshot(filePath: string): BlockCatalogSnapshot {
  return JSON.parse(readFileSync(filePath, 'utf8')) as BlockCatalogSnapshot;
}
