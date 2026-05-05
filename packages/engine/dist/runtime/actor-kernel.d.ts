import type { ArtifactRef, ArtifactStore } from './artifact-model';
import type { DagNode, DurableDag } from './durable-dag';
import type { EventLedger } from './event-ledger';
import type { RunLedger } from './run-ledger';
import type { BudgetProfile, PermissionProfile, RunRecord } from './run-lifecycle';
export interface ActorKernelDeps {
    runLedger: Pick<RunLedger, 'createRun' | 'getRun' | 'replayRun' | 'recordArtifact'>;
    eventLedger: Pick<EventLedger, 'append'>;
    dag: Pick<DurableDag, 'addNode' | 'listReady' | 'listNodes' | 'leaseNode' | 'startNode' | 'completeNode' | 'failNode' | 'getNode' | 'addProvenance'>;
    artifactStore: Pick<ArtifactStore, 'writeJSON' | 'list'>;
    now?: () => Date;
    idFactory?: () => string;
}
export interface SpawnActorInput {
    runId: string;
    actorId?: string;
    agentId: string;
    agentName?: string;
    role?: string;
    parentActorId?: string;
    goal?: string;
    budget?: BudgetProfile;
    permissionProfile?: PermissionProfile;
}
export interface SpawnActorResult {
    actorId: string;
    childRun: RunRecord;
}
export interface EnqueueActorMessageInput {
    runId: string;
    actorId: string;
    task: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
    dependsOn?: string[];
    priority?: number;
    allowConcurrent?: boolean;
}
export interface LeaseActorMessageInput {
    runId: string;
    owner: string;
    actorId?: string;
    ttlMs?: number;
}
export interface LeaseActorMessageResult {
    node: DagNode;
}
export interface CompleteActorMessageInput {
    runId: string;
    nodeId: string;
    owner: string;
    output?: string;
    summary?: string;
    proof?: Record<string, unknown>;
}
export interface CompleteActorMessageResult {
    node: DagNode;
    proofArtifact: ArtifactRef;
    alreadyFinalized?: boolean;
}
export interface FailActorMessageInput {
    runId: string;
    nodeId: string;
    owner: string;
    reason: string;
    retryable?: boolean;
}
export interface RecoverStuckActorMessagesInput {
    runId: string;
    actorId?: string;
    olderThanMs: number;
    reason?: string;
}
export interface RecoverStuckActorMessagesResult {
    recovered: DagNode[];
}
export declare class ActorKernel {
    private readonly deps;
    private readonly proofFinalizationLocks;
    constructor(deps: ActorKernelDeps);
    spawnActor(input: SpawnActorInput): Promise<SpawnActorResult>;
    enqueueMessage(input: EnqueueActorMessageInput): Promise<DagNode>;
    leaseNextMessage(input: LeaseActorMessageInput): Promise<LeaseActorMessageResult | null>;
    completeMessage(input: CompleteActorMessageInput): Promise<CompleteActorMessageResult>;
    private completeMessageLocked;
    failMessage(input: FailActorMessageInput): Promise<DagNode>;
    recoverStuckMessages(input: RecoverStuckActorMessagesInput): Promise<RecoverStuckActorMessagesResult>;
    private requireRun;
    private requireMailboxNode;
    private requireLeasedMailboxNode;
    private requireCompletableMailboxNode;
    private findExistingProofArtifact;
    private resolveProofRunId;
    private getCompletionOwner;
    private withProofFinalizationLock;
    private appendActorEvent;
    private nowIso;
    private nowMs;
    private id;
}
export declare function createActorKernel(deps: ActorKernelDeps): ActorKernel;
//# sourceMappingURL=actor-kernel.d.ts.map