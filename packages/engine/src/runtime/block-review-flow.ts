import type { ApprovalDecision, ApprovalRequest } from './approval-flow';
import {
  buildKsReconciliationFinalReport,
  buildKsReconciliationReviewPack,
  reviewKsReconciliationFinding,
  type KsReconciliationFindingReviewAction,
  type KsReconciliationReviewPack,
} from './ks-reconciliation-fixture';
import type { BlockExecuteResult } from './block-executor';
import { executeBlockMain, type BlockExecuteOptions } from './block-executor';
import type { BlockRegistry, BlockRegistryEntry } from './block-registry';
import { activateBlock } from './block-loader';

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

export async function runBlockWithHumanReview(
  options: BlockReviewFlowOptions,
): Promise<BlockReviewFlowResult> {
  const { registry, blockId, approvalFlow, runId = `block-review-${blockId}` } = options;
  let entry = registry.get(blockId, options.projectId);
  if (!entry) {
    return { ok: false, blockId, error: 'block not registered' };
  }

  if (options.activateBeforeRun !== false && entry.status !== 'active') {
    const activated = await activateBlock(blockId, registry, {
      ledger: options.ledger,
      runId,
      projectId: options.projectId,
    });
    if (!activated.ok) {
      return { ok: false, blockId, error: activated.error ?? 'activation failed' };
    }
    entry = activated.entry ?? registry.get(blockId, options.projectId) ?? entry;
  }

  const execute = await executeBlockMain(entry as BlockRegistryEntry, { ...options, runId });
  if (!execute.ok) {
    return { ok: false, blockId, execute, error: execute.error };
  }

  const reviewPack = buildKsReconciliationReviewPack(runId, {});
  const approvalId = `block-review:${blockId}:${runId}`;
  const decision = await approvalFlow.requestApproval({
    id: approvalId,
    toolName: reviewPack.approvalRequest.toolName,
    summary: reviewPack.approvalRequest.summary,
    args: { blockId, runId, findings: reviewPack.findings.length },
    run_id: runId,
  });

  if (decision !== 'approve') {
    return { ok: false, blockId, execute, reviewPack, approvalId, error: 'human review denied' };
  }

  const reviewed = autoAcceptKsReviewPack(reviewPack);
  const finalReport = buildKsReconciliationFinalReport(runId, approvalId, reviewed);
  return { ok: true, blockId, execute, reviewPack: reviewed, finalReport, approvalId };
}

function autoAcceptKsReviewPack(pack: KsReconciliationReviewPack): KsReconciliationReviewPack {
  return pack.findings.reduce((current, finding, index) => (
    reviewKsReconciliationFinding(current, {
      findingId: finding.finding_id,
      action: 'accept' as KsReconciliationFindingReviewAction,
      reviewerId: 'block-review-flow',
      reviewedAt: `2026-05-15T01:0${index}:00.000Z`,
      reviewerComment: 'Auto-approved for integration test/demo path',
    })
  ), pack);
}
