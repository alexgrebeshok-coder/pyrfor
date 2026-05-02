/**
 * verifier-lane.ts - independent verifier and deterministic eval harness.
 *
 * Worker self-reports are inputs. This lane owns the verdict that decides
 * pass/rework/block/user-review for orchestration.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DurableDag } from './durable-dag.js';
import { createQualityGate, } from './quality-gate.js';
import { createSessionRecorder } from './session-replay.js';
import { runValidators, } from './step-validator.js';
import { runVerify } from './verify-engine.js';
const STATUS_RANK = {
    passed: 0,
    warning: 1,
    waived: 2,
    failed: 3,
    blocked: 4,
};
export class VerifierLane {
    constructor(options) {
        var _a, _b, _c, _d, _e, _f;
        this.ledger = options.ledger;
        this.runLedger = options.runLedger;
        this.validators = (_a = options.validators) !== null && _a !== void 0 ? _a : [];
        this.qualityGate = (_b = options.qualityGate) !== null && _b !== void 0 ? _b : createQualityGate({ sessionId: 'verifier-lane' });
        this.replayStoreDir = options.replayStoreDir;
        this.dagStorePath = options.dagStorePath;
        this.workspaceId = (_c = options.workspaceId) !== null && _c !== void 0 ? _c : 'verifier-workspace';
        this.repoId = (_d = options.repoId) !== null && _d !== void 0 ? _d : 'verifier-repo';
        this.owner = (_e = options.owner) !== null && _e !== void 0 ? _e : 'verifier-lane';
        this.leaseTtlMs = (_f = options.leaseTtlMs) !== null && _f !== void 0 ? _f : 60000;
    }
    verify(subject, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.verifyWith(subject, ctx);
        });
    }
    run(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
            const replayStoreDir = (_a = input.replayStoreDir) !== null && _a !== void 0 ? _a : this.replayStoreDir;
            if (!replayStoreDir) {
                throw new Error('VerifierLane: replayStoreDir is required to persist raw ACP replay artifacts');
            }
            const verifierRunId = (_b = input.verifierRunId) !== null && _b !== void 0 ? _b : `${input.parentRunId}:verifier`;
            const workspaceId = (_c = input.workspaceId) !== null && _c !== void 0 ? _c : this.workspaceId;
            const repoId = (_d = input.repoId) !== null && _d !== void 0 ? _d : this.repoId;
            const owner = (_e = input.owner) !== null && _e !== void 0 ? _e : this.owner;
            const leaseTtlMs = (_f = input.leaseTtlMs) !== null && _f !== void 0 ? _f : this.leaseTtlMs;
            const validators = (_g = input.validators) !== null && _g !== void 0 ? _g : this.validators;
            const qualityGate = (_h = input.qualityGate) !== null && _h !== void 0 ? _h : this.qualityGate;
            yield this.createVerifierRun({
                verifierRunId,
                parentRunId: input.parentRunId,
                workspaceId,
                repoId,
            });
            const replayArtifact = yield this.persistAcpReplay({
                verifierRunId,
                parentRunId: input.parentRunId,
                replayStoreDir,
                acpEvents: input.acpEvents,
            });
            const dag = new DurableDag({
                storePath: (_j = input.dagStorePath) !== null && _j !== void 0 ? _j : this.dagStorePath,
                ledger: this.ledger,
                ledgerRunId: verifierRunId,
                dagId: `${verifierRunId}:verification`,
            });
            const replayNode = dag.addNode({
                id: 'replay',
                kind: 'verifier.replay',
                payload: { eventCount: input.acpEvents.length },
                idempotencyKey: `${verifierRunId}:replay`,
                retryClass: 'deterministic',
                provenance: [
                    { kind: 'run', ref: input.parentRunId, role: 'input' },
                    { kind: 'artifact', ref: replayArtifact.ref, role: 'input', sha256: replayArtifact.sha256 },
                ],
            });
            dag.addNode({
                id: 'eval',
                kind: 'verifier.eval',
                dependsOn: [replayNode.id],
                payload: { validators: validators.map((validator) => validator.name) },
                idempotencyKey: `${verifierRunId}:eval`,
                retryClass: 'deterministic',
            });
            dag.leaseNode('replay', owner, leaseTtlMs);
            dag.startNode('replay', owner);
            dag.completeNode('replay', [
                { kind: 'artifact', ref: replayArtifact.ref, role: 'evidence', sha256: replayArtifact.sha256 },
            ]);
            dag.leaseNode('eval', owner, leaseTtlMs);
            dag.startNode('eval', owner);
            const steps = [];
            for (let index = 0; index < input.acpEvents.length; index += 1) {
                const event = input.acpEvents[index];
                const report = yield this.verifyWith({
                    runId: verifierRunId,
                    subjectId: `${input.parentRunId}:acp:${index}`,
                    subjectType: 'acp_event',
                    event,
                }, { cwd: input.cwd }, { validators, qualityGate });
                steps.push(Object.assign(Object.assign({}, report), { eventIndex: index, eventType: String(event.type) }));
            }
            const verifyResult = input.verifyChecks
                ? yield runVerify(input.verifyChecks, { cwd: input.cwd })
                : undefined;
            if (verifyResult) {
                yield ((_k = this.ledger) === null || _k === void 0 ? void 0 : _k.append({
                    type: 'test.completed',
                    run_id: verifierRunId,
                    status: verifyResult.passed ? 'passed' : 'failed',
                    passed: verifyResult.checks.filter((check) => check.passed).length,
                    failed: verifyResult.checks.filter((check) => !check.passed).length,
                    skipped: 0,
                    ms: verifyResult.checks.reduce((sum, check) => sum + check.durationMs, 0),
                }));
            }
            const status = combineStatuses([
                ...steps.map((step) => step.status),
                verifyResult && !verifyResult.passed ? 'failed' : 'passed',
            ]);
            if (status === 'passed' || status === 'warning') {
                dag.completeNode('eval', [
                    { kind: 'artifact', ref: replayArtifact.ref, role: 'evidence', sha256: replayArtifact.sha256 },
                ]);
                yield ((_l = this.runLedger) === null || _l === void 0 ? void 0 : _l.completeRun(verifierRunId, 'completed', `verifier ${status}`));
            }
            else {
                dag.failNode('eval', `verifier ${status}`, false);
                if (status === 'blocked') {
                    yield ((_m = this.runLedger) === null || _m === void 0 ? void 0 : _m.blockRun(verifierRunId, `verifier ${status}`));
                }
                else {
                    yield ((_o = this.runLedger) === null || _o === void 0 ? void 0 : _o.completeRun(verifierRunId, 'failed', `verifier ${status}`));
                }
            }
            yield dag.flushLedger();
            const reconstructedRun = yield ((_p = this.runLedger) === null || _p === void 0 ? void 0 : _p.replayRun(verifierRunId));
            return {
                parentRunId: input.parentRunId,
                verifierRunId,
                status,
                replayArtifactRef: replayArtifact.ref,
                replayArtifactPath: replayArtifact.path,
                steps,
                verifyResult,
                dagNodes: dag.listNodes(),
                reconstructedRun,
            };
        });
    }
    verifyWith(subject_1, ctx_1) {
        return __awaiter(this, arguments, void 0, function* (subject, ctx, options = {}) {
            var _a, _b, _c, _d, _e;
            const validators = (_a = options.validators) !== null && _a !== void 0 ? _a : this.validators;
            const qualityGate = (_b = options.qualityGate) !== null && _b !== void 0 ? _b : this.qualityGate;
            yield ((_c = this.ledger) === null || _c === void 0 ? void 0 : _c.append({
                type: 'verifier.started',
                run_id: subject.runId,
                subject_id: subject.subjectId,
                subject_type: subject.subjectType,
                validators: validators.map((validator) => validator.name),
            }));
            const validation = yield runValidators({
                validators,
                event: subject.event,
                ctx,
            });
            const gateDecision = yield qualityGate.evaluate(subject.event, validation.results, { eventId: subject.subjectId });
            const status = mapGateToStatus(gateDecision);
            yield ((_d = this.ledger) === null || _d === void 0 ? void 0 : _d.append({
                type: 'verifier.completed',
                run_id: subject.runId,
                subject_id: subject.subjectId,
                status,
                action: gateDecision.action,
                reason: gateDecision.reason,
                findings: validation.results.length,
            }));
            yield ((_e = this.ledger) === null || _e === void 0 ? void 0 : _e.append({
                type: 'test.completed',
                run_id: subject.runId,
                status,
                passed: validation.results.filter((result) => result.verdict === 'pass').length,
                failed: validation.results.filter((result) => result.verdict === 'block').length,
                skipped: 0,
                ms: validation.results.reduce((sum, result) => sum + result.durationMs, 0),
            }));
            return {
                runId: subject.runId,
                subjectId: subject.subjectId,
                subjectType: subject.subjectType,
                status,
                gateDecision,
                results: validation.results,
            };
        });
    }
    createVerifierRun(input) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.runLedger)
                return;
            yield this.runLedger.createRun({
                run_id: input.verifierRunId,
                parent_run_id: input.parentRunId,
                task_id: `verify:${input.parentRunId}`,
                workspace_id: input.workspaceId,
                repo_id: input.repoId,
                mode: 'autonomous',
                goal: `Verify parent run ${input.parentRunId}`,
                permission_profile: { profile: 'strict' },
            });
            yield this.runLedger.transition(input.verifierRunId, 'planned', 'verifier child run created');
            yield this.runLedger.transition(input.verifierRunId, 'running', 'verifier evaluation started');
        });
    }
    persistAcpReplay(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const raw = JSON.stringify(input.acpEvents);
            const sha256 = createHash('sha256').update(raw).digest('hex');
            const ref = `acp-replay:${sha256}`;
            const artifactPath = path.join(input.replayStoreDir, `${input.verifierRunId}.jsonl`);
            const recorder = createSessionRecorder({
                storeDir: input.replayStoreDir,
                sessionId: input.verifierRunId,
            });
            recorder.sessionStart({
                kind: 'verifier_acp_replay',
                parentRunId: input.parentRunId,
                sha256,
            });
            for (const event of input.acpEvents) {
                recorder.meta({ kind: 'acp_event', event });
            }
            yield recorder.close();
            if (this.runLedger) {
                yield this.runLedger.recordArtifact(input.verifierRunId, ref, [artifactPath]);
            }
            else {
                yield ((_a = this.ledger) === null || _a === void 0 ? void 0 : _a.append({
                    type: 'artifact.created',
                    run_id: input.verifierRunId,
                    artifact_id: ref,
                    files: [artifactPath],
                }));
            }
            return { ref, path: artifactPath, sha256 };
        });
    }
}
export function runOrchestrationEvalSuite(suite, cases, ledger) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = cases.map((testCase) => {
            const failures = testCase.assertions
                .filter((assertion) => !assertion.check(testCase.events))
                .map((assertion) => assertion.name);
            return {
                name: testCase.name,
                passed: failures.length === 0,
                failures,
            };
        });
        const passed = results.filter((result) => result.passed).length;
        const failed = results.length - passed;
        yield (ledger === null || ledger === void 0 ? void 0 : ledger.append({
            type: 'eval.completed',
            run_id: suite,
            suite,
            passed,
            failed,
            status: failed === 0 ? 'passed' : 'failed',
        }));
        return { suite, passed, failed, cases: results };
    });
}
function mapGateToStatus(decision) {
    switch (decision.action) {
        case 'continue':
            return decision.results.some((result) => result.verdict === 'warn') ? 'warning' : 'passed';
        case 'inject_correction':
            return 'failed';
        case 'request_user':
        case 'block':
            return 'blocked';
    }
}
function combineStatuses(statuses) {
    return statuses.reduce((current, next) => (STATUS_RANK[next] > STATUS_RANK[current] ? next : current), 'passed');
}
