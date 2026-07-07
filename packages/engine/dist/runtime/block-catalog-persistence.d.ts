/**
 * Durable persistence for the block catalog (registry entries + manifests).
 *
 * Design:
 * - One small JSON file: `<orchestrationDir>/block-catalog.json`
 * - Serializes every BlockRegistryEntry verbatim (manifest included) so
 *   hydration never needs to touch the filesystem or run any lifecycle code.
 * - memoryScopeMap is persisted as an array of [key, value] pairs so it
 *   round-trips through JSON without loss.
 * - On hydration, entries are injected directly into the BlockRegistry.
 *   Capability tools and contracts are rebuilt from the stored manifests.
 * - Safety invariants preserved:
 *   - no lifecycle/entrypoint execution
 *   - revoked stays revoked
 *   - no signing verification
 *   - no cloud behaviour
 */
import type { ArtifactRef } from './artifact-model';
import type { BlockManifest } from './block-manifest';
import { BlockRegistry, type BlockStatus } from './block-registry';
import { ContractRegistry } from './contract-registry';
import type { ToolRegistry as CapabilityToolRegistry } from './permission-engine';
export interface PersistedMemoryScopeEntry {
    tier: string;
    tableName: string;
    scope: string;
}
export interface PersistedBlockEntry {
    blockId: string;
    projectId?: string;
    version?: string;
    status: BlockStatus;
    registeredAt: string;
    rootDir?: string;
    manifestPath?: string;
    dataDir?: string;
    manifest: BlockManifest;
    manifestRef?: ArtifactRef;
    /** Serialised Map<string, PersistedMemoryScopeEntry> */
    memoryScopeMap?: Array<[string, PersistedMemoryScopeEntry]>;
    error?: string;
}
export interface BlockCatalogSnapshot {
    version: 1;
    savedAt: string;
    blocks: PersistedBlockEntry[];
}
export declare class BlockCatalogStore {
    private readonly filePath;
    constructor(filePath: string);
    /**
     * Write the current block registry state to disk atomically.
     */
    flush(registry: BlockRegistry): void;
    /**
     * Hydrate a BlockRegistry (and optionally capability-tool / contract
     * registries) from the persisted catalog.
     *
     * Safe: does not execute lifecycle hooks, entrypoints, or perform signing
     * verification.  Revoked blocks are restored with status `revoked`.
     * Capability tools and contracts are rebuilt from stored manifest data.
     */
    hydrate(registry: BlockRegistry, options?: {
        capabilityToolRegistry?: CapabilityToolRegistry;
        contractRegistry?: ContractRegistry;
    }): {
        restored: number;
        skipped: number;
        warnings: string[];
    };
    /** Path to the catalog file (useful for logging). */
    get path(): string;
}
//# sourceMappingURL=block-catalog-persistence.d.ts.map