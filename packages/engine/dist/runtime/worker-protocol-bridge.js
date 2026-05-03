/**
 * worker-protocol-bridge.ts — host authority for Worker Protocol v2 frames.
 *
 * The worker never owns lifecycle, permissions, or side effects. This bridge
 * validates inbound frames and routes them through RunLedger/ContractsBridge.
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
import { WorkerProtocolValidationError, parseWorkerFrame, } from './worker-protocol.js';
export class WorkerProtocolBridge {
    constructor(options) {
        var _a, _b, _c, _d, _e;
        this.seenFrameIds = new Set();
        this.nextSeq = 0;
        this.runLedger = options.runLedger;
        this.contractsBridge = options.contractsBridge;
        this.effectRunner = options.effectRunner;
        this.toolExecutors = options.toolExecutors;
        this.approvalFlow = options.approvalFlow;
        this.commandToolName = (_a = options.commandToolName) !== null && _a !== void 0 ? _a : 'shell_exec';
        this.patchToolName = (_b = options.patchToolName) !== null && _b !== void 0 ? _b : 'apply_patch';
        this.toolAudit = options.toolAudit;
        this.deferTerminalRunCompletion = (_c = options.deferTerminalRunCompletion) !== null && _c !== void 0 ? _c : false;
        this.expectedRunId = options.expectedRunId;
        this.expectedTaskId = options.expectedTaskId;
        this.expectedWorkerRunId = options.expectedWorkerRunId;
        this.enforceFrameOrder = (_d = options.enforceFrameOrder) !== null && _d !== void 0 ? _d : Boolean(options.expectedRunId || options.expectedTaskId || options.expectedWorkerRunId);
        this.artifactStore = options.artifactStore;
        this.verifyArtifactReferences = (_e = options.verifyArtifactReferences) !== null && _e !== void 0 ? _e : Boolean(options.artifactStore);
    }
    handle(input) {
        return __awaiter(this, void 0, void 0, function* () {
            let frame;
            try {
                frame = parseWorkerFrame(input);
            }
            catch (err) {
                if (err instanceof WorkerProtocolValidationError) {
                    return { ok: false, disposition: 'invalid_frame', errors: err.errors };
                }
                throw err;
            }
            const authorityErrors = this.validateAuthority(frame);
            if (authorityErrors.length > 0) {
                return { ok: false, disposition: 'invalid_frame', frame, errors: authorityErrors };
            }
            this.acceptFrameIdentity(frame);
            switch (frame.type) {
                case 'proposed_command':
                    return this.handleCommand(frame);
                case 'proposed_patch':
                    return this.handlePatch(frame);
                case 'artifact_reference':
                    return this.handleArtifactReference(frame);
                case 'final_report':
                    if (this.deferTerminalRunCompletion) {
                        return { ok: true, disposition: 'run_completed', frame };
                    }
                    yield this.runLedger.completeRun(frame.run_id, 'completed', frame.summary);
                    return { ok: true, disposition: 'run_completed', frame };
                case 'failure_report':
                    if (this.deferTerminalRunCompletion) {
                        return { ok: true, disposition: 'run_failed', frame };
                    }
                    yield this.runLedger.completeRun(frame.run_id, 'failed', frame.error.message);
                    return { ok: true, disposition: 'run_failed', frame };
                default:
                    return { ok: true, disposition: 'accepted', frame };
            }
        });
    }
    validateAuthority(frame) {
        const errors = [];
        if (this.expectedRunId !== undefined && frame.run_id !== this.expectedRunId) {
            errors.push({ path: 'run_id', message: `must match host run ${this.expectedRunId}` });
        }
        if (this.expectedTaskId !== undefined && frame.task_id !== this.expectedTaskId) {
            errors.push({ path: 'task_id', message: `must match host task ${this.expectedTaskId}` });
        }
        if (this.expectedWorkerRunId !== undefined && frame.worker_run_id !== this.expectedWorkerRunId) {
            errors.push({ path: 'worker_run_id', message: `must match host worker run ${this.expectedWorkerRunId}` });
        }
        if (this.seenFrameIds.has(frame.frame_id)) {
            errors.push({ path: 'frame_id', message: 'must be unique within the host worker stream' });
        }
        if (this.enforceFrameOrder && frame.seq !== this.nextSeq) {
            errors.push({ path: 'seq', message: `must be ${this.nextSeq}` });
        }
        return errors;
    }
    acceptFrameIdentity(frame) {
        this.seenFrameIds.add(frame.frame_id);
        if (this.enforceFrameOrder)
            this.nextSeq += 1;
    }
    handleArtifactReference(frame) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.verifyArtifactReferences) {
                if (!this.artifactStore) {
                    return {
                        ok: false,
                        disposition: 'invalid_frame',
                        frame,
                        errors: [{ path: 'artifact_id', message: 'host artifact store is required to accept artifact references' }],
                    };
                }
                const artifacts = yield this.artifactStore.list({ runId: frame.run_id });
                const artifact = artifacts.find((candidate) => candidate.id === frame.artifact_id);
                if (!artifact) {
                    return {
                        ok: false,
                        disposition: 'invalid_frame',
                        frame,
                        errors: [{ path: 'artifact_id', message: 'must reference an existing host-owned artifact for this run' }],
                    };
                }
                if (frame.sha256 !== undefined && artifact.sha256 !== frame.sha256) {
                    return {
                        ok: false,
                        disposition: 'invalid_frame',
                        frame,
                        errors: [{ path: 'sha256', message: 'must match host artifact sha256' }],
                    };
                }
                yield this.runLedger.recordArtifact(frame.run_id, artifact.id, [artifact.uri]);
                return { ok: true, disposition: 'artifact_recorded', frame };
            }
            yield this.runLedger.recordArtifact(frame.run_id, frame.artifact_id, frame.uri ? [frame.uri] : undefined);
            return { ok: true, disposition: 'artifact_recorded', frame };
        });
    }
    handleCommand(frame) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.effectRunner) {
                return this.handleEffectfulTool({
                    frame,
                    kind: 'shell_command',
                    toolName: this.commandToolName,
                    args: Object.assign(Object.assign({ command: frame.command }, (frame.cwd !== undefined ? { cwd: frame.cwd } : {})), (frame.reason !== undefined ? { reason: frame.reason } : {})),
                    preview: frame.reason ? `${frame.reason}: ${frame.command}` : frame.command,
                });
            }
            const executor = this.toolExecutors[this.commandToolName];
            if (!executor) {
                return {
                    ok: false,
                    disposition: 'tool_invoked',
                    frame,
                    toolResult: {
                        ok: false,
                        durationMs: 0,
                        decision: 'deny',
                        error: {
                            code: 'missing_executor',
                            message: `No executor registered for tool "${this.commandToolName}"`,
                        },
                    },
                };
            }
            const toolResult = yield this.contractsBridge.invoke({
                runId: frame.run_id,
                toolName: this.commandToolName,
                args: Object.assign(Object.assign({ command: frame.command }, (frame.cwd !== undefined ? { cwd: frame.cwd } : {})), (frame.reason !== undefined ? { reason: frame.reason } : {})),
                invocationId: frame.frame_id,
            }, executor);
            return {
                ok: toolResult.ok,
                disposition: 'tool_invoked',
                frame,
                toolResult,
            };
        });
    }
    handlePatch(frame) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.effectRunner) {
                return { ok: true, disposition: 'accepted', frame };
            }
            return this.handleEffectfulTool({
                frame,
                kind: 'file_edit',
                toolName: this.patchToolName,
                args: Object.assign({ patch: frame.patch, files: frame.files }, (frame.summary !== undefined ? { summary: frame.summary } : {})),
                preview: (_a = frame.summary) !== null && _a !== void 0 ? _a : `Patch ${frame.files.join(', ')}`,
            });
        });
    }
    handleEffectfulTool(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const executor = this.toolExecutors[opts.toolName];
            if (!executor) {
                return {
                    ok: false,
                    disposition: 'tool_invoked',
                    frame: opts.frame,
                    toolResult: {
                        ok: false,
                        durationMs: 0,
                        decision: 'deny',
                        error: {
                            code: 'missing_executor',
                            message: `No executor registered for tool "${opts.toolName}"`,
                        },
                    },
                };
            }
            const effect = yield this.effectRunner.propose({
                run_id: opts.frame.run_id,
                kind: opts.kind,
                toolName: opts.toolName,
                payload: opts.args,
                preview: opts.preview,
                idempotency_key: opts.frame.frame_id,
            });
            let verdict = yield this.effectRunner.decide(effect);
            if (verdict.decision === 'ask') {
                verdict = yield this.resolveApproval(effect, verdict, opts.toolName, opts.args, opts.preview);
            }
            if (verdict.decision !== 'allow') {
                const effectResult = yield this.effectRunner.apply(effect, () => __awaiter(this, void 0, void 0, function* () { return ({ output: undefined }); }), { verdict });
                yield this.blockRunIfPossible(opts.frame.run_id, verdict.reason);
                this.emitToolAudit(opts.frame, opts.toolName, opts.args, opts.preview, 'deny', verdict.reason);
                return {
                    ok: false,
                    disposition: 'effect_denied',
                    frame: opts.frame,
                    effect,
                    verdict,
                    effectResult,
                };
            }
            let toolResult;
            const effectResult = yield this.effectRunner.apply(effect, () => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c;
                toolResult = yield this.contractsBridge.invokeApproved({
                    runId: opts.frame.run_id,
                    toolName: opts.toolName,
                    args: opts.args,
                    invocationId: opts.frame.frame_id,
                }, executor);
                if (!toolResult.ok) {
                    const err = new Error((_b = (_a = toolResult.error) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : 'Tool execution failed');
                    if (((_c = toolResult.error) === null || _c === void 0 ? void 0 : _c.code) !== undefined)
                        err.code = toolResult.error.code;
                    throw err;
                }
                return { output: toolResult.output };
            }), { verdict });
            this.emitToolAudit(opts.frame, opts.toolName, opts.args, opts.preview, (toolResult === null || toolResult === void 0 ? void 0 : toolResult.ok) ? 'approve' : 'deny', (_a = toolResult === null || toolResult === void 0 ? void 0 : toolResult.error) === null || _a === void 0 ? void 0 : _a.message);
            return {
                ok: effectResult.ok,
                disposition: 'tool_invoked',
                frame: opts.frame,
                toolResult,
                effect,
                verdict,
                effectResult,
            };
        });
    }
    resolveApproval(effect, verdict, toolName, args, summary) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.blockRunIfPossible(effect.run_id, 'approval required');
            if (!this.approvalFlow)
                return verdict;
            const decision = yield this.approvalFlow.requestApproval({
                id: effect.effect_id,
                toolName,
                summary,
                args,
            });
            if (decision !== 'approve') {
                return Object.assign(Object.assign({}, verdict), { decision: 'deny', policy_id: `human:${decision}`, reason: decision === 'timeout' ? 'approval timeout' : 'approval denied', approval_required: false });
            }
            const approved = yield this.effectRunner.approve(effect, 'approval-flow');
            const current = this.runLedger.getRun(effect.run_id);
            if ((current === null || current === void 0 ? void 0 : current.status) === 'blocked') {
                yield this.runLedger.transition(effect.run_id, 'running', 'approval granted');
            }
            return approved;
        });
    }
    blockRunIfPossible(runId, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            const current = this.runLedger.getRun(runId);
            if ((current === null || current === void 0 ? void 0 : current.status) === 'running' || (current === null || current === void 0 ? void 0 : current.status) === 'awaiting_approval') {
                yield this.runLedger.blockRun(runId, reason);
            }
        });
    }
    emitToolAudit(frame, toolName, args, summary, decision, error) {
        var _a;
        (_a = this.toolAudit) === null || _a === void 0 ? void 0 : _a.call(this, {
            requestId: frame.frame_id,
            toolName,
            summary,
            args,
            decision,
            toolCallId: frame.frame_id,
            resultSummary: error ? undefined : summary,
            error,
        });
    }
}
