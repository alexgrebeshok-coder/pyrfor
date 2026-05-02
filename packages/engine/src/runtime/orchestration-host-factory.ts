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
import {
  PermissionEngine,
  ToolRegistry,
  registerStandardTools,
  type PermissionClass,
  type PermissionEngineOptions,
} from './permission-engine';
import type { AcpEvent } from './acp-client';
import type { ArtifactStore } from './artifact-model';
import type { ApprovalDecision, ApprovalRequest } from './approval-flow';
import type { FCEvent } from './pyrfor-fc-adapter';
import type { RunLedger } from './run-ledger';
import type { ToolAuditEvent } from './tool-loop';
import { TwoPhaseEffectRunner } from './two-phase-effect';
import { WorkerProtocolBridge, type WorkerProtocolBridgeResult } from './worker-protocol-bridge';

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
  permissionProfile?: PermissionEngineOptions['profile'];
  permissionOverrides?: Record<string, PermissionClass>;
  toolExecutors: Record<string, ToolExecutor>;
  approvalFlow?: {
    requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
  };
  commandToolName?: string;
  patchToolName?: string;
  toolAudit?: (event: ToolAuditEvent) => void;
  deferTerminalRunCompletion?: boolean;
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

export function createOrchestrationHost(options: OrchestrationHostFactoryOptions): OrchestrationHost {
  const commandToolName = options.commandToolName ?? 'shell_exec';
  const patchToolName = options.patchToolName ?? 'apply_patch';
  requireExecutor(options.toolExecutors, commandToolName);
  requireExecutor(options.toolExecutors, patchToolName);

  const toolRegistry = new ToolRegistry();
  registerStandardTools(toolRegistry);

  const overlayOverrides = options.domainIds?.length
    ? options.orchestration.overlays.resolveToolPermissionOverrides(options.domainIds)
    : {};
  const permissionEngine = new PermissionEngine(toolRegistry, {
    profile: options.permissionProfile ?? 'standard',
    overrides: {
      ...overlayOverrides,
      ...(options.permissionOverrides ?? {}),
    },
  });

  const contractsBridge = new ContractsBridge({
    permissionEngine,
    ledger: options.orchestration.eventLedger,
    permissionContext: {
      workspaceId: options.workspaceId,
      sessionId: options.sessionId,
    },
    clock: options.clock,
    onAskPermission: async (inv) => {
      const decision = await options.approvalFlow?.requestApproval({
        id: inv.invocationId ?? `${inv.runId}:${inv.toolName}`,
        toolName: inv.toolName,
        summary: inv.toolName,
        args: inv.args,
      });
      if (decision === 'approve') {
        permissionEngine.recordApproval(options.workspaceId, inv.toolName);
        return 'allow';
      }
      return 'deny';
    },
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

export function createAcpWorkerFrameHandler(
  host: Pick<OrchestrationHost, 'codingHost'>,
  options: AcpWorkerFrameHandlerOptions = {},
): (event: AcpEvent) => void {
  return (event) => {
    void host.codingHost.handleAcpEvent(event).catch((err: unknown) => {
      options.logger?.('error', 'orchestration-host: ACP worker_frame handling failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    options.onEvent?.(event);
  };
}

export async function routeFreeClaudeWorkerFrame(
  host: Pick<OrchestrationHost, 'codingHost'>,
  event: FCEvent,
): Promise<WorkerProtocolBridgeResult | null> {
  return host.codingHost.handleFreeClaudeEvent(event);
}

function requireExecutor(executors: Record<string, ToolExecutor>, toolName: string): void {
  if (!executors[toolName]) {
    throw new Error(`OrchestrationHostFactory: missing executor for tool "${toolName}"`);
  }
}
