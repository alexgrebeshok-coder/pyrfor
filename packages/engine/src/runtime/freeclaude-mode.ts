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

import { createHash, randomUUID } from 'node:crypto';
import {
  RunLifecycle,
  type RunMode,
  type RunRecord,
  type RunStatus,
} from './run-lifecycle';
import { EventLedger, type LedgerEvent } from './event-ledger';
import {
  PermissionEngine,
  type PermissionContext,
} from './permission-engine';
import {
  ArtifactStore,
  type ArtifactKind,
  type ArtifactRef,
} from './artifact-model';
import { logger } from '../observability/logger';

// ====== Internal type helpers ================================================

/**
 * Distributive omit over the LedgerEvent union.
 * Unlike `Omit<LedgerEvent, K>` (which collapses to only common keys),
 * this preserves each variant's unique fields while stripping the
 * auto-filled 'id', 'ts', and 'seq' fields.  Used as the argument type
 * for EventLedger.append() calls throughout this module.
 */
type EventAppendInput = LedgerEvent extends infer E
  ? Omit<E, 'ts' | 'seq' | 'id'>
  : never;

// ====== Re-exports & public types ============================================

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

// ====== Pure helpers =========================================================

/**
 * Compute a hex-encoded SHA-256 digest of a plan string.
 * Deterministic: same input always produces the same hash.
 */
export function hashPlan(plan: string): string {
  return createHash('sha256').update(plan, 'utf8').digest('hex');
}

/**
 * Return sensible default profiles for a given execution mode.
 *
 * - chat / edit  → 'standard' permission profile, conservative budget
 * - autonomous / pm → 'autonomous' permission profile, generous budget
 */
export function defaultProfileFor(mode: FreeClaudeMode): {
  permissionProfile: 'strict' | 'standard' | 'autonomous';
  budgetProfile: { maxTokens?: number; maxCostUsd?: number; maxRunSeconds?: number };
} {
  if (mode === 'autonomous' || mode === 'pm') {
    return {
      permissionProfile: 'autonomous',
      budgetProfile: { maxTokens: 500_000, maxCostUsd: 10, maxRunSeconds: 3_600 },
    };
  }
  return {
    permissionProfile: 'standard',
    budgetProfile: { maxTokens: 100_000, maxCostUsd: 2, maxRunSeconds: 600 },
  };
}

// ====== FreeClaudeRuntime ====================================================

/** Terminal statuses — a run in one of these states is no longer active. */
const INACTIVE_STATUSES = new Set<RunStatus>([
  'completed',
  'failed',
  'cancelled',
  'replayable',
  'archived',
]);

export class FreeClaudeRuntime {
  // ─── Injected dependencies ─────────────────────────────────────────────

  private readonly _cfg: FreeClaudeConfig;
  private readonly _ledger: EventLedger;
  private readonly _permissions: PermissionEngine;
  private readonly _artifacts: ArtifactStore;

  // ─── Internal state ────────────────────────────────────────────────────

  /** Fast in-memory session index; source-of-truth is the ledger on disk. */
  private readonly _sessions = new Map<string, FreeClaudeSession>();
  /** Mirror of the lifecycle state for each active run. */
  private readonly _records = new Map<string, RunRecord>();

  // ─── Constructor ───────────────────────────────────────────────────────

