/**
 * worker-protocol.ts — typed Worker Protocol v2 frames.
 *
 * Workers must emit these frames instead of performing effects directly. The
 * engine validates each frame before policy, approval, execution, QA, or audit
 * logic can consume it.
 */
export declare const WORKER_PROTOCOL_VERSION: "wp.v2";
export type WorkerProtocolVersion = typeof WORKER_PROTOCOL_VERSION;
export type WorkerFrameType = 'plan_fragment' | 'proposed_patch' | 'proposed_command' | 'request_capability' | 'checkpoint' | 'heartbeat' | 'artifact_reference' | 'warning' | 'final_report' | 'failure_report';
export interface WorkerFrameBase {
    protocol_version: WorkerProtocolVersion;
    type: WorkerFrameType;
    frame_id: string;
    task_id: string;
    run_id: string;
    seq: number;
    ts?: string;
    trace_id?: string;
    worker_run_id?: string;
}
export interface PlanFragmentFrame extends WorkerFrameBase {
    type: 'plan_fragment';
    content: string;
    steps?: string[];
}
export interface ProposedPatchFrame extends WorkerFrameBase {
    type: 'proposed_patch';
    patch: string;
    files: string[];
    summary?: string;
}
export interface ProposedCommandFrame extends WorkerFrameBase {
    type: 'proposed_command';
    command: string;
    cwd?: string;
    reason?: string;
}
export interface RequestCapabilityFrame extends WorkerFrameBase {
    type: 'request_capability';
    capability: string;
    reason: string;
    scope?: Record<string, unknown>;
}
export interface CheckpointFrame extends WorkerFrameBase {
    type: 'checkpoint';
    checkpoint_id: string;
    resume_token?: string;
    state?: Record<string, unknown>;
}
export interface HeartbeatFrame extends WorkerFrameBase {
    type: 'heartbeat';
    state?: string;
    progress?: number;
    message?: string;
}
export interface ArtifactReferenceFrame extends WorkerFrameBase {
    type: 'artifact_reference';
    artifact_id: string;
    kind?: string;
    uri?: string;
    sha256?: string;
}
export interface WarningFrame extends WorkerFrameBase {
    type: 'warning';
    code: string;
    message: string;
    severity?: 'low' | 'medium' | 'high';
}
export interface FinalReportFrame extends WorkerFrameBase {
    type: 'final_report';
    status: 'succeeded';
    summary: string;
    artifacts?: Array<{
        artifact_id: string;
        kind?: string;
        uri?: string;
        sha256?: string;
    }>;
    verification?: {
        status: 'passed' | 'failed' | 'skipped';
        checks?: Array<{
            name: string;
            status: 'passed' | 'failed' | 'skipped';
            evidence?: string;
        }>;
    };
}
export interface FailureReportFrame extends WorkerFrameBase {
    type: 'failure_report';
    status: 'failed' | 'policy_blocked' | 'timed_out' | 'cancelled';
    error: {
        code: string;
        message: string;
        retryable?: boolean;
        details?: Record<string, unknown>;
    };
    resume_token?: string;
}
export type WorkerFrame = PlanFragmentFrame | ProposedPatchFrame | ProposedCommandFrame | RequestCapabilityFrame | CheckpointFrame | HeartbeatFrame | ArtifactReferenceFrame | WarningFrame | FinalReportFrame | FailureReportFrame;
export interface WorkerFrameValidationErrorDetail {
    path: string;
    message: string;
}
export type WorkerFrameValidationResult = {
    ok: true;
    frame: WorkerFrame;
} | {
    ok: false;
    errors: WorkerFrameValidationErrorDetail[];
};
export declare class WorkerProtocolValidationError extends Error {
    readonly errors: WorkerFrameValidationErrorDetail[];
    constructor(errors: WorkerFrameValidationErrorDetail[]);
}
export declare function validateWorkerFrame(input: unknown): WorkerFrameValidationResult;
export declare function parseWorkerFrame(input: unknown): WorkerFrame;
export declare function isWorkerFrame(input: unknown): input is WorkerFrame;
//# sourceMappingURL=worker-protocol.d.ts.map