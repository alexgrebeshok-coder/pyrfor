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
import { CircuitOpenError, getCircuitBreaker } from '../../ai/circuit-breaker.js';
import { assertOptimizerTargetEditable } from './optimizer-specializations.js';
export class SelfModificationValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SelfModificationValidationError';
    }
}
export class SelfModificationEngine {
    constructor(deps) {
        var _a;
        this.deps = deps;
        this.circuitBreaker = (_a = deps.circuitBreaker) !== null && _a !== void 0 ? _a : getCircuitBreaker('self_modification_engine', {
            failureThreshold: 3,
            resetTimeout: 3600000,
            halfOpenMax: 1,
            executionTimeoutMs: 45000,
        });
    }
    metaOptimize(input) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.validate(input);
            try {
                assertOptimizerTargetEditable(input.proposal.record.targetScope.ruleKey);
            }
            catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                yield this.emitMetaChange('self_improvement.meta_change.protected_target_rejected', input, { reason });
                try {
                    yield this.tripCircuit(reason);
                }
                catch (circuitError) {
                    if (circuitError instanceof CircuitOpenError) {
                        yield this.escalateCircuitOpen(input.runId, input.conceptId, circuitError.message);
                        throw circuitError;
                    }
                    throw circuitError;
                }
                throw new SelfModificationValidationError(reason);
            }
            try {
                return yield this.circuitBreaker.execute(() => this.writeAndEnqueue(input));
            }
            catch (error) {
                if (error instanceof CircuitOpenError) {
                    yield this.escalateCircuitOpen(input.runId, input.conceptId, error.message);
                }
                throw error;
            }
        });
    }
    recordMetaChangeRejection(runId, conceptId, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.tripCircuit(reason);
            }
            catch (error) {
                if (error instanceof CircuitOpenError) {
                    yield this.escalateCircuitOpen(runId, conceptId, error.message);
                }
            }
        });
    }
    writeAndEnqueue(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const approvalId = randomUUID();
            const ref = yield this.deps.artifactStore.writeJSON('governance_adjustment_proposal', {
                schemaVersion: 'pyrfor.self_modification_envelope.v2',
                proposal: input.proposal,
                projectId: input.projectId,
                evalProofRef: input.evalProofRef,
                decisionRecordRef: input.decisionRecordRef,
                completionGateResultRef: input.completionGateResultRef,
                approvalId,
                status: 'pending_human_approval',
                proposalOnly: true,
                autoApply: false,
                metaMeta: input.metaMeta === true,
                generatedAt: new Date(((_a = this.deps.clock) !== null && _a !== void 0 ? _a : Date.now)()).toISOString(),
            }, {
                runId: input.runId,
                meta: {
                    conceptId: input.conceptId,
                    entryId: input.proposal.entryId,
                    approvalId,
                    status: 'pending_human_approval',
                },
            });
            yield this.emitMetaChange('self_improvement.meta_change.proposed', input, {
                approval_id: approvalId,
                artifact_id: ref.id,
                reason: 'proposal_only_no_auto_apply',
            });
            yield this.deps.approvalFlow.enqueueApproval({
                id: approvalId,
                toolName: 'self_modification.meta_change',
                summary: input.metaMeta
                    ? `Human approval required for meta-meta self-modification proposal: ${input.proposal.record.targetScope.ruleKey}`
                    : `Human approval required for self-modification proposal: ${input.proposal.record.targetScope.ruleKey}`,
                args: {
                    entryId: input.proposal.entryId,
                    proposalType: input.proposal.record.proposedChangeType,
                    ruleKey: input.proposal.record.targetScope.ruleKey,
                    evalProofArtifactId: input.evalProofRef.id,
                    decisionRecordArtifactId: input.decisionRecordRef.id,
                    completionGateResultArtifactId: input.completionGateResultRef.id,
                    rollbackPlan: input.proposal.record.rollbackPlan,
                    proposalOnly: true,
                    autoApply: false,
                },
                run_id: input.runId,
                concept_id: input.conceptId,
                engine_phase: 'self_improvement',
                reason_codes: ['self_modification_gate', 'human_approval_required', 'proposal_only_no_auto_apply'],
                approval_required: true,
                budget_scope: 'self_improvement',
            });
            return {
                status: 'pending_human_approval',
                reason: 'proposal_only_no_auto_apply',
                approvalId,
                artifactId: ref.id,
            };
        });
    }
    validate(input) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!input.runId.trim())
                throw new SelfModificationValidationError('runId is required');
            if (!input.conceptId.trim())
                throw new SelfModificationValidationError('conceptId is required');
            if (input.conceptKind !== 'meta.improvement') {
                throw new SelfModificationValidationError('SelfModificationEngine must run as a meta.improvement concept');
            }
            if (!input.projectId.trim() || input.projectId === '*') {
                throw new SelfModificationValidationError('projectId is required and cannot be wildcard');
            }
            if (input.proposal.schemaVersion !== 'pyrfor.improvement_proposal.v1') {
                throw new SelfModificationValidationError('invalid proposal schema version');
            }
            if (!input.proposal.record.rollbackPlan.trim())
                throw new SelfModificationValidationError('rollbackPlan is required');
            if (!input.proposal.rollbackVerified)
                throw new SelfModificationValidationError('rollback must be verified');
            if (input.proposal.evalArtifactId !== input.evalProofRef.id) {
                throw new SelfModificationValidationError('eval proof artifact mismatch');
            }
            yield this.validateArtifactRef(input.evalProofRef, input.runId, 'test_result');
            yield this.validateArtifactRef(input.decisionRecordRef, input.runId, 'decision_record');
            yield this.validateArtifactRef(input.completionGateResultRef, input.runId, 'gate_check_report');
            const proof = yield this.deps.artifactStore.readJSONVerified(input.evalProofRef, input.evalProofRef.sha256);
            if (!isEvalProofBody(proof))
                throw new SelfModificationValidationError('invalid eval proof payload');
            if (proof.runId !== input.runId)
                throw new SelfModificationValidationError('eval proof run mismatch');
            if (proof.subjectId !== input.proposal.record.id)
                throw new SelfModificationValidationError('eval proof subject mismatch');
            if (proof.verdict !== 'pass' || proof.status !== 'passed') {
                throw new SelfModificationValidationError('eval proof did not pass');
            }
        });
    }
    validateArtifactRef(ref, runId, kind) {
        return __awaiter(this, void 0, void 0, function* () {
            if (ref.kind !== kind)
                throw new SelfModificationValidationError(`${kind} artifact is required`);
            if (ref.runId !== runId)
                throw new SelfModificationValidationError(`${kind} run mismatch`);
            if (!ref.sha256)
                throw new SelfModificationValidationError(`${kind} missing sha256`);
            if (!(yield this.deps.artifactStore.exists(ref)))
                throw new SelfModificationValidationError(`${kind} artifact missing`);
        });
    }
    tripCircuit(reason) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.circuitBreaker.execute(() => __awaiter(this, void 0, void 0, function* () {
                throw new SelfModificationValidationError(reason);
            }));
        });
    }
    escalateCircuitOpen(runId, conceptId, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            const approvalId = randomUUID();
            yield this.deps.ledger.append({
                type: 'self_improvement.meta_change.circuit_open',
                run_id: runId,
                concept_id: conceptId,
                approval_id: approvalId,
                reason,
            });
            yield this.deps.approvalFlow.enqueueApproval({
                id: approvalId,
                toolName: 'self_modification.circuit_open',
                summary: `Self-modification circuit is open: ${reason}`,
                args: { reason, proposalOnly: true },
                run_id: runId,
                concept_id: conceptId,
                engine_phase: 'self_improvement',
                reason_codes: ['self_modification_circuit_open', 'human_approval_required'],
                approval_required: true,
                budget_scope: 'self_improvement',
            });
        });
    }
    emitMetaChange(type, input, fields) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.deps.ledger.append(Object.assign({ type, run_id: input.runId, concept_id: input.conceptId, proposal_id: input.proposal.entryId, target_key: input.proposal.record.targetScope.ruleKey }, fields));
        });
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