  constructor(
    cfg: FreeClaudeConfig,
    deps: {
      ledger: EventLedger;
      permissions: PermissionEngine;
      artifacts: ArtifactStore;
      /** Optional RunLifecycle instance (accepted for DI; static helpers are used internally). */
      lifecycle?: RunLifecycle;
    },
  ) {
    this._cfg = cfg;
    this._ledger = deps.ledger;
    this._permissions = deps.permissions;
    this._artifacts = deps.artifacts;
    // deps.lifecycle is accepted for API symmetry / future extension.
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  /** Return a session or throw if not found. */
  private _requireSession(runId: string): FreeClaudeSession {
    const session = this._sessions.get(runId);
    if (!session) throw new Error(`FreeClaudeRuntime: unknown runId "${runId}"`);
    return session;
  }

  /** Return a RunRecord or throw if not found. */
  private _requireRecord(runId: string): RunRecord {
    const record = this._records.get(runId);
    if (!record) throw new Error(`FreeClaudeRuntime: no record for runId "${runId}"`);
    return record;
  }

  /** Apply a lifecycle transition and sync the in-memory session. */
  private _applyTransition(runId: string, next: RunStatus): RunRecord {
    const record = this._requireRecord(runId);
    const updated = RunLifecycle.transition(record, next);
    this._records.set(runId, updated);
    const session = this._sessions.get(runId);
    if (session) {
      const isInactive = INACTIVE_STATUSES.has(next);
      this._sessions.set(runId, {
        ...session,
        status: next,
        ...(isInactive && !session.endedAt ? { endedAt: new Date().toISOString() } : {}),
      });
    }
    return updated;
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * Start a new run.
   *
   * Lifecycle:
   * - autonomous / pm  →  draft → planned
   * - chat / edit      →  draft → running
   *
   * Emits 'run.created' with mode, task, and optional parentRunId.
   */
  async startRun(opts: {
    task: string;
    parentRunId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<FreeClaudeSession> {
    const runId = randomUUID();
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();
    const cfg = this._cfg;

    // Build the run record starting in 'draft'.
    let record = RunLifecycle.create({
      run_id: runId,
      workspace_id: cfg.workspaceId,
      repo_id: cfg.workspaceId,
      mode: cfg.mode,
      task_id: opts.task,
      ...(opts.parentRunId ? { parent_run_id: opts.parentRunId } : {}),
      permission_profile: {
        profile: cfg.permissionProfile ?? 'standard',
      },
      budget_profile: {
        maxTokens: cfg.budgetProfile?.maxTokens,
        maxCostUsd: cfg.budgetProfile?.maxCostUsd,
        ...(cfg.budgetProfile?.maxRunSeconds !== undefined
          ? { maxWallMs: cfg.budgetProfile.maxRunSeconds * 1000 }
          : {}),
      },
    });

    // Advance past draft according to mode.
    // ALLOWED_TRANSITIONS: draft → planned → running  (no direct draft→running).
    record = RunLifecycle.transition(record, 'planned');
    if (cfg.mode === 'chat' || cfg.mode === 'edit') {
      record = RunLifecycle.transition(record, 'running');
    }

    this._records.set(runId, record);

    const session: FreeClaudeSession = {
      sessionId,
      runId,
      mode: cfg.mode,
      status: record.status,
      startedAt,
    };
    this._sessions.set(runId, session);

    await this._ledger.append({ type: 'run.created', run_id: runId, goal: opts.task } as EventAppendInput);

    logger.info('freeclaude.startRun', { runId, mode: cfg.mode, status: record.status });
    return { ...session };
  }

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
  async proposePlan(runId: string, plan: string): Promise<{ planHash: string }> {
    this._requireSession(runId);
    const planHash = hashPlan(plan);

    // Transition planned → awaiting_approval if currently in planned state.
    const record = this._requireRecord(runId);
    if (record.status === 'planned') {
      this._applyTransition(runId, 'awaiting_approval');
    }

    await this._ledger.append({ type: 'plan.proposed', run_id: runId, plan } as EventAppendInput);
    await this._ledger.append({ type: 'approval.requested', run_id: runId, reason: `plan_hash:${planHash}` } as EventAppendInput);

    logger.info('freeclaude.proposePlan', { runId, planHash });
    return { planHash };
  }

  /**
   * Approve a proposed plan.
   *
   * Transitions the run to 'running' and emits 'approval.granted'.
   */
  async approvePlan(runId: string, approvedBy: string): Promise<void> {
    this._requireSession(runId);
    this._applyTransition(runId, 'running');
    await this._ledger.append({ type: 'approval.granted', run_id: runId, approved_by: approvedBy } as EventAppendInput);
    logger.info('freeclaude.approvePlan', { runId, approvedBy });
  }

  /**
   * Deny a proposed plan.
   *
   * Transitions the run to 'cancelled' and emits 'approval.denied'.
   * 'approval.denied' is a first-class LedgerEventType — no fallback needed.
   */
  async denyPlan(runId: string, reason: string): Promise<void> {
    this._requireSession(runId);
    this._applyTransition(runId, 'cancelled');
    await this._ledger.append({ type: 'approval.denied', run_id: runId, reason } as EventAppendInput);
    logger.info('freeclaude.denyPlan', { runId, reason });
  }

  /**
   * Evaluate and record a tool call.
   *
   * - allowed (auto_allow / previously approved) → emit 'tool.requested', return {allowed:true}
   * - ask required (promptUser:true)             → return {allowed:false, error:'permission_required'}
   * - outright denied (promptUser:false)         → emit 'tool.requested', return {allowed:false}
   *
   * Actual tool execution is the caller's responsibility.
   */
  async recordToolCall(
    runId: string,
    tool: string,
    args: unknown,
    ctx: { workspaceId: string; sessionId: string },
  ): Promise<{ allowed: boolean; result?: unknown; error?: string }> {
    const permCtx: PermissionContext = {
      workspaceId: ctx.workspaceId,
      sessionId: ctx.sessionId,
      runId,
    };

    const decision = await this._permissions.check(tool, permCtx, args);

    if (!decision.allow) {
      if (decision.promptUser) {
        // User confirmation required — surface without emitting an event.
        return { allowed: false, error: 'permission_required' };
      }
      // Outright deny — still emit the request for auditability.
      await this._ledger.append({ type: 'tool.requested', run_id: runId, tool, args: args as Record<string, unknown> | undefined } as EventAppendInput);
      logger.info('freeclaude.recordToolCall.denied', { runId, tool });
      return { allowed: false };
    }

    await this._ledger.append({ type: 'tool.requested', run_id: runId, tool, args: args as Record<string, unknown> | undefined } as EventAppendInput);

    logger.info('freeclaude.recordToolCall.allowed', { runId, tool });
    return { allowed: true };
  }

  /**
   * Write an artifact to the store and record it in the ledger.
   *
   * @throws if the run is not active (completed, failed, cancelled, etc.)
   */
  async recordArtifact(
    runId: string,
    kind: ArtifactKind,
    content: string | Buffer,
    metadata?: Record<string, unknown>,
  ): Promise<ArtifactRef> {
    const session = this._requireSession(runId);
    if (INACTIVE_STATUSES.has(session.status)) {
      throw new Error(
        `FreeClaudeRuntime: cannot record artifact — run "${runId}" is not active (status: ${session.status})`,
      );
    }

    const ref = await this._artifacts.write(kind, content, {
      runId,
      meta: metadata,
    });

    await this._ledger.append({ type: 'artifact.created', run_id: runId, artifact_id: ref.id, files: [ref.uri] } as EventAppendInput);

    logger.info('freeclaude.recordArtifact', { runId, kind, artifactId: ref.id });
    return ref;
  }

  /**
   * Finish a run.
   *
   * Transitions and emits the corresponding terminal event:
   * - 'completed' → run.completed
   * - 'failed'    → run.failed
   * - 'cancelled' → run.cancelled
   */
  async completeRun(
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    summary?: string,
  ): Promise<void> {
    this._requireSession(runId);
    this._applyTransition(runId, status as RunStatus);

    if (status === 'completed') {
      await this._ledger.append({ type: 'run.completed', run_id: runId, status } as EventAppendInput);
    } else if (status === 'failed') {
      await this._ledger.append({ type: 'run.failed', run_id: runId, error: summary } as EventAppendInput);
    } else {
      await this._ledger.append({ type: 'run.cancelled', run_id: runId, reason: summary } as EventAppendInput);
    }

    logger.info('freeclaude.completeRun', { runId, status, summary });
  }

  /** Return a snapshot of the session for the given runId, or undefined. */
  getSession(runId: string): FreeClaudeSession | undefined {
    const s = this._sessions.get(runId);
    return s ? { ...s } : undefined;
  }

  /** Return all sessions that are currently active (not in a terminal state). */
  listActiveRuns(): FreeClaudeSession[] {
    return Array.from(this._sessions.values())
      .filter((s) => !INACTIVE_STATUSES.has(s.status))
      .map((s) => ({ ...s }));
  }
}
