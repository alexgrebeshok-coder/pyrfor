/**
 * freeclaude-mode.ts — FreeClaude Mode core integration.
 *
 * Wires the canonical Pyrfor contracts (run-lifecycle, event-ledger,
 * permission-engine, artifact-model) into a "FreeClaude-style" autonomous
 * mode that runs entirely inside the Pyrfor engine.
 *
 * Contract adaptations
 * ──────────────────────────────────────────────────────────────────────────
 * • FreeClaudeMode is a type alias for RunMode (chat | edit | autonomous | pm)
 *   from run-lifecycle; re-exported for consumer convenience.
 * • FreeClaudeConfig.budgetProfile uses maxRunSeconds (spec naming) while the
 *   internal BudgetProfile from run-lifecycle uses maxWallMs.  Conversion:
 *   maxWallMs = maxRunSeconds * 1000.
 * • LedgerEventType 'approval.denied' exists in the event-ledger union, so no
 *   fallback to 'run.blocked' is required.
 * • deps.lifecycle accepts a RunLifecycle instance for DI/testing; all
 *   transition logic uses the static RunLifecycle.* helpers since the instance
 *   only wraps a single RunRecord and we manage multiple runs.
 */
import { RunLifecycle, type RunMode, type RunStatus } from './run-lifecycle';
import { EventLedger } from './event-ledger';
import { PermissionEngine } from './permission-engine';
import { ArtifactStore, type ArtifactKind, type ArtifactRef } from './artifact-model';
/** Execution mode; direct re-export of RunMode from run-lifecycle. */
export type FreeClaudeMode = RunMode;
/**
 * Configuration for a FreeClaudeRuntime instance.
 * One instance typically manages many runs within the same workspace.
 */
export interface FreeClaudeConfig {
    /** Execution mode applied to every run started by this runtime. */
    mode: FreeClaudeMode;
    /** Owning workspace identifier. */
    workspaceId: string;
    /** Working directory for the runtime. */
    rootDir: string;
    /**
     * Permission stance applied to tool-call evaluation.
     * Defaults to 'standard'.
     */
    permissionProfile?: 'strict' | 'standard' | 'autonomous';
    /**
     * Resource budget constraints.
     * maxRunSeconds is converted to maxWallMs internally (× 1000).
     */
    budgetProfile?: {
        maxTokens?: number;
        maxCostUsd?: number;
        maxRunSeconds?: number;
    };
    /**
     * When true, read-only tools are auto-approved without a permission prompt.
     * Defaults to true.
     */
    autoApproveReads?: boolean;
    /** Absolute path to the append-only events.jsonl ledger file. */
    ledgerPath: string;
    /** Filesystem root under which artifacts are stored. */
    artifactRoot: string;
}
/** Lightweight session snapshot; persisted in-memory for fast lookup. */
export interface FreeClaudeSession {
    sessionId: string;
    runId: string;
    mode: FreeClaudeMode;
    status: RunStatus;
    startedAt: string;
    endedAt?: string;
}
/**
 * Compute a hex-encoded SHA-256 digest of a plan string.
 * Deterministic: same input always produces the same hash.
 */
export declare function hashPlan(plan: string): string;
/**
 * Return sensible default profiles for a given execution mode.
 *
 * - chat / edit  → 'standard' permission profile, conservative budget
 * - autonomous / pm → 'autonomous' permission profile, generous budget
 */
export declare function defaultProfileFor(mode: FreeClaudeMode): {
    permissionProfile: 'strict' | 'standard' | 'autonomous';
    budgetProfile: {
        maxTokens?: number;
        maxCostUsd?: number;
        maxRunSeconds?: number;
    };
};
export declare class FreeClaudeRuntime {
    private readonly _cfg;
    private readonly _ledger;
    private readonly _permissions;
    private readonly _artifacts;
    /** Fast in-memory session index; source-of-truth is the ledger on disk. */
    private readonly _sessions;
    /** Mirror of the lifecycle state for each active run. */
    private readonly _records;
    constructor(cfg: FreeClaudeConfig, deps: {
        ledger: EventLedger;
        permissions: PermissionEngine;
        artifacts: ArtifactStore;
        /** Optional RunLifecycle instance (accepted for DI; static helpers are used internally). */
        lifecycle?: RunLifecycle;
    });
    /** Return a session or throw if not found. */
    private _requireSession;
    /** Return a RunRecord or throw if not found. */
    private _requireRecord;
    /** Apply a lifecycle transition and sync the in-memory session. */
    private _applyTransition;
    /**
     * Start a new run.
     *
     * Lifecycle:
     * - autonomous / pm  →  draft → planned
     * - chat / edit      →  draft → running
     *
     * Emits 'run.created' with mode, task, and optional parentRunId.
     */
    startRun(opts: {
        task: string;
        parentRunId?: string;
        metadata?: Record<string, unknown>;
    }): Promise<FreeClaudeSession>;
    /**
     * Propose a plan for an autonomous/pm run.
     *
     * Computes a SHA-256 hash of the plan text, transitions the run from
     * 'planned' → 'awaiting_approval' if needed, and emits:
     *   1. 'plan.proposed'
     *   2. 'approval.requested'
     *
     * Returns { planHash } — the hex SHA-256 digest.
     */
    proposePlan(runId: string, plan: string): Promise<{
        planHash: string;
    }>;
    /**
     * Approve a proposed plan.
     *
     * Transitions the run to 'running' and emits 'approval.granted'.
     */
    approvePlan(runId: string, approvedBy: string): Promise<void>;
    /**
     * Deny a proposed plan.
     *
     * Transitions the run to 'cancelled' and emits 'approval.denied'.
     * 'approval.denied' is a first-class LedgerEventType — no fallback needed.
     */
    denyPlan(runId: string, reason: string): Promise<void>;
    /**
     * Evaluate and record a tool call.
     *
     * - allowed (auto_allow / previously approved) → emit 'tool.requested', return {allowed:true}
     * - ask required (promptUser:true)             → return {allowed:false, error:'permission_required'}
     * - outright denied (promptUser:false)         → emit 'tool.requested', return {allowed:false}
     *
     * Actual tool execution is the caller's responsibility.
     */
    recordToolCall(runId: string, tool: string, args: unknown, ctx: {
        workspaceId: string;
        sessionId: string;
    }): Promise<{
        allowed: boolean;
        result?: unknown;
        error?: string;
    }>;
    /**
     * Write an artifact to the store and record it in the ledger.
     *
     * @throws if the run is not active (completed, failed, cancelled, etc.)
     */
    recordArtifact(runId: string, kind: ArtifactKind, content: string | Buffer, metadata?: Record<string, unknown>): Promise<ArtifactRef>;
    /**
     * Finish a run.
     *
     * Transitions and emits the corresponding terminal event:
     * - 'completed' → run.completed
     * - 'failed'    → run.failed
     * - 'cancelled' → run.cancelled
     */
    completeRun(runId: string, status: 'completed' | 'failed' | 'cancelled', summary?: string): Promise<void>;
    /** Return a snapshot of the session for the given runId, or undefined. */
    getSession(runId: string): FreeClaudeSession | undefined;
    /** Return all sessions that are currently active (not in a terminal state). */
    listActiveRuns(): FreeClaudeSession[];
}
//# sourceMappingURL=freeclaude-mode.d.ts.map