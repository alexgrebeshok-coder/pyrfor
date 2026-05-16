import type { BlockManifest } from './block-manifest';

export type MemoryNamespaceTier = 'project_shared' | 'block_private' | 'global_shared';

export interface BlockMemoryNamespace {
  tableName: string;
  tier: MemoryNamespaceTier;
  scope: string;
}

export type BlockMemoryScopeMap = Map<string, BlockMemoryNamespace>;

export class BlockMemoryNamespaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockMemoryNamespaceError';
  }
}

const TABLE_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

export function resolveBlockMemoryScopes(manifest: BlockManifest, projectId?: string): BlockMemoryScopeMap {
  const result: BlockMemoryScopeMap = new Map();
  const memoryScope = manifest.memory_scope;
  if (!memoryScope) return result;
  for (const tier of ['project_shared', 'block_private', 'global_shared'] as const) {
    for (const tableName of memoryScope[tier] ?? []) {
      const scope = scopeStringFor(tier, tableName, manifest.id, projectId, manifest.runtime.mode);
      result.set(`${tier}:${tableName}`, { tableName, tier, scope });
    }
  }
  return result;
}

export function scopeStringFor(
  tier: MemoryNamespaceTier,
  tableName: string,
  blockId: string,
  projectId?: string,
  runtimeMode?: BlockManifest['runtime']['mode'],
): string {
  assertTableName(tableName);
  if (tier === 'project_shared') {
    if (!projectId) throw new BlockMemoryNamespaceError('project_shared memory scope requires projectId');
    return `prj:${projectId}:shared:${tableName}`;
  }
  if (tier === 'block_private') return `blk:${blockId}:private:${tableName}`;
  if (runtimeMode !== 'trusted-core') throw new BlockMemoryNamespaceError('global_shared memory scope requires trusted-core runtime');
  return `global:shared:${tableName}`;
}

export function hasMemoryCapabilityForTier(
  manifest: BlockManifest,
  tier: MemoryNamespaceTier,
  access: 'read' | 'write',
): boolean {
  const expectedScope = tier === 'project_shared' ? 'project' : tier === 'block_private' ? 'block' : 'global';
  return manifest.capabilities.some((capability) =>
    capability.token === `memory:${access}` && capability.scope === expectedScope,
  );
}

export function isValidMemoryTableName(tableName: string): boolean {
  return TABLE_NAME_RE.test(tableName);
}

function assertTableName(tableName: string): void {
  if (!isValidMemoryTableName(tableName)) {
    throw new BlockMemoryNamespaceError(`invalid memory table name "${tableName}"`);
  }
}
