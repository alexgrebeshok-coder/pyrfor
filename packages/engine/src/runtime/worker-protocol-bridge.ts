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
import {
  WorkerProtocolValidationError,
  parseWorkerFrame,
  type WorkerFrame,
  type WorkerFrameValidationErrorDetail,
} from './worker-protocol';
import type { ApprovalDecision, ApprovalRequest } from './approval-flow';

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
}

export class WorkerProtocolBridge {
  private readonly runLedger: RunLedger;
  private readonly contractsBridge: ContractsBridge;
  private readonly effectRunner: TwoPhaseEffectRunner | undefined;
  private readonly toolExecutors: Record<string, ToolExecutor>;
  private readonly approvalFlow: WorkerProtocolBridgeOptions['approvalFlow'];
  private readonly commandToolName: string;
  private readonly patchToolName: string;

  constructor(options: WorkerProtocolBridgeOptions) {
    this.runLedger = options.runLedger;
    this.contractsBridge = options.contractsBridge;
    this.effectRunner = options.effectRunner;
    this.toolExecutors = options.toolExecutors;
    this.approvalFlow = options.approvalFlow;
    this.commandToolName = options.commandToolName ?? 'shell_exec';
    this.patchToolName = options.patchToolName ?? 'apply_patch';
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

    switch (frame.type) {
      case 'proposed_command':
        return this.handleCommand(frame);
      case 'proposed_patch':
        return this.handlePatch(frame);
      case 'artifact_reference':
        await this.runLedger.recordArtifact(frame.run_id, frame.artifact_id, frame.uri ? [frame.uri] : undefined);
        return { ok: true, disposition: 'artifact_recorded', frame };
      case 'final_report':
        await this.runLedger.completeRun(frame.run_id, 'completed', frame.summary);
        return { ok: true, disposition: 'run_completed', frame };
      case 'failure_report':
        await this.runLedger.completeRun(frame.run_id, 'failed', frame.error.message);
        return { ok: true, disposition: 'run_failed', frame };
      default:
        return { ok: true, disposition: 'accepted', frame };
    }
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
}
