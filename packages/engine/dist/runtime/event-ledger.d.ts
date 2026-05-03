/**
 * event-ledger.ts — Append-only JSONL event ledger for Pyrfor run auditing.
 *
 * Features:
 * - Discriminated-union LedgerEvent covering the full run lifecycle
 * - Atomic appends (open 'a', write line, optional fsync)
 * - Crash-safe: never overwrites existing lines; corrupt lines skipped with warn
 * - Line-by-line streaming via readline for memory-efficient reads
 * - Monotonic seq counter seeded from on-disk line count at first open
 */
export type LedgerEventType = 'run.created' | 'run.transitioned' | 'plan.proposed' | 'approval.requested' | 'approval.granted' | 'approval.denied' | 'model.turn.started' | 'model.turn.completed' | 'tool.requested' | 'tool.approved' | 'tool.denied' | 'tool.executed' | 'effect.proposed' | 'effect.policy_decided' | 'effect.applied' | 'effect.denied' | 'effect.failed' | 'dag.created' | 'dag.node.ready' | 'dag.node.started' | 'dag.node.completed' | 'dag.node.failed' | 'dag.lease.acquired' | 'dag.lease.released' | 'verifier.started' | 'verifier.completed' | 'verifier.waived' | 'eval.completed' | 'artifact.created' | 'diff.proposed' | 'diff.applied' | 'test.completed' | 'run.blocked' | 'run.completed' | 'run.failed' | 'run.cancelled';
interface EventBase {
    /** UUID v4 */
    id: string;
    /** ISO 8601 timestamp */
    ts: string;
    /** Owning run identifier */
    run_id: string;
    /** Monotonically increasing per-ledger sequence number (0-based) */
    seq: number;
}
export interface RunCreatedEvent extends EventBase {
    type: 'run.created';
    goal?: string;
    provider?: string;
    model?: string;
    task_id?: string;
    parent_run_id?: string;
    workspace_id?: string;
    repo_id?: string;
    branch_or_worktree_id?: string;
    mode?: string;
    status?: string;
    model_profile?: string;
    provider_route?: string;
    context_snapshot_hash?: string;
    prompt_snapshot_hash?: string;
    artifact_refs?: string[];
    permission_profile?: unknown;
    budget_profile?: unknown;
}
export interface RunTransitionedEvent extends EventBase {
    type: 'run.transitioned';
    from: string;
    to: string;
    reason?: string;
}
export interface PlanProposedEvent extends EventBase {
    type: 'plan.proposed';
    plan?: string;
    steps?: number;
}
export interface ApprovalRequestedEvent extends EventBase {
    type: 'approval.requested';
    reason?: string;
    tool?: string;
}
export interface ApprovalGrantedEvent extends EventBase {
    type: 'approval.granted';
    approved_by?: string;
    tool?: string;
}
export interface ApprovalDeniedEvent extends EventBase {
    type: 'approval.denied';
    approved_by?: string;
    reason?: string;
    tool?: string;
}
export interface ModelTurnStartedEvent extends EventBase {
    type: 'model.turn.started';
    model?: string;
    provider?: string;
    turn?: number;
}
export interface ModelTurnCompletedEvent extends EventBase {
    type: 'model.turn.completed';
    model?: string;
    provider?: string;
    turn?: number;
    ms?: number;
    tokens?: number;
}
export interface ToolRequestedEvent extends EventBase {
    type: 'tool.requested';
    tool?: string;
    args?: Record<string, unknown>;
}
export interface ToolApprovedEvent extends EventBase {
    type: 'tool.approved';
    tool?: string;
    approved_by?: string;
}
export interface ToolDeniedEvent extends EventBase {
    type: 'tool.denied';
    tool?: string;
    reason?: string;
}
export interface ToolExecutedEvent extends EventBase {
    type: 'tool.executed';
    tool?: string;
    ms?: number;
    status?: string;
    error?: string;
}
export interface EffectProposedEvent extends EventBase {
    type: 'effect.proposed';
    effect_id: string;
    effect_kind: string;
    tool?: string;
    preview?: string;
    idempotency_key?: string;
}
export interface EffectPolicyDecidedEvent extends EventBase {
    type: 'effect.policy_decided';
    effect_id: string;
    decision: string;
    policy_id?: string;
    reason?: string;
    approval_required?: boolean;
}
export interface EffectAppliedEvent extends EventBase {
    type: 'effect.applied';
    effect_id: string;
    status?: string;
    ms?: number;
    rollback_handle?: string;
}
export interface EffectDeniedEvent extends EventBase {
    type: 'effect.denied';
    effect_id: string;
    reason?: string;
}
export interface EffectFailedEvent extends EventBase {
    type: 'effect.failed';
    effect_id: string;
    error?: string;
    ms?: number;
}
export interface DagCreatedEvent extends EventBase {
    type: 'dag.created';
    dag_id?: string;
    node_count?: number;
}
export interface DagNodeReadyEvent extends EventBase {
    type: 'dag.node.ready';
    dag_id?: string;
    node_id: string;
    kind?: string;
    idempotency_key?: string;
}
export interface DagNodeStartedEvent extends EventBase {
    type: 'dag.node.started';
    dag_id?: string;
    node_id: string;
    owner?: string;
    attempt?: number;
}
export interface DagNodeCompletedEvent extends EventBase {
    type: 'dag.node.completed';
    dag_id?: string;
    node_id: string;
    artifact_refs?: string[];
}
export interface DagNodeFailedEvent extends EventBase {
    type: 'dag.node.failed';
    dag_id?: string;
    node_id: string;
    reason?: string;
    retryable?: boolean;
}
export interface DagLeaseAcquiredEvent extends EventBase {
    type: 'dag.lease.acquired';
    dag_id?: string;
    node_id: string;
    owner: string;
    expires_at: number;
}
export interface DagLeaseReleasedEvent extends EventBase {
    type: 'dag.lease.released';
    dag_id?: string;
    node_id: string;
    owner?: string;
    reason?: string;
}
export interface VerifierStartedEvent extends EventBase {
    type: 'verifier.started';
    subject_id: string;
    subject_type?: string;
    validators?: string[];
}
export interface VerifierCompletedEvent extends EventBase {
    type: 'verifier.completed';
    subject_id: string;
    status: string;
    action?: string;
    reason?: string;
    findings?: number;
}
export interface VerifierWaivedEvent extends EventBase {
    type: 'verifier.waived';
    status: 'waived';
    waived_from: string;
    approved_by: string;
    reason: string;
    scope: string;
    artifact_id?: string;
}
export interface EvalCompletedEvent extends EventBase {
    type: 'eval.completed';
    suite: string;
    passed: number;
    failed: number;
    status: string;
}
export interface ArtifactCreatedEvent extends EventBase {
    type: 'artifact.created';
    files?: string[];
    artifact_id?: string;
}
export interface DiffProposedEvent extends EventBase {
    type: 'diff.proposed';
    files?: string[];
    lines_added?: number;
    lines_removed?: number;
}
export interface DiffAppliedEvent extends EventBase {
    type: 'diff.applied';
    files?: string[];
    ms?: number;
}
export interface TestCompletedEvent extends EventBase {
    type: 'test.completed';
    passed?: number;
    failed?: number;
    skipped?: number;
    ms?: number;
    status?: string;
}
export interface RunBlockedEvent extends EventBase {
    type: 'run.blocked';
    reason?: string;
}
export interface RunCompletedEvent extends EventBase {
    type: 'run.completed';
    ms?: number;
    status?: string;
}
export interface RunFailedEvent extends EventBase {
    type: 'run.failed';
    error?: string;
    ms?: number;
}
export interface RunCancelledEvent extends EventBase {
    type: 'run.cancelled';
    reason?: string;
}
export type LedgerEvent = RunCreatedEvent | RunTransitionedEvent | PlanProposedEvent | ApprovalRequestedEvent | ApprovalGrantedEvent | ApprovalDeniedEvent | ModelTurnStartedEvent | ModelTurnCompletedEvent | ToolRequestedEvent | ToolApprovedEvent | ToolDeniedEvent | ToolExecutedEvent | EffectProposedEvent | EffectPolicyDecidedEvent | EffectAppliedEvent | EffectDeniedEvent | EffectFailedEvent | DagCreatedEvent | DagNodeReadyEvent | DagNodeStartedEvent | DagNodeCompletedEvent | DagNodeFailedEvent | DagLeaseAcquiredEvent | DagLeaseReleasedEvent | VerifierStartedEvent | VerifierCompletedEvent | VerifierWaivedEvent | EvalCompletedEvent | ArtifactCreatedEvent | DiffProposedEvent | DiffAppliedEvent | TestCompletedEvent | RunBlockedEvent | RunCompletedEvent | RunFailedEvent | RunCancelledEvent;
export type LedgerAppendInput = LedgerEvent extends infer Event ? Event extends LedgerEvent ? Omit<Event, 'id' | 'ts' | 'seq'> : never : never;
export type LegacyLedgerAppendInput = Omit<LedgerEvent, 'id' | 'ts' | 'seq'>;
/**
 * Parse a single JSONL line. Returns null (and warns) on corrupt input.
 */
