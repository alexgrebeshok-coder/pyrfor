/**
 * worker-protocol-bridge.ts — host authority for Worker Protocol v2 frames.
 *
 * The worker never owns lifecycle, permissions, or side effects. This bridge
 * validates inbound frames and routes them through RunLedger/ContractsBridge.
 */

import {
  ContractsBridge,
  type ToolExecutor,
  type ToolInvocationResult,
} from './contracts-bridge';
import { RunLedger } from './run-ledger';
import { TwoPhaseEffectRunner, type EffectApplyResult, type EffectPolicyVerdict, type EffectProposal } from './two-phase-effect';
import type { ArtifactStore } from './artifact-model';
import {
  WorkerProtocolValidationError,
  parseWorkerFrame,
  type WorkerFrame,
  type WorkerFrameValidationErrorDetail,
} from './worker-protocol';
import type { ApprovalDecision, ApprovalRequest } from './approval-flow';
import type { ToolAuditEvent } from './tool-loop';

export type WorkerProtocolBridgeDisposition =
  | 'accepted'
  | 'tool_invoked'
  | 'effect_denied'
  | 'artifact_recorded'
  | 'run_completed'
  | 'run_failed'
  | 'invalid_frame';

export interface WorkerProtocolBridgeResult {
  ok: boolean;
  disposition: WorkerProtocolBridgeDisposition;
  frame?: WorkerFrame;
  toolResult?: ToolInvocationResult;
  effect?: EffectProposal;
  verdict?: EffectPolicyVerdict;
  effectResult?: EffectApplyResult;
  errors?: WorkerFrameValidationErrorDetail[];
}

export interface WorkerProtocolBridgeOptions {
  runLedger: RunLedger;
  contractsBridge: ContractsBridge;
  effectRunner?: TwoPhaseEffectRunner;
  toolExecutors: Record<string, ToolExecutor>;
  approvalFlow?: {
    requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
  };
  /** Tool name used for proposed command frames. Default: shell_exec. */
  commandToolName?: string;
  /** Tool name used for proposed patch frames. Default: apply_patch. */
  patchToolName?: string;
  toolAudit?: (event: ToolAuditEvent) => void;
  /** When true, final/failure reports are returned to the caller without terminal RunLedger mutation. */
  deferTerminalRunCompletion?: boolean;
  /** Optional strict binding for worker frames owned by a host run. */
  expectedRunId?: string;
  expectedTaskId?: string;
  expectedWorkerRunId?: string;
  /** When true, frame seq must be contiguous from zero and frame_id must be unique. */
  enforceFrameOrder?: boolean;
  /** Required to accept worker artifact references as already host-owned artifacts. */
  artifactStore?: Pick<ArtifactStore, 'list'>;
  /** When true, reject artifact_reference frames without a matching host artifact. */
  verifyArtifactReferences?: boolean;
}

export class WorkerProtocolBridge {
  private readonly runLedger: RunLedger;
  private readonly contractsBridge: ContractsBridge;
  private readonly effectRunner: TwoPhaseEffectRunner | undefined;
  private readonly toolExecutors: Record<string, ToolExecutor>;
  private readonly approvalFlow: WorkerProtocolBridgeOptions['approvalFlow'];
  private readonly commandToolName: string;
  private readonly patchToolName: string;
  private readonly toolAudit: WorkerProtocolBridgeOptions['toolAudit'];
  private readonly deferTerminalRunCompletion: boolean;
  private readonly expectedRunId: string | undefined;
  private readonly expectedTaskId: string | undefined;
  private readonly expectedWorkerRunId: string | undefined;
  private readonly enforceFrameOrder: boolean;
  private readonly artifactStore: WorkerProtocolBridgeOptions['artifactStore'];
  private readonly verifyArtifactReferences: boolean;
  private readonly seenFrameIds = new Set<string>();
  private nextSeq = 0;

