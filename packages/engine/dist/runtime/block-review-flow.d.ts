import type { ApprovalDecision, ApprovalRequest } from './approval-flow';
import { buildKsReconciliationFinalReport, type KsReconciliationReviewPack } from './ks-reconciliation-fixture';
import type { BlockExecuteResult } from './block-executor';
import { type BlockExecuteOptions } from './block-executor';
import type { BlockRegistry } from './block-registry';
export interface BlockReviewApprovalFlow {
    requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}
export interface BlockReviewFlowOptions extends BlockExecuteOptions {
    registry: BlockRegistry;
    approvalFlow: BlockReviewApprovalFlow;
    blockId: string;
    activateBeforeRun?: boolean;
}
export interface BlockReviewFlowResult {
    ok: boolean;
    blockId: string;
    execute?: BlockExecuteResult;
    reviewPack?: KsReconciliationReviewPack;
    finalReport?: ReturnType<typeof buildKsReconciliationFinalReport>;
    approvalId?: string;
    error?: string;
}
export declare function runBlockWithHumanReview(options: BlockReviewFlowOptions): Promise<BlockReviewFlowResult>;
//# sourceMappingURL=block-review-flow.d.ts.map