import { type ToolContext, type ToolResult } from './tools';
import type { BlockRegistryEntry } from './block-registry';
import type { EventLedger } from './event-ledger';
import type { ArtifactStore, ArtifactRef } from './artifact-model';
export interface BlockExecuteOptions {
    ledger?: EventLedger;
    artifactStore?: ArtifactStore;
    runId?: string;
    projectId?: string;
    input?: Record<string, unknown>;
    toolContext?: ToolContext;
    timeoutMs?: number;
}
export interface BlockExecuteResult {
    ok: boolean;
    blockId: string;
    status: 'completed' | 'error';
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    resultRef?: ArtifactRef;
    error?: string;
}
export declare function executeBlockMain(entry: BlockRegistryEntry, options?: BlockExecuteOptions): Promise<BlockExecuteResult>;
export declare function blockExecuteToToolResult(result: BlockExecuteResult): ToolResult<BlockExecuteResult>;
//# sourceMappingURL=block-executor.d.ts.map