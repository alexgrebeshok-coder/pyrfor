/**
 * orchestration-host-factory.ts — production assembly for host-owned worker control.
 *
 * Workers propose frames; this factory wires the host authority path that decides
 * and applies side effects through Pyrfor contracts.
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
import { CodingSupervisorHost } from './coding-supervisor-host.js';
import { ContractsBridge } from './contracts-bridge.js';
import { PermissionEngine, ToolRegistry, registerStandardTools, } from './permission-engine.js';
import { TwoPhaseEffectRunner } from './two-phase-effect.js';
import { WorkerProtocolBridge } from './worker-protocol-bridge.js';
export function createOrchestrationHost(options) {
    var _a, _b, _c, _d, _e;
    const commandToolName = (_a = options.commandToolName) !== null && _a !== void 0 ? _a : 'shell_exec';
    const patchToolName = (_b = options.patchToolName) !== null && _b !== void 0 ? _b : 'apply_patch';
    requireExecutor(options.toolExecutors, commandToolName);
    requireExecutor(options.toolExecutors, patchToolName);
    const toolRegistry = new ToolRegistry();
    registerStandardTools(toolRegistry);
    const overlayOverrides = ((_c = options.domainIds) === null || _c === void 0 ? void 0 : _c.length)
        ? options.orchestration.overlays.resolveToolPermissionOverrides(options.domainIds)
        : {};
    const permissionEngine = new PermissionEngine(toolRegistry, {
        profile: (_d = options.permissionProfile) !== null && _d !== void 0 ? _d : 'standard',
        overrides: Object.assign(Object.assign({}, overlayOverrides), ((_e = options.permissionOverrides) !== null && _e !== void 0 ? _e : {})),
    });
    const contractsBridge = new ContractsBridge({
        permissionEngine,
        ledger: options.orchestration.eventLedger,
        permissionContext: {
            workspaceId: options.workspaceId,
            sessionId: options.sessionId,
        },
        clock: options.clock,
        onAskPermission: (inv) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const decision = yield ((_a = options.approvalFlow) === null || _a === void 0 ? void 0 : _a.requestApproval({
                id: (_b = inv.invocationId) !== null && _b !== void 0 ? _b : `${inv.runId}:${inv.toolName}`,
                toolName: inv.toolName,
                summary: inv.toolName,
                args: inv.args,
            }));
            if (decision === 'approve') {
                permissionEngine.recordApproval(options.workspaceId, inv.toolName);
                return 'allow';
            }
            return 'deny';
        }),
    });
    const effectRunner = new TwoPhaseEffectRunner({
        ledger: options.orchestration.eventLedger,
        permissionEngine,
        permissionContext: {
            workspaceId: options.workspaceId,
            sessionId: options.sessionId,
        },
        clock: options.clock,
    });
    const workerBridge = new WorkerProtocolBridge({
        runLedger: options.orchestration.runLedger,
        contractsBridge,
        effectRunner,
        toolExecutors: options.toolExecutors,
        approvalFlow: options.approvalFlow,
        toolAudit: options.toolAudit,
        commandToolName,
        patchToolName,
        deferTerminalRunCompletion: options.deferTerminalRunCompletion,
    });
    const codingHost = new CodingSupervisorHost({
        workerBridge,
        onFrameResult: options.onFrameResult,
        logger: options.logger,
    });
    return {
        toolRegistry,
        permissionEngine,
        contractsBridge,
        effectRunner,
        workerBridge,
        codingHost,
    };
}
export function createAcpWorkerFrameHandler(host, options = {}) {
    return (event) => {
        var _a;
        void host.codingHost.handleAcpEvent(event).catch((err) => {
            var _a;
            (_a = options.logger) === null || _a === void 0 ? void 0 : _a.call(options, 'error', 'orchestration-host: ACP worker_frame handling failed', {
                error: err instanceof Error ? err.message : String(err),
            });
        });
        (_a = options.onEvent) === null || _a === void 0 ? void 0 : _a.call(options, event);
    };
}
export function routeFreeClaudeWorkerFrame(host, event) {
    return __awaiter(this, void 0, void 0, function* () {
        return host.codingHost.handleFreeClaudeEvent(event);
    });
}
function requireExecutor(executors, toolName) {
    if (!executors[toolName]) {
        throw new Error(`OrchestrationHostFactory: missing executor for tool "${toolName}"`);
    }
}
