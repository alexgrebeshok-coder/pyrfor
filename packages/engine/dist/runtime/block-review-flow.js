var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { buildKsReconciliationFinalReport, buildKsReconciliationReviewPack, reviewKsReconciliationFinding, } from './ks-reconciliation-fixture.js';
import { executeBlockMain } from './block-executor.js';
import { activateBlock } from './block-loader.js';
export function runBlockWithHumanReview(options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const { registry, blockId, approvalFlow, runId = `block-review-${blockId}` } = options;
        let entry = registry.get(blockId, options.projectId);
        if (!entry) {
            return { ok: false, blockId, error: 'block not registered' };
        }
        if (options.activateBeforeRun !== false && entry.status !== 'active') {
            const activated = yield activateBlock(blockId, registry, {
                ledger: options.ledger,
                runId,
                projectId: options.projectId,
            });
            if (!activated.ok) {
                return { ok: false, blockId, error: (_a = activated.error) !== null && _a !== void 0 ? _a : 'activation failed' };
            }
            entry = (_c = (_b = activated.entry) !== null && _b !== void 0 ? _b : registry.get(blockId, options.projectId)) !== null && _c !== void 0 ? _c : entry;
        }
        const execute = yield executeBlockMain(entry, Object.assign(Object.assign({}, options), { runId }));
        if (!execute.ok) {
            return { ok: false, blockId, execute, error: execute.error };
        }
        const reviewPack = buildKsReconciliationReviewPack(runId, {});
        const approvalId = `block-review:${blockId}:${runId}`;
        const decision = yield approvalFlow.requestApproval({
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
    });
}
function autoAcceptKsReviewPack(pack) {
    return pack.findings.reduce((current, finding, index) => (reviewKsReconciliationFinding(current, {
        findingId: finding.finding_id,
        action: 'accept',
        reviewerId: 'block-review-flow',
        reviewedAt: `2026-05-15T01:0${index}:00.000Z`,
        reviewerComment: 'Auto-approved for integration test/demo path',
    })), pack);
}
