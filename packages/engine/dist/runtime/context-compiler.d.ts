import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { DagNode } from './durable-dag';
import type { EventLedger } from './event-ledger';
import type { RunLedger } from './run-ledger';
import type { SessionStore } from './session-store';
import type { LoadedWorkspace, WorkspaceLoader } from './workspace-loader';
import { searchDurableMemoryForContext, searchMemory, type MemoryScopeFilter, type MemoryType } from '../ai/memory/agent-memory-store';
import { type ContextPack, type ContextSourceRef, type ContextTaskContract, hashContextPack } from './context-pack';
export interface ContextFileInput {
    path: string;
    content: string;
    sha256?: string;
}
export interface ContextFactInput {
    id: string;
    content: unknown;
    source?: ContextSourceRef;
}
export interface ContextCompilerDeps {
    artifactStore?: ArtifactStore;
    eventLedger?: EventLedger;
    runLedger?: RunLedger;
    dag?: {
        listNodes(): DagNode[];
    };
    sessionStore?: SessionStore;
    workspace?: LoadedWorkspace;
    workspaceLoader?: WorkspaceLoader;
    memorySearch?: typeof searchMemory;
    durableMemorySearch?: typeof searchDurableMemoryForContext;
}
export interface CompileContextInput {
    runId?: string;
    workspaceId: string;
    projectId?: string;
    task: ContextTaskContract;
    compiledAt?: string;
    agentId?: string;
    query?: string;
    memoryTypes?: MemoryType[];
    memoryLimit?: number;
    memoryScope?: MemoryScopeFilter;
    filesOfInterest?: ContextFileInput[];
    historyRunIds?: string[];
    ledgerEventLimit?: number;
    sessionId?: string;
    sessionMessageLimit?: number;
    policyFacts?: ContextFactInput[];
    domainFacts?: ContextFactInput[];
}
export interface CompileContextResult {
    pack: ContextPack;
    hash: string;
    canonicalJson: string;
}
export declare class ContextCompiler {
    private readonly deps;
    constructor(deps?: ContextCompilerDeps);
    compile(input: CompileContextInput): Promise<CompileContextResult>;
    persist(result: CompileContextResult, opts?: {
        artifactStore?: ArtifactStore;
        runId?: string;
    }): Promise<ArtifactRef>;
    private collectLedgerHistory;
    private collectSessionHistory;
    private collectMemory;
}
export { hashContextPack };
//# sourceMappingURL=context-compiler.d.ts.map