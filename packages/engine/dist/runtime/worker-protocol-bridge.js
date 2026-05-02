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
        var _a, _b;
        this.runLedger = options.runLedger;
        this.contractsBridge = options.contractsBridge;
        this.effectRunner = options.effectRunner;
        this.toolExecutors = options.toolExecutors;
        this.approvalFlow = options.approvalFlow;
        this.commandToolName = (_a = options.commandToolName) !== null && _a !== void 0 ? _a : 'shell_exec';
        this.patchToolName = (_b = options.patchToolName) !== null && _b !== void 0 ? _b : 'apply_patch';
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
            switch (frame.type) {
                case 'proposed_command':
                    return this.handleCommand(frame);
                case 'proposed_patch':
                    return this.handlePatch(frame);
                case 'artifact_reference':
                    yield this.runLedger.recordArtifact(frame.run_id, frame.artifact_id, frame.uri ? [frame.uri] : undefined);
                    return { ok: true, disposition: 'artifact_recorded', frame };
                case 'final_report':
                    yield this.runLedger.completeRun(frame.run_id, 'completed', frame.summary);
                    return { ok: true, disposition: 'run_completed', frame };
                case 'failure_report':
                    yield this.runLedger.completeRun(frame.run_id, 'failed', frame.error.message);
                    return { ok: true, disposition: 'run_failed', frame };
                default:
                    return { ok: true, disposition: 'accepted', frame };
            }
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
}
