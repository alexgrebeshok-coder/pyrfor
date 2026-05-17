import type { BlockManifest } from './block-manifest';
export type MemoryNamespaceTier = 'project_shared' | 'block_private' | 'global_shared';
export interface BlockMemoryNamespace {
    tableName: string;
    tier: MemoryNamespaceTier;
    scope: string;
}
export type BlockMemoryScopeMap = Map<string, BlockMemoryNamespace>;
export declare class BlockMemoryNamespaceError extends Error {
    constructor(message: string);
}
export declare function resolveBlockMemoryScopes(manifest: BlockManifest, projectId?: string): BlockMemoryScopeMap;
export declare function scopeStringFor(tier: MemoryNamespaceTier, tableName: string, blockId: string, projectId?: string, runtimeMode?: BlockManifest['runtime']['mode']): string;
export declare function hasMemoryCapabilityForTier(manifest: BlockManifest, tier: MemoryNamespaceTier, access: 'read' | 'write'): boolean;
export declare function isValidMemoryTableName(tableName: string): boolean;
//# sourceMappingURL=block-memory-namespace.d.ts.map