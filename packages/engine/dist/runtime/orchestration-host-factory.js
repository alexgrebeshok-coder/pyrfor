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
import { WorkerProtocolBridge, } from './worker-protocol-bridge.js';
import { materializeWorkerManifest, mergePermissionOverrides, mergePermissionProfiles, mergeWorkerDomainScopes, } from './worker-manifest.js';
export function createOrchestrationHost(options) {
    var _a, _b, _c;
    const commandToolName = (_a = options.commandToolName) !== null && _a !== void 0 ? _a : 'shell_exec';
    const patchToolName = (_b = options.patchToolName) !== null && _b !== void 0 ? _b : 'apply_patch';
    requireExecutor(options.toolExecutors, commandToolName);
    requireExecutor(options.toolExecutors, patchToolName);
    const manifestOptions = options.workerManifest
        ? materializeWorkerManifest(options.workerManifest)
        : undefined;
    const toolRegistry = new ToolRegistry();
    registerStandardTools(toolRegistry);
    const domainIds = mergeWorkerDomainScopes(manifestOptions === null || manifestOptions === void 0 ? void 0 : manifestOptions.domainIds, options.domainIds);
    const overlayOverrides = (domainIds === null || domainIds === void 0 ? void 0 : domainIds.length)
        ? options.orchestration.overlays.resolveToolPermissionOverrides(domainIds)
        : {};
    const permissionOverrides = mergePermissionOverrides(overlayOverrides, manifestOptions === null || manifestOptions === void 0 ? void 0 : manifestOptions.permissionOverrides, options.permissionOverrides);
    const permissionEngine = new PermissionEngine(toolRegistry, {
        profile: (_c = mergePermissionProfiles(manifestOptions === null || manifestOptions === void 0 ? void 0 : manifestOptions.permissionProfile, options.permissionProfile)) !== null && _c !== void 0 ? _c : 'standard',
        overrides: permissionOverrides,
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
        capabilityPolicy: options.capabilityPolicy,
        toolAudit: options.toolAudit,
        commandToolName,
        patchToolName,
        deferTerminalRunCompletion: options.deferTerminalRunCompletion,
        expectedRunId: options.expectedRunId,
        expectedTaskId: options.expectedTaskId,
        expectedWorkerRunId: options.expectedWorkerRunId,
        enforceFrameOrder: options.enforceFrameOrder,
        artifactStore: options.orchestration.artifactStore,
        verifyArtifactReferences: true,
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
