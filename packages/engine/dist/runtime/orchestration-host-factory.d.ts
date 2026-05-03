/**
 * orchestration-host-factory.ts — production assembly for host-owned worker control.
 *
 * Workers propose frames; this factory wires the host authority path that decides
 * and applies side effects through Pyrfor contracts.
 */
import { CodingSupervisorHost, type CodingSupervisorHostOptions } from './coding-supervisor-host';
import { ContractsBridge, type ToolExecutor } from './contracts-bridge';
import type { DomainOverlayRegistry } from './domain-overlay';
import type { DurableDag } from './durable-dag';
import type { EventLedger } from './event-ledger';
import { PermissionEngine, ToolRegistry, type PermissionClass, type PermissionEngineOptions } from './permission-engine';
import type { AcpEvent } from './acp-client';
import type { ArtifactStore } from './artifact-model';
import type { ApprovalDecision, ApprovalRequest } from './approval-flow';
import type { FCEvent } from './pyrfor-fc-adapter';
import type { RunLedger } from './run-ledger';
import type { ToolAuditEvent } from './tool-loop';
import { TwoPhaseEffectRunner } from './two-phase-effect';
import { WorkerProtocolBridge, type WorkerCapabilityRequest, type WorkerProtocolBridgeResult } from './worker-protocol-bridge';
import { type WorkerManifest } from './worker-manifest';
export interface OrchestrationHostRuntimeDeps {
    eventLedger: EventLedger;
    runLedger: RunLedger;
    dag: DurableDag;
    artifactStore: ArtifactStore;
    overlays: DomainOverlayRegistry;
}
export interface OrchestrationHostFactoryOptions {
    orchestration: OrchestrationHostRuntimeDeps;
    workspaceId: string;
    sessionId: string;
    domainIds?: string[];
    workerManifest?: WorkerManifest;
    permissionProfile?: PermissionEngineOptions['profile'];
    permissionOverrides?: Record<string, PermissionClass>;
    toolExecutors: Record<string, ToolExecutor>;
    approvalFlow?: {
        requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
    };
    capabilityPolicy?: (request: WorkerCapabilityRequest) => Promise<'grant' | 'deny'> | 'grant' | 'deny';
    commandToolName?: string;
    patchToolName?: string;
    toolAudit?: (event: ToolAuditEvent) => void;
    deferTerminalRunCompletion?: boolean;
    expectedRunId?: string;
    expectedTaskId?: string;
    expectedWorkerRunId?: string;
    enforceFrameOrder?: boolean;
    onFrameResult?: CodingSupervisorHostOptions['onFrameResult'];
    logger?: CodingSupervisorHostOptions['logger'];
    clock?: () => number;
}
export interface OrchestrationHost {
    toolRegistry: ToolRegistry;
    permissionEngine: PermissionEngine;
    contractsBridge: ContractsBridge;
    effectRunner: TwoPhaseEffectRunner;
    workerBridge: WorkerProtocolBridge;
    codingHost: CodingSupervisorHost;
}
export interface AcpWorkerFrameHandlerOptions {
    onEvent?: (event: AcpEvent) => void;
    logger?: CodingSupervisorHostOptions['logger'];
}
export declare function createOrchestrationHost(options: OrchestrationHostFactoryOptions): OrchestrationHost;
export declare function createAcpWorkerFrameHandler(host: Pick<OrchestrationHost, 'codingHost'>, options?: AcpWorkerFrameHandlerOptions): (event: AcpEvent) => void;
export declare function routeFreeClaudeWorkerFrame(host: Pick<OrchestrationHost, 'codingHost'>, event: FCEvent): Promise<WorkerProtocolBridgeResult | null>;
//# sourceMappingURL=orchestration-host-factory.d.ts.map