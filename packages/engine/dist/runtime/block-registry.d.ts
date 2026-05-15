import type { ArtifactRef } from './artifact-model';
import type { BlockManifest } from './block-manifest';
import type { BlockMemoryScopeMap } from './block-memory-namespace';
export type BlockStatus = 'loading' | 'active' | 'inactive' | 'error' | 'revoked';
export interface BlockRegistryEntry {
    blockId: string;
    projectId?: string;
    manifest: BlockManifest;
    status: BlockStatus;
    registeredAt: string;
    version?: string;
    rootDir?: string;
    manifestPath?: string;
    dataDir?: string;
    manifestRef?: ArtifactRef;
    memoryScopeMap?: BlockMemoryScopeMap;
    error?: string;
}
export declare class BlockRegistryError extends Error {
    constructor(message: string);
}
export declare class BlockRegistry {
    private readonly entries;
    register(entry: BlockRegistryEntry): void;
    get(blockId: string, projectId?: string): BlockRegistryEntry | undefined;
    list(options?: {
        status?: BlockStatus;
        projectId?: string;
    }): BlockRegistryEntry[];
    updateStatus(blockId: string, status: BlockStatus, error?: string, projectId?: string): void;
    unregister(blockId: string, projectId?: string): boolean;
    size(): number;
}
//# sourceMappingURL=block-registry.d.ts.map