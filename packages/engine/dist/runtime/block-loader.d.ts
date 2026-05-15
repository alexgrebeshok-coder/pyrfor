import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { EventLedger } from './event-ledger';
import type { ToolRegistry } from './permission-engine';
import { type BlockManifest, type BlockPackageValidationReport } from './block-manifest';
import { BlockRegistry, type BlockRegistryEntry, type BlockStatus } from './block-registry';
import { ContractRegistry } from './contract-registry';
export interface BlockLoaderOptions {
    registry?: BlockRegistry;
    toolRegistry?: ToolRegistry;
    contractRegistry?: ContractRegistry;
    ledger?: EventLedger;
    artifactStore?: ArtifactStore;
    dataRootDir?: string;
    runId?: string;
}
export interface BlockLoadResult {
    ok: boolean;
    blockId: string;
    status?: BlockStatus;
    manifest?: BlockManifest;
    entry?: BlockRegistryEntry;
    report?: BlockPackageValidationReport;
    manifestRef?: ArtifactRef;
    resultRef?: ArtifactRef;
    error?: string;
    warnings: string[];
    registeredCapabilityTools: string[];
    registeredContractRefs: string[];
}
export declare function loadBlock(blockPath: string, options?: BlockLoaderOptions): Promise<BlockLoadResult>;
export declare function activateBlock(blockId: string, registry: BlockRegistry, options?: Pick<BlockLoaderOptions, 'ledger' | 'runId'>): Promise<BlockLoadResult>;
export declare function deactivateBlock(blockId: string, registry: BlockRegistry, options?: Pick<BlockLoaderOptions, 'ledger' | 'runId'>): Promise<BlockLoadResult>;
//# sourceMappingURL=block-loader.d.ts.map