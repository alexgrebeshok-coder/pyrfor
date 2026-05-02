/**
 * worker-protocol-bridge.ts — host authority for Worker Protocol v2 frames.
 *
 * The worker never owns lifecycle, permissions, or side effects. This bridge
 * validates inbound frames and routes them through RunLedger/ContractsBridge.
 */
import { ContractsBridge, type ToolExecutor, type ToolInvocationResult } from './contracts-bridge';
import { RunLedger } from './run-ledger';
import { TwoPhaseEffectRunner, type EffectApplyResult, type EffectPolicyVerdict, type EffectProposal } from './two-phase-effect';
import { type WorkerFrame, type WorkerFrameValidationErrorDetail } from './worker-protocol';
import type { ApprovalDecision, ApprovalRequest } from './approval-flow';
export type WorkerProtocolBridgeDisposition = 'accepted' | 'tool_invoked' | 'effect_denied' | 'artifact_recorded' | 'run_completed' | 'run_failed' | 'invalid_frame';
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
export declare class WorkerProtocolBridge {
    private readonly runLedger;
    private readonly contractsBridge;
    private readonly effectRunner;
    private readonly toolExecutors;
    private readonly approvalFlow;
    private readonly commandToolName;
    private readonly patchToolName;
    constructor(options: WorkerProtocolBridgeOptions);
    handle(input: unknown): Promise<WorkerProtocolBridgeResult>;
    private handleCommand;
    private handlePatch;
    private handleEffectfulTool;
    private resolveApproval;
    private blockRunIfPossible;
}
//# sourceMappingURL=worker-protocol-bridge.d.ts.map