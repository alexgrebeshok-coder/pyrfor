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
export class SelfModificationValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SelfModificationValidationError';
    }
}
export class SelfModificationEngine {
    constructor(deps) {
        this.deps = deps;
        this.consecutiveFailures = 0;
        const maxFailures = this.maxConsecutiveFailures();
        if (!Number.isInteger(maxFailures) || maxFailures < 1) {
            throw new SelfModificationValidationError('maxConsecutiveFailures must be a positive integer');
        }
    }
    submit(input) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.consecutiveFailures >= this.maxConsecutiveFailures()) {
                return this.quarantine(input, 'self_modification_circuit_open', 'circuit_open');
            }
            const invalidReason = yield this.validate(input);
            if (invalidReason)
                return this.quarantine(input, invalidReason, 'quarantined');
            const approvalId = randomUUID();
            const decision = yield this.deps.approvalFlow.requestApproval({
                id: approvalId,
                toolName: 'self_modification.proposal',
                summary: input.metaMeta
                    ? 'Human approval required for meta-meta self-modification proposal'
                    : 'Human approval required for self-modification proposal',
                args: {
                    entryId: input.proposal.entryId,
                    proposalType: input.proposal.record.proposedChangeType,
                    ruleKey: input.proposal.record.targetScope.ruleKey,
                    evalArtifactId: input.evalProofRef.id,
                    rollbackPlan: input.proposal.record.rollbackPlan,
                    proposalOnly: true,
                },
                run_id: input.runId,
                concept_id: input.conceptId,
                engine_phase: 'self_improvement',
                reason_codes: ['self_modification_gate', 'human_approval_required', 'proposal_only_no_auto_apply'],
                approval_required: true,
                budget_scope: 'self_improvement',
            });
            const artifactId = yield this.writeEnvelope(input, decision === 'approve'
                ? 'proposal_only_pending_approval'
                : 'human_denied', approvalId);
            yield this.emit('self_improvement.proposal.escalated', input, {
                approval_id: approvalId,
                artifact_id: artifactId,
                reason: decision === 'approve' ? 'human_approved_proposal_only_no_auto_apply' : `human_${decision}`,
            });
            if (decision === 'approve') {
                this.consecutiveFailures = 0;
                return {
                    status: 'proposal_only_pending_approval',
                    reason: 'human_approved_proposal_only_no_auto_apply',
                    approvalId,
                    artifactId,
                };
            }
            this.consecutiveFailures += 1;
            return {
                status: 'human_denied',
                reason: `human_${decision}`,
                approvalId,
                artifactId,
            };
        });
    }
    validate(input) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!input.runId.trim())
                return 'runId_required';
            if (!input.conceptId.trim())
                return 'conceptId_required';
            if (input.proposal.schemaVersion !== 'pyrfor.improvement_proposal.v1')
                return 'invalid_schema_version';
            if (!input.proposal.record.rollbackPlan.trim())
                return 'missing_rollback_plan';
            if (!input.proposal.rollbackVerified)
                return 'rollback_not_verified';
            if (input.proposal.evalArtifactId !== input.evalProofRef.id)
                return 'eval_proof_mismatch';
            if (input.evalProofRef.kind !== 'test_result')
                return 'invalid_eval_proof:not_test_result';
            if (input.evalProofRef.runId !== input.runId)
                return 'invalid_eval_proof:run_mismatch';
            if (!input.evalProofRef.sha256)
                return 'invalid_eval_proof:missing_sha256';
            if (!(yield this.deps.artifactStore.exists(input.evalProofRef)))
                return 'invalid_eval_proof:missing_artifact';
            let proof;
            try {
                proof = yield this.deps.artifactStore.readJSONVerified(input.evalProofRef, input.evalProofRef.sha256);
            }
            catch (_a) {
                return 'invalid_eval_proof:unverified_artifact';
            }
            if (!isEvalProofBody(proof))
                return 'invalid_eval_proof:invalid_payload';
            if (proof.runId !== input.runId)
                return 'invalid_eval_proof:payload_run_mismatch';
            if (proof.subjectId !== input.proposal.record.id)
                return 'invalid_eval_proof:payload_subject_mismatch';
            if (proof.verdict !== 'pass' || proof.status !== 'passed')
                return 'invalid_eval_proof:payload_verdict_mismatch';
            return undefined;
        });
    }
    quarantine(input, reason, status) {
        return __awaiter(this, void 0, void 0, function* () {
            this.consecutiveFailures += 1;
            const artifactId = yield this.writeEnvelope(input, status, undefined, reason);
            yield this.emit('self_improvement.proposal.quarantined', input, { artifact_id: artifactId, reason });
            return { status, reason, artifactId };
        });
    }
    writeEnvelope(input, status, approvalId, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const ref = yield this.deps.artifactStore.writeJSON('improvement_proposal', {
                schemaVersion: 'pyrfor.self_modification_envelope.v1',
                proposal: input.proposal,
                evalProofRef: input.evalProofRef,
                status,
                approvalId,
                reason,
                proposalOnly: true,
                autoApply: false,
                metaMeta: input.metaMeta === true,
                generatedAt: new Date(((_a = this.deps.clock) !== null && _a !== void 0 ? _a : Date.now)()).toISOString(),
            }, {
                runId: input.runId,
                meta: {
                    conceptId: input.conceptId,
                    entryId: input.proposal.entryId,
                    status,
                },
            });
            return ref.id;
        });
    }
    emit(type, input, fields) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.deps.ledger)
                return;
            yield this.deps.ledger.append(Object.assign({ type, run_id: input.runId, concept_id: input.conceptId, entry_id: input.proposal.entryId, proposal_type: input.proposal.record.proposedChangeType }, fields));
        });
    }
    maxConsecutiveFailures() {
        var _a, _b;
        return (_b = (_a = this.deps.circuitBreaker) === null || _a === void 0 ? void 0 : _a.maxConsecutiveFailures) !== null && _b !== void 0 ? _b : 3;
    }
}
function isEvalProofBody(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const body = value;
    return (typeof body.runId === 'string' &&
        typeof body.subjectId === 'string' &&
        typeof body.verdict === 'string' &&
        typeof body.status === 'string');
}
