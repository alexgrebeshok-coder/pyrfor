/**
 * worker-protocol-bridge.ts — host authority for Worker Protocol v2 frames.
 *
 * The worker never owns lifecycle, permissions, or side effects. This bridge
 * validates inbound frames and routes them through RunLedger/ContractsBridge.
 */
import { ContractsBridge, type ToolExecutor, type ToolInvocationResult } from './contracts-bridge';
import { RunLedger } from './run-ledger';
import { TwoPhaseEffectRunner, type EffectApplyResult, type EffectPolicyVerdict, type EffectProposal } from './two-phase-effect';
import type { ArtifactStore } from './artifact-model';
import { type WorkerFrame, type WorkerFrameValidationErrorDetail } from './worker-protocol';
import type { ApprovalDecision, ApprovalRequest } from './approval-flow';
import type { ToolAuditEvent } from './tool-loop';
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
export declare class WorkerProtocolBridge {
    private readonly runLedger;
    private readonly contractsBridge;
    private readonly effectRunner;
    private readonly toolExecutors;
    private readonly approvalFlow;
    private readonly commandToolName;
    private readonly patchToolName;
    private readonly toolAudit;
    private readonly deferTerminalRunCompletion;
    private readonly expectedRunId;
    private readonly expectedTaskId;
    private readonly expectedWorkerRunId;
    private readonly enforceFrameOrder;
    private readonly artifactStore;
    private readonly verifyArtifactReferences;
    private readonly seenFrameIds;
    private nextSeq;
    constructor(options: WorkerProtocolBridgeOptions);
    handle(input: unknown): Promise<WorkerProtocolBridgeResult>;
    private validateAuthority;
    private acceptFrameIdentity;
    private handleArtifactReference;
    private handleCommand;
    private handlePatch;
    private handleEffectfulTool;
    private resolveApproval;
    private blockRunIfPossible;
    private emitToolAudit;
}
//# sourceMappingURL=worker-protocol-bridge.d.ts.map