  constructor(options: WorkerProtocolBridgeOptions) {
    this.runLedger = options.runLedger;
    this.contractsBridge = options.contractsBridge;
    this.effectRunner = options.effectRunner;
    this.toolExecutors = options.toolExecutors;
    this.approvalFlow = options.approvalFlow;
    this.commandToolName = options.commandToolName ?? 'shell_exec';
    this.patchToolName = options.patchToolName ?? 'apply_patch';
    this.toolAudit = options.toolAudit;
    this.deferTerminalRunCompletion = options.deferTerminalRunCompletion ?? false;
    this.expectedRunId = options.expectedRunId;
    this.expectedTaskId = options.expectedTaskId;
    this.expectedWorkerRunId = options.expectedWorkerRunId;
    this.enforceFrameOrder = options.enforceFrameOrder ?? Boolean(options.expectedRunId || options.expectedTaskId || options.expectedWorkerRunId);
    this.artifactStore = options.artifactStore;
    this.verifyArtifactReferences = options.verifyArtifactReferences ?? Boolean(options.artifactStore);
  }

  async handle(input: unknown): Promise<WorkerProtocolBridgeResult> {
    let frame: WorkerFrame;
    try {
      frame = parseWorkerFrame(input);
    } catch (err) {
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
        await this.runLedger.completeRun(frame.run_id, 'completed', frame.summary);
        return { ok: true, disposition: 'run_completed', frame };
      case 'failure_report':
        if (this.deferTerminalRunCompletion) {
          return { ok: true, disposition: 'run_failed', frame };
        }
        await this.runLedger.completeRun(frame.run_id, 'failed', frame.error.message);
        return { ok: true, disposition: 'run_failed', frame };
      default:
        return { ok: true, disposition: 'accepted', frame };
    }
  }

