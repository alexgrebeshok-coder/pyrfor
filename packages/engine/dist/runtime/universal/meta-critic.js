var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from 'node:crypto';
import { promoteDoubleLoop, quarantineDoubleLoop } from './memory/historian-writer.js';
import { assertMetaCriticRunBudget } from '../si-run-budget-guard.js';
export const AUTONOMOUS_ELIGIBLE_TYPES = new Set(['algorithm', 'heuristic']);
export const ALWAYS_HUMAN_TYPES = new Set(['policy', 'budget', 'verifier_rules']);
export class MetaCriticValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MetaCriticValidationError';
    }
}
export class MetaCritic {
    constructor(deps) {
        this.deps = deps;
    }
    run(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!input.runId.trim())
                throw new MetaCriticValidationError('runId is required');
            if (this.deps.runBudgetGuard) {
                yield assertMetaCriticRunBudget(this.deps.runBudgetGuard, input.runId);
            }
            const maxProposals = (_a = input.maxProposals) !== null && _a !== void 0 ? _a : 5;
            if (!Number.isInteger(maxProposals) || maxProposals < 1) {
                throw new MetaCriticValidationError('maxProposals must be a positive integer');
            }
            const candidates = this.findCandidateEntries(input.ruleKeys);
            const result = {
                evaluated: 0,
                promoted: 0,
                quarantined: 0,
                escalated: 0,
                proposalArtifactIds: [],
            };
            for (const entry of candidates) {
                if (result.evaluated >= maxProposals)
                    break;
                let proposal;
                try {
                    proposal = yield this.evaluateEntryCore(entry.id, input.runId, input.conceptId);
                }
                catch (error) {
                    if (!(error instanceof MetaCriticValidationError))
                        throw error;
                    yield this.quarantineMalformedCandidate(entry, input.runId, input.conceptId, error.message);
                    result.quarantined += 1;
                    continue;
                }
                result.evaluated += 1;
                if (proposal.decision === 'promoted')
                    result.promoted += 1;
                if (proposal.decision === 'quarantined')
                    result.quarantined += 1;
                if (proposal.decision === 'escalated_to_human')
                    result.escalated += 1;
                if (proposal.artifactId)
                    result.proposalArtifactIds.push(proposal.artifactId);
            }
            return result;
        });
    }
    evaluateEntry(entryId, runId, conceptId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.evaluateEntryCore(entryId, runId, conceptId);
        });
    }
    evaluateEntryCore(entryId, runId, conceptId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!entryId.trim())
                throw new MetaCriticValidationError('entryId is required');
            if (!runId.trim())
                throw new MetaCriticValidationError('runId is required');
            const entry = this.deps.memoryStore.get(entryId);
            if (!entry)
                throw new MetaCriticValidationError(`double-loop entry not found: ${entryId}`);
            const record = parseCandidateDoubleLoop(entry);
            if (ALWAYS_HUMAN_TYPES.has(record.proposedChangeType)) {
                const approvalId = randomUUID();
                yield this.deps.approvalFlow.requestApproval({
                    id: approvalId,
                    toolName: 'self_improvement.proposal',
                    summary: `Human approval required for ${record.proposedChangeType} self-improvement`,
                    args: {
                        entryId,
                        proposedChangeType: record.proposedChangeType,
                        ruleKey: record.targetScope.ruleKey,
                        proposedRule: record.targetScope.proposedRule,
                    },
                    run_id: runId,
                    concept_id: conceptId !== null && conceptId !== void 0 ? conceptId : record.context.conceptId,
                    engine_phase: 'self_improvement',
                    reason_codes: ['policy_change_requires_human', 'self_improvement_gate'],
                });
                const proposal = yield this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
                    decision: 'escalated_to_human',
                    decisionReason: 'policy_change_requires_human',
                    rollbackVerified: false,
                    approvalId,
                }));
                this.markPendingApproval(entry, record, approvalId);
                yield this.deps.ledger.append({
                    type: 'self_improvement.proposal.escalated',
                    run_id: runId,
                    concept_id: conceptId !== null && conceptId !== void 0 ? conceptId : record.context.conceptId,
                    entry_id: entryId,
                    proposal_type: record.proposedChangeType,
                    approval_id: approvalId,
                    artifact_id: proposal.artifactId,
                    reason: 'policy_change_requires_human',
                });
                return proposal;
            }
            if (!AUTONOMOUS_ELIGIBLE_TYPES.has(record.proposedChangeType)) {
                throw new MetaCriticValidationError(`unsupported proposedChangeType: ${record.proposedChangeType}`);
            }
            if (!record.rollbackPlan.trim()) {
                const proposal = yield this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
                    decision: 'quarantined',
                    decisionReason: 'missing_rollback_plan',
                    rollbackVerified: false,
                }));
                yield quarantineDoubleLoop(entryId, 'missing_rollback_plan', this.deps);
                yield this.deps.ledger.append({
                    type: 'self_improvement.proposal.quarantined',
                    run_id: runId,
                    concept_id: conceptId !== null && conceptId !== void 0 ? conceptId : record.context.conceptId,
                    entry_id: entryId,
                    proposal_type: record.proposedChangeType,
                    artifact_id: proposal.artifactId,
                    reason: 'missing_rollback_plan',
                });
                return proposal;
            }
            if (this.hasRejectedDuplicate(record, entryId)) {
                const proposal = yield this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
                    decision: 'quarantined',
                    decisionReason: 'thrash_guard_near_duplicate',
                    rollbackVerified: true,
                }));
                yield quarantineDoubleLoop(entryId, 'thrash_guard_near_duplicate', this.deps);
                yield this.deps.ledger.append({
                    type: 'self_improvement.proposal.quarantined',
                    run_id: runId,
                    concept_id: conceptId !== null && conceptId !== void 0 ? conceptId : record.context.conceptId,
                    entry_id: entryId,
                    proposal_type: record.proposedChangeType,
                    artifact_id: proposal.artifactId,
                    reason: 'thrash_guard_near_duplicate',
                });
                return proposal;
            }
            const report = yield this.deps.acceptanceTester.run(this.deps.buildEvalSuite(record, runId));
            yield this.deps.ledger.append({
                type: 'self_improvement.proposal.evaluated',
                run_id: runId,
                concept_id: conceptId !== null && conceptId !== void 0 ? conceptId : record.context.conceptId,
                entry_id: entryId,
                proposal_type: record.proposedChangeType,
                eval_verdict: report.verdict,
                artifact_id: report.artifactId,
            });
            const invalidProofReason = report.verdict === 'pass'
                ? yield this.validateEvaluationProof(report, runId, record)
                : undefined;
            if (report.verdict === 'pass' && invalidProofReason === undefined) {
                const proposal = yield this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
                    decision: 'promoted',
                    decisionReason: 'eval_passed',
                    rollbackVerified: true,
                    evalArtifactId: report.artifactId,
                }));
                yield promoteDoubleLoop(entryId, 'meta-critic', this.deps);
                yield this.deps.ledger.append({
                    type: 'self_improvement.proposal.promoted',
                    run_id: runId,
                    concept_id: conceptId !== null && conceptId !== void 0 ? conceptId : record.context.conceptId,
                    entry_id: entryId,
                    proposal_type: record.proposedChangeType,
                    eval_verdict: report.verdict,
                    artifact_id: report.artifactId,
                    approved_by: 'meta-critic',
                });
                return proposal;
            }
            const decisionReason = invalidProofReason !== null && invalidProofReason !== void 0 ? invalidProofReason : `eval_failed:${report.verdict}`;
            const proposal = yield this.writeProposal(runId, conceptId, this.proposal(entryId, record, {
                decision: 'quarantined',
                decisionReason,
                rollbackVerified: true,
                evalArtifactId: report.artifactId,
            }));
            yield quarantineDoubleLoop(entryId, decisionReason, this.deps);
            yield this.deps.ledger.append({
                type: 'self_improvement.proposal.quarantined',
                run_id: runId,
                concept_id: conceptId !== null && conceptId !== void 0 ? conceptId : record.context.conceptId,
                entry_id: entryId,
                proposal_type: record.proposedChangeType,
                eval_verdict: report.verdict,
                artifact_id: report.artifactId,
                reason: decisionReason,
            });
            return proposal;
        });
    }
    findCandidateEntries(ruleKeys) {
        return this.deps.memoryStore.query({
            kind: 'lesson',
            tags: ['double_loop', 'candidate'],
            limit: 100,
        }).filter((entry) => {
            if (!(ruleKeys === null || ruleKeys === void 0 ? void 0 : ruleKeys.length))
                return true;
            let record;
            try {
                record = parseCandidateDoubleLoop(entry);
            }
            catch (_a) {
                return false;
            }
            return ruleKeys.includes(record.targetScope.ruleKey);
        });
    }
    hasRejectedDuplicate(record, currentEntryId) {
        if (!record.requiresNovelEvidenceAfterRejection)
            return false;
        return this.deps.memoryStore.query({
            kind: 'lesson',
            tags: ['double_loop', 'quarantined'],
            limit: 100,
        }).some((entry) => {
            if (entry.id === currentEntryId)
                return false;
            try {
                return JSON.parse(entry.text).similarityKey === record.similarityKey;
            }
            catch (_a) {
                return false;
            }
        });
    }
    proposal(entryId, record, fields) {
        var _a;
        return Object.assign({ schemaVersion: 'pyrfor.improvement_proposal.v1', entryId,
            record, evaluatedAt: new Date(((_a = this.deps.clock) !== null && _a !== void 0 ? _a : Date.now)()).toISOString() }, fields);
    }
    writeProposal(runId, conceptId, proposal) {
        return __awaiter(this, void 0, void 0, function* () {
            const ref = yield this.deps.artifactStore.writeJSON('improvement_proposal', proposal, {
                runId,
                meta: Object.assign({ entryId: proposal.entryId, decision: proposal.decision }, (conceptId ? { conceptId } : {})),
            });
            return Object.assign(Object.assign({}, proposal), { artifactId: ref.id });
        });
    }
    quarantineMalformedCandidate(entry, runId, conceptId, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            const nextTags = new Set(entry.tags.filter((tag) => tag !== 'candidate'));
            nextTags.add('quarantined');
            nextTags.add('malformed_double_loop');
            this.deps.memoryStore.update(entry.id, {
                tags: [...nextTags],
                weight: Math.min(entry.weight, 0.1),
            });
            yield this.deps.ledger.append(Object.assign(Object.assign({ type: 'self_improvement.proposal.quarantined', run_id: runId }, (conceptId ? { concept_id: conceptId } : {})), { entry_id: entry.id, reason: `malformed_candidate:${reason}` }));
        });
    }
    markPendingApproval(entry, record, approvalId) {
        const nextRecord = Object.assign(Object.assign({}, record), { status: 'pending_approval', approvalFlowRef: approvalId });
        const nextTags = new Set(entry.tags.filter((tag) => tag !== 'candidate'));
        nextTags.add('pending_approval');
        nextTags.add('escalated');
        const updated = this.deps.memoryStore.update(entry.id, {
            text: JSON.stringify(nextRecord),
            tags: [...nextTags],
        });
        if (!updated)
            throw new MetaCriticValidationError(`failed to mark entry pending approval: ${entry.id}`);
    }
    validateEvaluationProof(report, runId, record) {
        return __awaiter(this, void 0, void 0, function* () {
            if (report.runId !== runId)
                return 'invalid_eval_proof:run_mismatch';
            if (report.subjectId !== record.id)
                return 'invalid_eval_proof:subject_mismatch';
            if (report.status !== 'passed')
                return 'invalid_eval_proof:status_mismatch';
            if (report.artifactId !== report.artifactRef.id)
                return 'invalid_eval_proof:artifact_mismatch';
            if (report.artifactRef.kind !== 'test_result')
                return 'invalid_eval_proof:not_test_result';
            if (report.artifactRef.runId !== runId)
                return 'invalid_eval_proof:artifact_run_mismatch';
            if (!report.artifactRef.sha256)
                return 'invalid_eval_proof:missing_sha256';
            if (!(yield this.deps.artifactStore.exists(report.artifactRef)))
                return 'invalid_eval_proof:missing_artifact';
            let proof;
            try {
                proof = JSON.parse((yield this.deps.artifactStore.readVerified(report.artifactRef, report.artifactRef.sha256)).toString('utf-8'));
            }
            catch (_a) {
                return 'invalid_eval_proof:unverified_artifact';
            }
            if (!isAcceptanceProofBody(proof))
                return 'invalid_eval_proof:invalid_payload';
            if (proof.runId !== runId)
                return 'invalid_eval_proof:payload_run_mismatch';
            if (proof.subjectId !== record.id)
                return 'invalid_eval_proof:payload_subject_mismatch';
            if (proof.suiteId !== report.suiteId)
                return 'invalid_eval_proof:payload_suite_mismatch';
            if (proof.verdict !== 'pass' || proof.status !== 'passed')
                return 'invalid_eval_proof:payload_verdict_mismatch';
            return undefined;
        });
    }
}
function isAcceptanceProofBody(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const body = value;
    return (typeof body.suiteId === 'string' &&
        typeof body.runId === 'string' &&
        typeof body.subjectId === 'string' &&
        typeof body.verdict === 'string' &&
        typeof body.status === 'string');
}
function parseCandidateDoubleLoop(entry) {
    if (entry.kind !== 'lesson' || !entry.tags.includes('double_loop') || !entry.tags.includes('candidate')) {
        throw new MetaCriticValidationError(`entry is not a candidate double-loop lesson: ${entry.id}`);
    }
    const parsed = JSON.parse(entry.text);
    if (parsed.kind !== 'double_loop' ||
        typeof parsed.id !== 'string' ||
        parsed.status !== 'candidate' ||
        typeof parsed.proposedChangeType !== 'string' ||
        typeof parsed.rollbackPlan !== 'string' ||
        typeof parsed.similarityKey !== 'string' ||
        parsed.targetScope === undefined ||
        typeof parsed.targetScope.ruleKey !== 'string' ||
        typeof parsed.targetScope.proposedRule !== 'string' ||
        parsed.context === undefined ||
        typeof parsed.context.runId !== 'string') {
        throw new MetaCriticValidationError(`entry does not contain a valid candidate double-loop record: ${entry.id}`);
    }
    return parsed;
}
