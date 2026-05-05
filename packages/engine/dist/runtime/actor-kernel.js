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
const DEFAULT_LEASE_TTL_MS = 5 * 60000;
const PROOF_PARENT_INACTIVE_STATUSES = new Set(['completed', 'failed', 'cancelled', 'archived']);
export class ActorKernel {
    constructor(deps) {
        this.proofFinalizationLocks = new Map();
        this.deps = deps;
    }
    spawnActor(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            const parent = yield this.requireRun(input.runId);
            const actorId = ((_a = input.actorId) === null || _a === void 0 ? void 0 : _a.trim()) || `actor-${this.id()}`;
            const childRunId = `${parent.run_id}:actor:${actorId}`;
            const existing = (_b = this.deps.runLedger.getRun(childRunId)) !== null && _b !== void 0 ? _b : yield this.deps.runLedger.replayRun(childRunId);
            if (existing)
                return { actorId, childRun: existing };
            const childRun = yield this.deps.runLedger.createRun({
                run_id: childRunId,
                parent_run_id: parent.run_id,
                workspace_id: parent.workspace_id,
                repo_id: parent.repo_id,
                branch_or_worktree_id: parent.branch_or_worktree_id,
                mode: 'autonomous',
                task_id: `actor:${input.agentId}`,
                goal: (_e = (_d = (_c = input.goal) !== null && _c !== void 0 ? _c : input.role) !== null && _d !== void 0 ? _d : input.agentName) !== null && _e !== void 0 ? _e : input.agentId,
                model_profile: parent.model_profile,
                provider_route: parent.provider_route,
                permission_profile: (_f = input.permissionProfile) !== null && _f !== void 0 ? _f : parent.permission_profile,
                budget_profile: (_g = input.budget) !== null && _g !== void 0 ? _g : parent.budget_profile,
                context_snapshot_hash: parent.context_snapshot_hash,
                prompt_snapshot_hash: parent.prompt_snapshot_hash,
            });
            yield this.appendActorEvent(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ type: 'actor.spawned', run_id: parent.run_id, actor_id: actorId, child_run_id: childRun.run_id, agent_id: input.agentId }, (input.agentName ? { agent_name: input.agentName } : {})), (input.role ? { role: input.role } : {})), (input.parentActorId ? { parent_actor_id: input.parentActorId } : {})), (input.goal ? { current_work: input.goal } : {})), (childRun.budget_profile ? { budget: childRun.budget_profile } : {})));
            return { actorId, childRun };
        });
    }
    enqueueMessage(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const run = yield this.requireRun(input.runId);
            const actorId = input.actorId.trim();
            if (!actorId)
                throw new Error('ActorKernel: actorId is required');
            const task = input.task.trim();
            if (!task)
                throw new Error('ActorKernel: task is required');
            const node = this.deps.dag.addNode(Object.assign(Object.assign(Object.assign({ kind: 'actor.mailbox.task', payload: Object.assign({ runId: run.run_id, actorId,
                    task, priority: (_a = input.priority) !== null && _a !== void 0 ? _a : 0, allowConcurrent: input.allowConcurrent === true }, (input.payload ? { payload: input.payload } : {})) }, (input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})), (((_b = input.dependsOn) === null || _b === void 0 ? void 0 : _b.length) ? { dependsOn: [...input.dependsOn] } : {})), { retryClass: 'transient', timeoutClass: 'normal', provenance: [{ kind: 'run', ref: run.run_id, role: 'input' }] }));
            yield this.appendActorEvent({
                type: 'actor.mailbox.enqueued',
                run_id: run.run_id,
                actor_id: actorId,
                node_id: node.id,
                task,
                priority: (_c = input.priority) !== null && _c !== void 0 ? _c : 0,
            });
            return node;
        });
    }
    leaseNextMessage(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const run = yield this.requireRun(input.runId);
            const busyActorIds = new Set(this.deps.dag.listNodes()
                .filter((node) => node.kind === 'actor.mailbox.task'
                && node.payload['runId'] === run.run_id
                && (node.status === 'leased' || node.status === 'running'))
                .map((node) => { var _a; return String((_a = node.payload['actorId']) !== null && _a !== void 0 ? _a : 'unknown'); }));
            const ready = this.deps.dag.listReady()
                .filter((node) => {
                var _a;
                return node.kind === 'actor.mailbox.task'
                    && node.payload['runId'] === run.run_id
                    && (!input.actorId || node.payload['actorId'] === input.actorId)
                    && (!busyActorIds.has(String((_a = node.payload['actorId']) !== null && _a !== void 0 ? _a : 'unknown')) || node.payload['allowConcurrent'] === true);
            })
                .sort((left, right) => {
                var _a, _b;
                return Number((_a = right.payload['priority']) !== null && _a !== void 0 ? _a : 0) - Number((_b = left.payload['priority']) !== null && _b !== void 0 ? _b : 0)
                    || left.createdAt - right.createdAt;
            });
            const next = ready[0];
            if (!next)
                return null;
            const leased = this.deps.dag.leaseNode(next.id, input.owner, (_a = input.ttlMs) !== null && _a !== void 0 ? _a : DEFAULT_LEASE_TTL_MS);
            const started = this.deps.dag.startNode(leased.id, input.owner);
            const actorId = String((_c = (_b = started.payload['actorId']) !== null && _b !== void 0 ? _b : input.actorId) !== null && _c !== void 0 ? _c : 'unknown');
            yield this.appendActorEvent({
                type: 'actor.mailbox.leased',
                run_id: run.run_id,
                actor_id: actorId,
                node_id: started.id,
                owner: input.owner,
                task: started.payload['task'],
            });
            yield this.appendActorEvent({
                type: 'actor.work.started',
                run_id: run.run_id,
                actor_id: actorId,
                node_id: started.id,
                owner: input.owner,
                current_work: started.payload['task'],
            });
            return { node: started };
        });
    }
    completeMessage(input) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.withProofFinalizationLock(`${input.runId}:${input.nodeId}`, () => __awaiter(this, void 0, void 0, function* () { return this.completeMessageLocked(input); }));
        });
    }
    completeMessageLocked(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const run = yield this.requireRun(input.runId);
            const node = this.requireCompletableMailboxNode(input.nodeId, run.run_id, input.owner);
            const actorId = String((_a = node.payload['actorId']) !== null && _a !== void 0 ? _a : 'unknown');
            const completed = node.status === 'succeeded'
                ? node
                : this.deps.dag.completeNode(node.id, [{
                        kind: 'run',
                        ref: run.run_id,
                        role: 'decision',
                        meta: { actorId, actorKernelKind: 'actor_completion_owner', owner: input.owner },
                    }]);
            const proofRunId = yield this.resolveProofRunId(run, actorId);
            const existingProof = completed.provenance.find((link) => { var _a; return link.kind === 'artifact' && ((_a = link.meta) === null || _a === void 0 ? void 0 : _a['artifactKind']) === 'actor_work_proof'; });
            if (existingProof) {
                const proofArtifact = yield this.findExistingProofArtifact(proofRunId, node.id, existingProof.ref);
                if (!proofArtifact) {
                    throw new Error(`ActorKernel: proof artifact "${existingProof.ref}" not found for mailbox node "${node.id}"`);
                }
                return {
                    node: completed,
                    proofArtifact,
                    alreadyFinalized: true,
                };
            }
            const existingArtifact = yield this.findExistingProofArtifact(proofRunId, node.id);
            const artifact = existingArtifact !== null && existingArtifact !== void 0 ? existingArtifact : yield this.deps.artifactStore.writeJSON('summary', Object.assign(Object.assign(Object.assign({ schemaVersion: 'pyrfor.actor_work_proof.v1', runId: run.run_id, proofRunId,
                actorId, nodeId: node.id, task: node.payload['task'], completedAt: this.nowIso(), owner: input.owner }, (input.summary ? { summary: input.summary } : {})), (input.output ? { output: input.output } : {})), (input.proof ? { proof: input.proof } : {})), {
                runId: proofRunId,
                meta: { artifactKind: 'actor_work_proof', parentRunId: run.run_id, actorId, nodeId: node.id, owner: input.owner },
            });
            yield this.deps.runLedger.recordArtifact(proofRunId, artifact.id);
            const completedWithProof = this.deps.dag.addProvenance(completed.id, Object.assign(Object.assign({ kind: 'artifact', ref: artifact.id, role: 'evidence' }, (artifact.sha256 ? { sha256: artifact.sha256 } : {})), { meta: { actorId, artifactKind: 'actor_work_proof', owner: input.owner } }));
            yield this.appendActorEvent(Object.assign(Object.assign({ type: 'actor.mailbox.completed', run_id: run.run_id, actor_id: actorId, node_id: completed.id, artifact_id: artifact.id }, (input.summary ? { summary: input.summary } : {})), (input.output ? { output: input.output } : {})));
            yield this.appendActorEvent(Object.assign(Object.assign({ type: 'actor.work.completed', run_id: run.run_id, actor_id: actorId, node_id: completed.id, artifact_id: artifact.id }, (input.summary ? { summary: input.summary } : {})), (input.output ? { output: input.output } : {})));
            return { node: completedWithProof, proofArtifact: artifact };
        });
    }
    failMessage(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const run = yield this.requireRun(input.runId);
            const node = this.requireLeasedMailboxNode(input.nodeId, run.run_id, input.owner);
            const actorId = String((_a = node.payload['actorId']) !== null && _a !== void 0 ? _a : 'unknown');
            const failed = this.deps.dag.failNode(node.id, input.reason, (_b = input.retryable) !== null && _b !== void 0 ? _b : false);
            yield this.appendActorEvent({
                type: 'actor.mailbox.failed',
                run_id: run.run_id,
                actor_id: actorId,
                node_id: failed.id,
                reason: input.reason,
                retryable: (_c = input.retryable) !== null && _c !== void 0 ? _c : false,
            });
            if (!input.retryable) {
                yield this.appendActorEvent({
                    type: 'actor.failed',
                    run_id: run.run_id,
                    actor_id: actorId,
                    node_id: failed.id,
                    reason: input.reason,
                    retryable: false,
                });
            }
            return failed;
        });
    }
    recoverStuckMessages(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            if (!Number.isFinite(input.olderThanMs) || input.olderThanMs <= 0) {
                throw new Error('ActorKernel: olderThanMs must be a positive number');
            }
            const run = yield this.requireRun(input.runId);
            const now = this.nowMs();
            const reason = ((_a = input.reason) === null || _a === void 0 ? void 0 : _a.trim()) || 'supervisor_stuck_actor';
            const candidates = this.deps.dag.listNodes()
                .filter((node) => {
                var _a, _b;
                return node.kind === 'actor.mailbox.task'
                    && node.payload['runId'] === run.run_id
                    && (node.status === 'leased' || node.status === 'running')
                    && (!input.actorId || node.payload['actorId'] === input.actorId)
                    && now - ((_b = (_a = node.lease) === null || _a === void 0 ? void 0 : _a.leasedAt) !== null && _b !== void 0 ? _b : node.updatedAt) >= input.olderThanMs;
            })
                .sort((left, right) => left.updatedAt - right.updatedAt);
            const recovered = [];
            for (const node of candidates) {
                const actorId = String((_c = (_b = node.payload['actorId']) !== null && _b !== void 0 ? _b : input.actorId) !== null && _c !== void 0 ? _c : 'unknown');
                const recoveredNode = this.deps.dag.failNode(node.id, reason, true);
                recovered.push(recoveredNode);
                yield this.appendActorEvent({
                    type: 'actor.mailbox.failed',
                    run_id: run.run_id,
                    actor_id: actorId,
                    node_id: recoveredNode.id,
                    reason,
                    retryable: true,
                    recovered: true,
                    previous_owner: (_d = node.lease) === null || _d === void 0 ? void 0 : _d.owner,
                });
            }
            return { recovered };
        });
    }
    requireRun(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const run = (_a = this.deps.runLedger.getRun(runId)) !== null && _a !== void 0 ? _a : yield this.deps.runLedger.replayRun(runId);
            if (!run)
                throw new Error(`ActorKernel: run "${runId}" not found`);
            return run;
        });
    }
    requireMailboxNode(nodeId, runId) {
        const node = this.deps.dag.getNode(nodeId);
        if (!node || node.kind !== 'actor.mailbox.task' || node.payload['runId'] !== runId) {
            throw new Error(`ActorKernel: actor mailbox node "${nodeId}" not found for run "${runId}"`);
        }
        return node;
    }
    requireLeasedMailboxNode(nodeId, runId, owner) {
        var _a;
        const node = this.requireMailboxNode(nodeId, runId);
        if (node.status !== 'leased' && node.status !== 'running') {
            throw new Error(`ActorKernel: actor mailbox node "${nodeId}" is not leased`);
        }
        if (((_a = node.lease) === null || _a === void 0 ? void 0 : _a.owner) !== owner) {
            throw new Error(`ActorKernel: mailbox node "${nodeId}" is leased by another owner`);
        }
        return node;
    }
    requireCompletableMailboxNode(nodeId, runId, owner) {
        var _a;
        const node = this.requireMailboxNode(nodeId, runId);
        if (node.status === 'succeeded') {
            const completionOwner = this.getCompletionOwner(node);
            if (completionOwner !== owner) {
                throw new Error(`ActorKernel: mailbox node "${nodeId}" was completed by another owner`);
            }
            return node;
        }
        if (node.status !== 'leased' && node.status !== 'running') {
            throw new Error(`ActorKernel: actor mailbox node "${nodeId}" is not leased`);
        }
        if (((_a = node.lease) === null || _a === void 0 ? void 0 : _a.owner) !== owner) {
            throw new Error(`ActorKernel: mailbox node "${nodeId}" is leased by another owner`);
        }
        return node;
    }
    findExistingProofArtifact(runId, nodeId, artifactId) {
        return __awaiter(this, void 0, void 0, function* () {
            const artifacts = yield this.deps.artifactStore.list({ runId, kind: 'summary' });
            return artifacts.find((artifact) => {
                var _a, _b;
                return ((_a = artifact.meta) === null || _a === void 0 ? void 0 : _a['artifactKind']) === 'actor_work_proof'
                    && ((_b = artifact.meta) === null || _b === void 0 ? void 0 : _b['nodeId']) === nodeId
                    && (!artifactId || artifact.id === artifactId);
            });
        });
    }
    resolveProofRunId(parentRun, actorId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!PROOF_PARENT_INACTIVE_STATUSES.has(parentRun.status))
                return parentRun.run_id;
            const childRunId = `${parentRun.run_id}:actor:${actorId}`;
            const childRun = (_a = this.deps.runLedger.getRun(childRunId)) !== null && _a !== void 0 ? _a : yield this.deps.runLedger.replayRun(childRunId);
            if (!childRun) {
                throw new Error(`ActorKernel: actor child run "${childRunId}" not found for proof recording`);
            }
            return childRun.run_id;
        });
    }
    getCompletionOwner(node) {
        var _a;
        const ownerLink = [...node.provenance].reverse().find((link) => { var _a; return ((_a = link.meta) === null || _a === void 0 ? void 0 : _a['actorKernelKind']) === 'actor_completion_owner'; });
        return typeof ((_a = ownerLink === null || ownerLink === void 0 ? void 0 : ownerLink.meta) === null || _a === void 0 ? void 0 : _a['owner']) === 'string' ? ownerLink.meta['owner'] : undefined;
    }
    withProofFinalizationLock(key, operation) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const previous = (_a = this.proofFinalizationLocks.get(key)) !== null && _a !== void 0 ? _a : Promise.resolve();
            let release;
            const current = new Promise((resolve) => {
                release = resolve;
            });
            const next = previous.catch(() => undefined).then(() => current);
            this.proofFinalizationLocks.set(key, next);
            yield previous.catch(() => undefined);
            try {
                return yield operation();
            }
            finally {
                release();
                if (this.proofFinalizationLocks.get(key) === next) {
                    this.proofFinalizationLocks.delete(key);
                }
            }
        });
    }
    appendActorEvent(event) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.deps.eventLedger.append(event);
        });
    }
    nowIso() {
        var _a;
        return ((_a = this.deps.now) !== null && _a !== void 0 ? _a : (() => new Date()))().toISOString();
    }
    nowMs() {
        var _a;
        return ((_a = this.deps.now) !== null && _a !== void 0 ? _a : (() => new Date()))().getTime();
    }
    id() {
        var _a, _b, _c;
        return (_c = (_b = (_a = this.deps).idFactory) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : randomUUID();
    }
}
export function createActorKernel(deps) {
    return new ActorKernel(deps);
}
