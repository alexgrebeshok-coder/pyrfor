import { describe, expect, it } from 'vitest';
import { BlockRegistry, BlockRegistryError, type BlockRegistryEntry } from './block-registry';
import type { BlockManifest } from './block-manifest';

describe('BlockRegistry', () => {
  it('registers and retrieves block entries', () => {
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha'));

    expect(registry.get('com.example.alpha')).toMatchObject({
      blockId: 'com.example.alpha',
      status: 'inactive',
      version: '0.1.0',
    });
    expect(registry.size()).toBe(1);
  });

  it('rejects duplicate block ids', () => {
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha'));

    expect(() => registry.register(entry('com.example.alpha'))).toThrow(BlockRegistryError);
  });

  it('allows the same block id to be registered for different projects', () => {
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha', 'inactive', 'project-1'));
    registry.register(entry('com.example.alpha', 'inactive', 'project-2'));

    expect(registry.get('com.example.alpha', 'project-1')).toMatchObject({ projectId: 'project-1' });
    expect(registry.get('com.example.alpha', 'project-2')).toMatchObject({ projectId: 'project-2' });
    expect(registry.list({ projectId: 'project-2' })).toEqual([
      expect.objectContaining({ blockId: 'com.example.alpha', projectId: 'project-2' }),
    ]);
  });

  it('keeps unscoped and "__local__" project registrations distinct', () => {
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha'));
    registry.register(entry('com.example.alpha', 'inactive', '__local__'));

    expect(registry.get('com.example.alpha')).toEqual(
      expect.not.objectContaining({ projectId: expect.anything() }),
    );
    expect(registry.get('com.example.alpha', '__local__')).toMatchObject({ projectId: '__local__' });
    expect(registry.size()).toBe(2);
  });

  it('filters by status', () => {
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha', 'active'));
    registry.register(entry('com.example.beta', 'inactive'));

    expect(registry.list()).toHaveLength(2);
    expect(registry.list({ status: 'active' }).map((item) => item.blockId)).toEqual(['com.example.alpha']);
  });

  it('updates status and preserves errors', () => {
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha', 'inactive', 'project-1'));

    registry.updateStatus('com.example.alpha', 'error', 'activation failed', 'project-1');

    expect(registry.get('com.example.alpha', 'project-1')).toMatchObject({
      status: 'error',
      error: 'activation failed',
    });
  });

  it('unregisters entries', () => {
    const registry = new BlockRegistry();
    registry.register(entry('com.example.alpha', 'inactive', 'project-1'));

    expect(registry.unregister('com.example.alpha', 'project-1')).toBe(true);
    expect(registry.unregister('com.example.alpha', 'project-1')).toBe(false);
    expect(registry.size()).toBe(0);
  });
});

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
