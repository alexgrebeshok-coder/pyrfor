import { describe, expect, it } from 'vitest';
import {
  BlockMemoryNamespaceError,
  hasMemoryCapabilityForTier,
  resolveBlockMemoryScopes,
  scopeStringFor,
} from './block-memory-namespace';
import type { BlockManifest } from './block-manifest';

describe('block memory namespace resolver', () => {
  it('resolves project_shared and block_private scopes', () => {
    const scopes = resolveBlockMemoryScopes(manifest({
      memory_scope: {
        project_shared: ['estimate_items'],
        block_private: ['calculation_cache'],
      },
    }), 'project-1');

    expect(scopes.get('project_shared:estimate_items')).toEqual({
      tableName: 'estimate_items',
      tier: 'project_shared',
      scope: 'prj:project-1:shared:estimate_items',
    });
    expect(scopes.get('block_private:calculation_cache')).toEqual({
      tableName: 'calculation_cache',
      tier: 'block_private',
      scope: 'blk:com.example.memory-block:private:calculation_cache',
    });
  });

  it('requires projectId for project_shared scopes', () => {
    expect(() => resolveBlockMemoryScopes(manifest({
      memory_scope: { project_shared: ['estimate_items'] },
    }))).toThrow(BlockMemoryNamespaceError);
  });

  it('rejects global_shared for non trusted-core blocks', () => {
    expect(() => resolveBlockMemoryScopes(manifest({
      memory_scope: { global_shared: ['regulatory_norms'] },
    }), 'project-1')).toThrow('trusted-core');
  });

  it('allows global_shared for trusted-core blocks', () => {
    expect(scopeStringFor('global_shared', 'regulatory_norms', 'com.example.core', undefined, 'trusted-core')).toBe('global:shared:regulatory_norms');
  });

  it('rejects unsafe table names', () => {
    expect(() => scopeStringFor('block_private', 'Bad Table', 'com.example.memory-block')).toThrow(BlockMemoryNamespaceError);
    expect(() => scopeStringFor('block_private', 'items;drop', 'com.example.memory-block')).toThrow(BlockMemoryNamespaceError);
  });

  it('checks tier-specific memory capabilities', () => {
    const block = manifest({
      capabilities: [
        { token: 'memory:read', reason: 'Read shared project memory', scope: 'project' },
        { token: 'memory:write', reason: 'Write private cache', scope: 'block' },
      ],
    });

    expect(hasMemoryCapabilityForTier(block, 'project_shared', 'read')).toBe(true);
    expect(hasMemoryCapabilityForTier(block, 'project_shared', 'write')).toBe(false);
    expect(hasMemoryCapabilityForTier(block, 'block_private', 'write')).toBe(true);
    expect(hasMemoryCapabilityForTier(block, 'global_shared', 'read')).toBe(false);
  });
});

function manifest(overrides: Partial<BlockManifest> = {}): BlockManifest {
  return {
    pyrfor_manifest_version: '1',
    id: 'com.example.memory-block',
    name: 'Memory Block',
    version: '0.1.0',
    description: 'Memory block.',
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
    ...overrides,
  };
}
