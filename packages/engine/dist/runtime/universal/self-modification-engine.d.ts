import type { ApprovalDecision, ApprovalRequest } from '../approval-flow';
import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import type { ImprovementProposal } from './meta-critic';
export interface SelfModificationApprovalFlow {
    requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}
export interface SelfModificationCircuitBreakerOptions {
    maxConsecutiveFailures: number;
}
export interface SelfModificationEngineDeps {
    artifactStore: ArtifactStore;
    approvalFlow: SelfModificationApprovalFlow;
    ledger?: EventLedger;
    circuitBreaker?: SelfModificationCircuitBreakerOptions;
    clock?: () => number;
}
export interface SelfModificationRequest {
    runId: string;
    conceptId: string;
    proposal: ImprovementProposal;
    evalProofRef: ArtifactRef;
    metaMeta?: boolean;
}
export interface SelfModificationResult {
    status: 'proposal_only_pending_approval' | 'human_denied' | 'quarantined' | 'circuit_open';
    reason: string;
    approvalId?: string;
    artifactId?: string;
}
export declare class SelfModificationValidationError extends Error {
    constructor(message: string);
}
export declare class SelfModificationEngine {
    private readonly deps;
    private consecutiveFailures;
    constructor(deps: SelfModificationEngineDeps);
    submit(input: SelfModificationRequest): Promise<SelfModificationResult>;
    private validate;
    private quarantine;
    private writeEnvelope;
    private emit;
    private maxConsecutiveFailures;
}
//# sourceMappingURL=self-modification-engine.d.ts.map