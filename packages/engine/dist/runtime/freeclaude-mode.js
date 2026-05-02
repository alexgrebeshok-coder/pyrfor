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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash, randomUUID } from 'node:crypto';
import { RunLifecycle, } from './run-lifecycle.js';
import { logger } from '../observability/logger.js';
// ====== Pure helpers =========================================================
/**
 * Compute a hex-encoded SHA-256 digest of a plan string.
 * Deterministic: same input always produces the same hash.
 */
export function hashPlan(plan) {
    return createHash('sha256').update(plan, 'utf8').digest('hex');
}
/**
 * Return sensible default profiles for a given execution mode.
 *
 * - chat / edit  → 'standard' permission profile, conservative budget
 * - autonomous / pm → 'autonomous' permission profile, generous budget
 */
export function defaultProfileFor(mode) {
    if (mode === 'autonomous' || mode === 'pm') {
        return {
            permissionProfile: 'autonomous',
            budgetProfile: { maxTokens: 500000, maxCostUsd: 10, maxRunSeconds: 3600 },
        };
    }
    return {
        permissionProfile: 'standard',
        budgetProfile: { maxTokens: 100000, maxCostUsd: 2, maxRunSeconds: 600 },
    };
}
// ====== FreeClaudeRuntime ====================================================
/** Terminal statuses — a run in one of these states is no longer active. */
const INACTIVE_STATUSES = new Set([
    'completed',
    'failed',
    'cancelled',
    'replayable',
    'archived',
]);
export class FreeClaudeRuntime {
    // ─── Constructor ───────────────────────────────────────────────────────
    constructor(cfg, deps) {
        // ─── Internal state ────────────────────────────────────────────────────
        /** Fast in-memory session index; source-of-truth is the ledger on disk. */
        this._sessions = new Map();
        /** Mirror of the lifecycle state for each active run. */
        this._records = new Map();
        this._cfg = cfg;
        this._ledger = deps.ledger;
        this._permissions = deps.permissions;
        this._artifacts = deps.artifacts;
        // deps.lifecycle is accepted for API symmetry / future extension.
    }
    // ─── Private helpers ───────────────────────────────────────────────────
    /** Return a session or throw if not found. */
    _requireSession(runId) {
        const session = this._sessions.get(runId);
        if (!session)
            throw new Error(`FreeClaudeRuntime: unknown runId "${runId}"`);
        return session;
    }
    /** Return a RunRecord or throw if not found. */
    _requireRecord(runId) {
        const record = this._records.get(runId);
        if (!record)
            throw new Error(`FreeClaudeRuntime: no record for runId "${runId}"`);
        return record;
    }
    /** Apply a lifecycle transition and sync the in-memory session. */
    _applyTransition(runId, next) {
        const record = this._requireRecord(runId);
        const updated = RunLifecycle.transition(record, next);
        this._records.set(runId, updated);
        const session = this._sessions.get(runId);
        if (session) {
            const isInactive = INACTIVE_STATUSES.has(next);
            this._sessions.set(runId, Object.assign(Object.assign(Object.assign({}, session), { status: next }), (isInactive && !session.endedAt ? { endedAt: new Date().toISOString() } : {})));
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
    startRun(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const runId = randomUUID();
            const sessionId = randomUUID();
            const startedAt = new Date().toISOString();
            const cfg = this._cfg;
            // Build the run record starting in 'draft'.
            let record = RunLifecycle.create(Object.assign(Object.assign({ run_id: runId, workspace_id: cfg.workspaceId, repo_id: cfg.workspaceId, mode: cfg.mode, task_id: opts.task }, (opts.parentRunId ? { parent_run_id: opts.parentRunId } : {})), { permission_profile: {
                    profile: (_a = cfg.permissionProfile) !== null && _a !== void 0 ? _a : 'standard',
                }, budget_profile: Object.assign({ maxTokens: (_b = cfg.budgetProfile) === null || _b === void 0 ? void 0 : _b.maxTokens, maxCostUsd: (_c = cfg.budgetProfile) === null || _c === void 0 ? void 0 : _c.maxCostUsd }, (((_d = cfg.budgetProfile) === null || _d === void 0 ? void 0 : _d.maxRunSeconds) !== undefined
                    ? { maxWallMs: cfg.budgetProfile.maxRunSeconds * 1000 }
                    : {})) }));
            // Advance past draft according to mode.
            // ALLOWED_TRANSITIONS: draft → planned → running  (no direct draft→running).
            record = RunLifecycle.transition(record, 'planned');
            if (cfg.mode === 'chat' || cfg.mode === 'edit') {
                record = RunLifecycle.transition(record, 'running');
            }
            this._records.set(runId, record);
            const session = {
                sessionId,
                runId,
                mode: cfg.mode,
                status: record.status,
                startedAt,
            };
            this._sessions.set(runId, session);
            yield this._ledger.append({ type: 'run.created', run_id: runId, goal: opts.task });
            logger.info('freeclaude.startRun', { runId, mode: cfg.mode, status: record.status });
            return Object.assign({}, session);
        });
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
    proposePlan(runId, plan) {
        return __awaiter(this, void 0, void 0, function* () {
            this._requireSession(runId);
            const planHash = hashPlan(plan);
            // Transition planned → awaiting_approval if currently in planned state.
            const record = this._requireRecord(runId);
            if (record.status === 'planned') {
                this._applyTransition(runId, 'awaiting_approval');
            }
            yield this._ledger.append({ type: 'plan.proposed', run_id: runId, plan });
            yield this._ledger.append({ type: 'approval.requested', run_id: runId, reason: `plan_hash:${planHash}` });
            logger.info('freeclaude.proposePlan', { runId, planHash });
            return { planHash };
        });
    }
    /**
     * Approve a proposed plan.
     *
     * Transitions the run to 'running' and emits 'approval.granted'.
     */
    approvePlan(runId, approvedBy) {
        return __awaiter(this, void 0, void 0, function* () {
            this._requireSession(runId);
            this._applyTransition(runId, 'running');
            yield this._ledger.append({ type: 'approval.granted', run_id: runId, approved_by: approvedBy });
            logger.info('freeclaude.approvePlan', { runId, approvedBy });
        });
    }
    /**
     * Deny a proposed plan.
     *
     * Transitions the run to 'cancelled' and emits 'approval.denied'.
     * 'approval.denied' is a first-class LedgerEventType — no fallback needed.
     */
    denyPlan(runId, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            this._requireSession(runId);
            this._applyTransition(runId, 'cancelled');
            yield this._ledger.append({ type: 'approval.denied', run_id: runId, reason });
            logger.info('freeclaude.denyPlan', { runId, reason });
        });
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
    recordToolCall(runId, tool, args, ctx) {
        return __awaiter(this, void 0, void 0, function* () {
            const permCtx = {
                workspaceId: ctx.workspaceId,
                sessionId: ctx.sessionId,
                runId,
            };
            const decision = yield this._permissions.check(tool, permCtx, args);
            if (!decision.allow) {
                if (decision.promptUser) {
                    // User confirmation required — surface without emitting an event.
                    return { allowed: false, error: 'permission_required' };
                }
                // Outright deny — still emit the request for auditability.
                yield this._ledger.append({ type: 'tool.requested', run_id: runId, tool, args: args });
                logger.info('freeclaude.recordToolCall.denied', { runId, tool });
                return { allowed: false };
            }
            yield this._ledger.append({ type: 'tool.requested', run_id: runId, tool, args: args });
            logger.info('freeclaude.recordToolCall.allowed', { runId, tool });
            return { allowed: true };
        });
    }
    /**
     * Write an artifact to the store and record it in the ledger.
     *
     * @throws if the run is not active (completed, failed, cancelled, etc.)
     */
    recordArtifact(runId, kind, content, metadata) {
        return __awaiter(this, void 0, void 0, function* () {
            const session = this._requireSession(runId);
            if (INACTIVE_STATUSES.has(session.status)) {
                throw new Error(`FreeClaudeRuntime: cannot record artifact — run "${runId}" is not active (status: ${session.status})`);
            }
            const ref = yield this._artifacts.write(kind, content, {
                runId,
                meta: metadata,
            });
            yield this._ledger.append({ type: 'artifact.created', run_id: runId, artifact_id: ref.id, files: [ref.uri] });
            logger.info('freeclaude.recordArtifact', { runId, kind, artifactId: ref.id });
            return ref;
        });
    }
    /**
     * Finish a run.
     *
     * Transitions and emits the corresponding terminal event:
     * - 'completed' → run.completed
     * - 'failed'    → run.failed
     * - 'cancelled' → run.cancelled
     */
    completeRun(runId, status, summary) {
        return __awaiter(this, void 0, void 0, function* () {
            this._requireSession(runId);
            this._applyTransition(runId, status);
            if (status === 'completed') {
                yield this._ledger.append({ type: 'run.completed', run_id: runId, status });
            }
            else if (status === 'failed') {
                yield this._ledger.append({ type: 'run.failed', run_id: runId, error: summary });
            }
            else {
                yield this._ledger.append({ type: 'run.cancelled', run_id: runId, reason: summary });
            }
            logger.info('freeclaude.completeRun', { runId, status, summary });
        });
    }
    /** Return a snapshot of the session for the given runId, or undefined. */
    getSession(runId) {
        const s = this._sessions.get(runId);
        return s ? Object.assign({}, s) : undefined;
    }
    /** Return all sessions that are currently active (not in a terminal state). */
    listActiveRuns() {
        return Array.from(this._sessions.values())
            .filter((s) => !INACTIVE_STATUSES.has(s.status))
            .map((s) => (Object.assign({}, s)));
    }
}
