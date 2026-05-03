/**
 * durable-dag.ts — durable task DAG with leases, idempotency and provenance.
 *
 * This is an orchestration primitive, not a worker queue. It records what can
 * run, who leased it, what artifacts/effects it produced, and how to recover
 * when a lease expires.
 */
import { EventLedger } from './event-ledger';
export type DagNodeStatus = 'pending' | 'ready' | 'leased' | 'running' | 'blocked' | 'succeeded' | 'failed' | 'cancelled';
export type DagRetryClass = 'none' | 'transient' | 'deterministic' | 'policy' | 'human_needed';
export type DagTimeoutClass = 'short' | 'normal' | 'long' | 'manual';
export interface DagLease {
    owner: string;
    leasedAt: number;
    expiresAt: number;
}
export interface DagCompensationPolicy {
    kind: 'none' | 'rollback' | 'manual';
    rollbackHandle?: string;
    note?: string;
}
export interface DagProvenanceLink {
    kind: 'run' | 'artifact' | 'effect' | 'ledger_event' | 'worker_frame' | 'memory';
    ref: string;
    role: 'input' | 'output' | 'evidence' | 'decision' | 'side_effect';
    sha256?: string;
    meta?: Record<string, unknown>;
}
export interface DagNode {
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    status: DagNodeStatus;
    dependsOn: string[];
    idempotencyKey: string;
    retryClass: DagRetryClass;
    timeoutClass: DagTimeoutClass;
    compensation: DagCompensationPolicy;
    attempts: number;
    createdAt: number;
    updatedAt: number;
    lease?: DagLease;
    failure?: {
        reason: string;
        retryable: boolean;
    };
    provenance: DagProvenanceLink[];
}
export interface DurableDagOptions {
    storePath?: string;
    clock?: () => number;
    ledger?: EventLedger;
    ledgerRunId?: string;
    dagId?: string;
}
export interface AddDagNodeInput {
    id?: string;
    kind: string;
    payload?: Record<string, unknown>;
    dependsOn?: string[];
    idempotencyKey?: string;
    retryClass?: DagRetryClass;
    timeoutClass?: DagTimeoutClass;
    compensation?: DagCompensationPolicy;
    provenance?: DagProvenanceLink[];
}
export interface HydrateDagNodeInput {
    id: string;
    kind: string;
    payload?: Record<string, unknown>;
    status?: DagNodeStatus;
    dependsOn?: string[];
    idempotencyKey?: string;
    retryClass?: DagRetryClass;
    timeoutClass?: DagTimeoutClass;
    compensation?: DagCompensationPolicy;
    attempts?: number;
    createdAt?: number;
    updatedAt?: number;
    lease?: DagLease;
    failure?: DagNode['failure'];
    provenance?: DagProvenanceLink[];
}
export declare class DurableDag {
    private readonly storePath;
    private readonly clock;
    private readonly ledger;
    private readonly ledgerRunId;
    private readonly dagId;
    private ledgerWriteChain;
    private readonly nodes;
    constructor(options?: DurableDagOptions);
    addNode(input: AddDagNodeInput): DagNode;
    getNode(id: string): DagNode | undefined;
    hydrateNode(input: HydrateDagNodeInput): DagNode;
    listNodes(filter?: {
        status?: DagNodeStatus;
        kind?: string;
    }): DagNode[];
    listReady(): DagNode[];
    leaseNode(nodeId: string, owner: string, ttlMs: number): DagNode;
    startNode(nodeId: string, owner: string): DagNode;
    completeNode(nodeId: string, provenance?: DagProvenanceLink[]): DagNode;
    failNode(nodeId: string, reason: string, retryable: boolean): DagNode;
    cancelNode(nodeId: string): DagNode;
    addProvenance(nodeId: string, link: DagProvenanceLink): DagNode;
    reclaimExpiredLeases(): DagNode[];
    recoverInterruptedLeases(reason?: string): DagNode[];
    flushLedger(): Promise<void>;
    flush(): void;
    private load;
    private findActiveByIdempotencyKey;
    private requireNode;
    private dependenciesSatisfied;
    private isLeaseExpired;
    private markNewlyReady;
    private updateNode;
    private appendLedger;
}
//# sourceMappingURL=durable-dag.d.ts.map