export declare function parseLine(line: string): LedgerEvent | null;
/**
 * Construct a LedgerEvent with auto-generated id and ts; seq defaults to 0.
 * Useful for testing or pre-building events before appending.
 */
export declare function makeEvent(partial: Omit<LedgerEvent, 'id' | 'ts' | 'seq'> & {
    seq?: number;
}): LedgerEvent;
export interface EventLedgerOptions {
    /** If true, fsync is called after every append for crash durability. */
    fsync?: boolean;
}
export type EventLedgerListener = (event: LedgerEvent) => void;
export declare class EventLedger {
    private readonly filePath;
    private readonly opts;
    /** Monotonic counter — seeded from line count on first append/read. */
    private seq;
    /** Whether seq has been initialised from disk. */
    private seqReady;
    private readonly listeners;
    constructor(filePath: string, opts?: EventLedgerOptions);
    /** Ensure parent directory exists. */
    private ensureDir;
    /** Count existing lines to seed the seq counter (called once). */
    private initSeq;
    /**
     * Append a new event. Auto-fills `id`, `ts`, and `seq`.
     * Uses 'a' flag so existing data is never overwritten.
     */
    append(event: LedgerAppendInput | LegacyLedgerAppendInput): Promise<LedgerEvent>;
    subscribe(listener: EventLedgerListener): () => void;
    private notify;
    /**
     * Read all events from the ledger file.
     * Corrupt lines are skipped (logged as warn).
     */
    readAll(): Promise<LedgerEvent[]>;
    /**
     * Stream events line-by-line. Tolerant of a partial last line.
     * Corrupt lines are skipped.
     */
    readStream(): AsyncIterable<LedgerEvent>;
    /**
     * Return all events matching `predicate`.
     */
    filter(predicate: (e: LedgerEvent) => boolean): Promise<LedgerEvent[]>;
    /**
     * Return all events for a given run_id in append order.
     */
    byRun(runId: string): Promise<LedgerEvent[]>;
    /**
     * Return the most-recently appended event for a given run_id.
     */
    lastEventForRun(runId: string): Promise<LedgerEvent | undefined>;
    /**
     * No-op for API symmetry; individual appends use short-lived file handles.
     */
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=event-ledger.d.ts.map