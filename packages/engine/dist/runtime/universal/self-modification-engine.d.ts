import { CircuitBreaker } from '../../ai/circuit-breaker';
import type { ApprovalRequest } from '../approval-flow';
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import type { ImprovementProposal } from './meta-critic';
export interface SelfModificationApprovalFlow {
    enqueueApproval(req: Omit<ApprovalRequest, 'id'> & {
        id?: string;
    }): Promise<ApprovalRequest>;
}
export interface SelfModificationEngineDeps {
    artifactStore: ArtifactStore;
    approvalFlow: SelfModificationApprovalFlow;
    ledger: EventLedger;
    circuitBreaker?: CircuitBreaker;
    clock?: () => number;
}
export interface SelfModificationRequest {
    runId: string;
    conceptId: string;
    conceptKind: 'meta.improvement';
    projectId: string;
    proposal: ImprovementProposal;
    evalProofRef: ArtifactRef;
    decisionRecordRef: ArtifactRef;
    completionGateResultRef: ArtifactRef;
    metaMeta?: boolean;
}
export interface SelfModificationResult {
    status: 'pending_human_approval';
    reason: 'proposal_only_no_auto_apply';
    approvalId: string;
    artifactId: string;
}
export declare class SelfModificationValidationError extends Error {
    constructor(message: string);
}
export declare class SelfModificationEngine {
    private readonly deps;
    private readonly circuitBreaker;
    constructor(deps: SelfModificationEngineDeps);
    metaOptimize(input: SelfModificationRequest): Promise<SelfModificationResult>;
    recordMetaChangeRejection(runId: string, conceptId: string, reason: string): Promise<void>;
    private writeAndEnqueue;
    private validate;
    private validateArtifactRef;
    private tripCircuit;
    private escalateCircuitOpen;
    private emitMetaChange;
}
//# sourceMappingURL=self-modification-engine.d.ts.map