  private validateAuthority(frame: WorkerFrame): WorkerFrameValidationErrorDetail[] {
    const errors: WorkerFrameValidationErrorDetail[] = [];
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

  private acceptFrameIdentity(frame: WorkerFrame): void {
    this.seenFrameIds.add(frame.frame_id);
    if (this.enforceFrameOrder) this.nextSeq += 1;
  }

  private async handleArtifactReference(frame: Extract<WorkerFrame, { type: 'artifact_reference' }>): Promise<WorkerProtocolBridgeResult> {
    if (this.verifyArtifactReferences) {
      if (!this.artifactStore) {
        return {
          ok: false,
          disposition: 'invalid_frame',
          frame,
          errors: [{ path: 'artifact_id', message: 'host artifact store is required to accept artifact references' }],
        };
      }
      const artifacts = await this.artifactStore.list({ runId: frame.run_id });
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
      await this.runLedger.recordArtifact(frame.run_id, artifact.id, [artifact.uri]);
      return { ok: true, disposition: 'artifact_recorded', frame };
    }

    await this.runLedger.recordArtifact(frame.run_id, frame.artifact_id, frame.uri ? [frame.uri] : undefined);
    return { ok: true, disposition: 'artifact_recorded', frame };
  }

  private async handleCommand(frame: Extract<WorkerFrame, { type: 'proposed_command' }>): Promise<WorkerProtocolBridgeResult> {
    if (this.effectRunner) {
      return this.handleEffectfulTool({
        frame,
        kind: 'shell_command',
        toolName: this.commandToolName,
        args: {
          command: frame.command,
          ...(frame.cwd !== undefined ? { cwd: frame.cwd } : {}),
          ...(frame.reason !== undefined ? { reason: frame.reason } : {}),
        },
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

    const toolResult = await this.contractsBridge.invoke(
      {
        runId: frame.run_id,
        toolName: this.commandToolName,
        args: {
          command: frame.command,
          ...(frame.cwd !== undefined ? { cwd: frame.cwd } : {}),
          ...(frame.reason !== undefined ? { reason: frame.reason } : {}),
        },
        invocationId: frame.frame_id,
      },
      executor,
    );

    return {
      ok: toolResult.ok,
      disposition: 'tool_invoked',
      frame,
      toolResult,
    };
  }

  private async handlePatch(frame: Extract<WorkerFrame, { type: 'proposed_patch' }>): Promise<WorkerProtocolBridgeResult> {
    if (!this.effectRunner) {
      return { ok: true, disposition: 'accepted', frame };
    }
    return this.handleEffectfulTool({
      frame,
      kind: 'file_edit',
      toolName: this.patchToolName,
      args: {
        patch: frame.patch,
        files: frame.files,
        ...(frame.summary !== undefined ? { summary: frame.summary } : {}),
      },
      preview: frame.summary ?? `Patch ${frame.files.join(', ')}`,
    });
  }

  private async handleEffectfulTool(opts: {
    frame: Extract<WorkerFrame, { type: 'proposed_command' | 'proposed_patch' }>;
    kind: 'shell_command' | 'file_edit';
    toolName: string;
    args: Record<string, unknown>;
    preview: string;
  }): Promise<WorkerProtocolBridgeResult> {
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

    const effect = await this.effectRunner!.propose({
      run_id: opts.frame.run_id,
      kind: opts.kind,
      toolName: opts.toolName,
      payload: opts.args,
      preview: opts.preview,
      idempotency_key: opts.frame.frame_id,
    });

    let verdict = await this.effectRunner!.decide(effect);
    if (verdict.decision === 'ask') {
      verdict = await this.resolveApproval(effect, verdict, opts.toolName, opts.args, opts.preview);
    }

    if (verdict.decision !== 'allow') {
      const effectResult = await this.effectRunner!.apply(effect, async () => ({ output: undefined }), { verdict });
      await this.blockRunIfPossible(opts.frame.run_id, verdict.reason);
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

    let toolResult: ToolInvocationResult | undefined;
    const effectResult = await this.effectRunner!.apply(
      effect,
      async () => {
        toolResult = await this.contractsBridge.invokeApproved(
          {
            runId: opts.frame.run_id,
            toolName: opts.toolName,
            args: opts.args,
            invocationId: opts.frame.frame_id,
          },
          executor,
        );
        if (!toolResult.ok) {
          const err = new Error(toolResult.error?.message ?? 'Tool execution failed') as Error & { code?: string };
          if (toolResult.error?.code !== undefined) err.code = toolResult.error.code;
          throw err;
        }
        return { output: toolResult.output };
      },
      { verdict },
    );
    this.emitToolAudit(
      opts.frame,
      opts.toolName,
      opts.args,
      opts.preview,
      toolResult?.ok ? 'approve' : 'deny',
      toolResult?.error?.message,
    );

    return {
      ok: effectResult.ok,
      disposition: 'tool_invoked',
      frame: opts.frame,
      toolResult,
      effect,
      verdict,
      effectResult,
    };
  }

  private async resolveApproval(
    effect: EffectProposal,
    verdict: EffectPolicyVerdict,
    toolName: string,
    args: Record<string, unknown>,
    summary: string,
  ): Promise<EffectPolicyVerdict> {
    await this.blockRunIfPossible(effect.run_id, 'approval required');
    if (!this.approvalFlow) return verdict;

    const decision = await this.approvalFlow.requestApproval({
      id: effect.effect_id,
      toolName,
      summary,
      args,
      run_id: effect.run_id,
      effect_id: effect.effect_id,
      effect_kind: effect.kind,
      policy_id: verdict.policy_id,
      reason: verdict.reason,
      approval_required: verdict.approval_required,
    });

    if (decision !== 'approve') {
      return {
        ...verdict,
        decision: 'deny',
        policy_id: `human:${decision}`,
        reason: decision === 'timeout' ? 'approval timeout' : 'approval denied',
        approval_required: false,
      };
    }

    const approved = await this.effectRunner!.approve(effect, 'approval-flow');
    const current = this.runLedger.getRun(effect.run_id);
    if (current?.status === 'blocked') {
      await this.runLedger.transition(effect.run_id, 'running', 'approval granted');
    }
    return approved;
  }

  private async blockRunIfPossible(runId: string, reason: string): Promise<void> {
    const current = this.runLedger.getRun(runId);
    if (current?.status === 'running' || current?.status === 'awaiting_approval') {
      await this.runLedger.blockRun(runId, reason);
    }
  }

  private emitToolAudit(
    frame: Extract<WorkerFrame, { type: 'proposed_command' | 'proposed_patch' }>,
    toolName: string,
    args: Record<string, unknown>,
    summary: string,
    decision: ApprovalDecision,
    error?: string,
  ): void {
    this.toolAudit?.({
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
