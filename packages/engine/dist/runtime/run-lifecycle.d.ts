/**
 * run-lifecycle.ts — Canonical Run Lifecycle state-machine contract.
 *
 * Implements the Run record shape and state-machine transitions defined in
 * UNIFIED_PLAN_FINAL.md §4.1.  All exports are pure (no I/O, no side-effects).
 *
 * Features:
 * - Typed RunRecord with every plan-specified field
 * - ALLOWED_TRANSITIONS map enforcing the directed lifecycle graph
 * - RunLifecycle helper class (static-only pure utilities)
 * - InvalidTransitionError for rejected transitions
 */
/** All valid lifecycle statuses a run may occupy. */
export type RunStatus = 'draft' | 'planned' | 'awaiting_approval' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'replayable' | 'archived';
/** Execution mode of a run. */
export type RunMode = 'chat' | 'edit' | 'autonomous' | 'pm';
/**
 * Resource budget constraints applied to a run.
 * All fields are optional; absent means unbounded.
 */
export interface BudgetProfile {
    /** Maximum tokens the run may consume. */
    maxTokens?: number;
    /** Maximum cost in USD the run may incur. */
    maxCostUsd?: number;
    /** Maximum wall-clock time in milliseconds. */
    maxWallMs?: number;
    /** Maximum number of tool calls allowed. */
    maxToolCalls?: number;
}
/**
 * Permission constraints that govern tool-call approval for a run.
 */
export interface PermissionProfile {
    /** Base permission stance. */
    profile: 'strict' | 'standard' | 'autonomous';
    /**
     * Per-tool overrides keyed by tool name.
     * Values control when the user must approve that specific tool.
     */
    overrides?: Record<string, 'auto_allow' | 'ask_once' | 'ask_every_time' | 'deny'>;
}
/**
 * Canonical immutable record describing a single run's full lifecycle state.
 * All mutation is performed by producing a new record (copy-on-write).
 */
export interface RunRecord {
    /** Globally unique run identifier (UUID v4). */
    run_id: string;
    /** The task this run is executing. */
    task_id: string;
    /** Optional parent run that spawned this one (for sub-runs). */
    parent_run_id?: string;
    /** Workspace this run belongs to. */
    workspace_id: string;
    /** Repository this run operates on. */
    repo_id: string;
    /** Branch name or worktree path the run targets. */
    branch_or_worktree_id: string;
    /** Execution mode. */
    mode: RunMode;
    /** Identifier of the model configuration profile to use. */
    model_profile: string;
    /** Routing key selecting the provider/endpoint. */
    provider_route: string;
    /** Permission profile governing tool approvals. */
    permission_profile: PermissionProfile;
    /** Budget constraints for this run. */
    budget_profile: BudgetProfile;
    /** Content-hash of the context snapshot at run creation time. */
    context_snapshot_hash: string;
    /** Content-hash of the prompt snapshot at run creation time. */
    prompt_snapshot_hash: string;
    /** Ordered list of artifact content-addressed refs produced so far. */
    artifact_refs: string[];
    /** Ref to the final diff artifact, set on completion. */
    final_diff_ref?: string;
    /** Current lifecycle status. */
    status: RunStatus;
    /** ISO-8601 creation timestamp. */
    created_at: string;
    /** ISO-8601 last-update timestamp. */
    updated_at: string;
    /** Structured error attached when status is 'failed'. */
    error?: {
        /** Machine-readable error code. */
        code: string;
        /** Human-readable error description. */
        message: string;
    };
}
/**
 * Directed state-machine transition graph.
 * Maps each status to the set of statuses it may transition into.
 * Terminal nodes map to an empty array.
 */
export declare const ALLOWED_TRANSITIONS: Record<RunStatus, RunStatus[]>;
/**
 * Thrown by {@link RunLifecycle.transition} when a requested
 * status change is not permitted by {@link ALLOWED_TRANSITIONS}.
 */
export declare class InvalidTransitionError extends Error {
    /** The status the record was in before the attempted transition. */
    readonly from: RunStatus;
    /** The status that was requested. */
    readonly to: RunStatus;
    constructor(from: RunStatus, to: RunStatus);
}
/** Minimum fields required when constructing a new run. */
type RunInput = Partial<RunRecord> & {
    workspace_id: string;
    repo_id: string;
    mode: RunMode;
};
/**
 * Pure static utility class implementing the Run Lifecycle contract.
 *
 * All methods are side-effect free and return new {@link RunRecord} objects
 * rather than mutating their inputs.
 */
export declare class RunLifecycle {
    /**
     * Construct a RunLifecycle instance; primarily useful for DI/testing.
     * All functionality is also available as static methods.
     */
    constructor(initial: RunInput);
    /**
     * Create a new {@link RunRecord} in `draft` status.
     *
     * Required fields: `workspace_id`, `repo_id`, `mode`.
     * A `run_id` is auto-generated (UUID v4) if not supplied.
     * `artifact_refs` defaults to `[]`.
     * `created_at` / `updated_at` default to the current UTC instant.
     */
    static create(input: RunInput): RunRecord;
    /**
     * Return `true` when transitioning `from` → `to` is permitted.
     */
    static canTransition(from: RunStatus, to: RunStatus): boolean;
    /**
     * Produce a new {@link RunRecord} with `status` set to `next`.
     *
     * @throws {@link InvalidTransitionError} if the transition is not permitted.
     */
    static transition(record: RunRecord, next: RunStatus): RunRecord;
    /**
     * Return `true` when `status` is a terminal node (no outgoing transitions).
     */
    static isTerminal(status: RunStatus): boolean;
    /**
     * Return a new {@link RunRecord} with `ref` appended to `artifact_refs`.
     * Duplicate refs are silently deduplicated (set semantics).
     */
    static withArtifact(record: RunRecord, ref: string): RunRecord;
    /**
     * Return a new {@link RunRecord} with `status` set to `'failed'` and
     * `error` populated with `{ code, message }`.
     *
     * Only valid when the current status can legally transition to `'failed'`
     * (i.e. `running` or `blocked`).
     *
     * @throws {@link InvalidTransitionError} if the record is not in a state
     *   that permits transitioning to `'failed'`.
     */
    static withError(record: RunRecord, code: string, message: string): RunRecord;
}
export {};
//# sourceMappingURL=run-lifecycle.d.ts.map