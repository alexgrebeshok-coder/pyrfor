import type { ApprovalDecision, ApprovalRequest } from '../approval-flow';
import type { ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import type { MemoryStore } from '../memory-store';
import type { DoubleLoopRecord } from './memory/types';
import type { AcceptanceReport, AcceptanceTestSuite } from './tester';
import { type MetaCriticRunBudgetGuard } from '../si-run-budget-guard';
export declare const AUTONOMOUS_ELIGIBLE_TYPES: Set<"budget" | "policy" | "algorithm" | "heuristic" | "verifier_rules">;
export declare const ALWAYS_HUMAN_TYPES: Set<"budget" | "policy" | "algorithm" | "heuristic" | "verifier_rules">;
export interface ImprovementProposal {
    schemaVersion: 'pyrfor.improvement_proposal.v1';
    entryId: string;
    record: DoubleLoopRecord;
    evalArtifactId?: string;
    rollbackVerified: boolean;
    decision: 'promoted' | 'quarantined' | 'escalated_to_human' | 'pending';
    decisionReason: string;
    approvalId?: string;
    artifactId?: string;
    evaluatedAt: string;
}
export interface MetaCriticApprovalFlow {
    requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}
export interface MetaCriticAcceptanceTester {
    run(suite: AcceptanceTestSuite): Promise<AcceptanceReport>;
}
export interface MetaCriticDeps {
    memoryStore: MemoryStore;
    artifactStore: ArtifactStore;
    ledger: EventLedger;
    approvalFlow: MetaCriticApprovalFlow;
    acceptanceTester: MetaCriticAcceptanceTester;
    buildEvalSuite: (record: DoubleLoopRecord, runId: string) => AcceptanceTestSuite;
    clock?: () => number;
    runBudgetGuard?: MetaCriticRunBudgetGuard;
}
export interface MetaCriticRunInput {
    runId: string;
    conceptId?: string;
    ruleKeys?: string[];
    maxProposals?: number;
}
export interface MetaCriticRunResult {
    evaluated: number;
    promoted: number;
    quarantined: number;
    escalated: number;
    proposalArtifactIds: string[];
}
export declare class MetaCriticValidationError extends Error {
    constructor(message: string);
}
export declare class MetaCritic {
    private readonly deps;
    constructor(deps: MetaCriticDeps);
    run(input: MetaCriticRunInput): Promise<MetaCriticRunResult>;
    evaluateEntry(entryId: string, runId: string, conceptId?: string): Promise<ImprovementProposal>;
    private evaluateEntryCore;
    private findCandidateEntries;
    private hasRejectedDuplicate;
    private proposal;
    private writeProposal;
    private quarantineMalformedCandidate;
    private markPendingApproval;
    private validateEvaluationProof;
}
//# sourceMappingURL=meta-critic.d.ts.map