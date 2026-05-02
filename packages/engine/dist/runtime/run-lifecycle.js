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
// ============================================
// Transition graph
// ============================================
/**
 * Directed state-machine transition graph.
 * Maps each status to the set of statuses it may transition into.
 * Terminal nodes map to an empty array.
 */
export const ALLOWED_TRANSITIONS = {
    draft: ['planned', 'cancelled'],
    planned: ['awaiting_approval', 'running', 'cancelled'],
    awaiting_approval: ['running', 'cancelled', 'blocked'],
    running: ['blocked', 'completed', 'failed', 'cancelled'],
    blocked: ['running', 'cancelled', 'failed'],
    completed: ['replayable', 'archived'],
    failed: ['replayable', 'archived'],
    cancelled: ['archived'],
    replayable: ['archived', 'running'],
    archived: [],
};
// ============================================
// Error
// ============================================
/**
 * Thrown by {@link RunLifecycle.transition} when a requested
 * status change is not permitted by {@link ALLOWED_TRANSITIONS}.
 */
export class InvalidTransitionError extends Error {
    constructor(from, to) {
        super(`Invalid run lifecycle transition: ${from} → ${to}`);
        this.name = 'InvalidTransitionError';
        this.from = from;
        this.to = to;
        // Maintain proper prototype chain in transpiled ES5 environments.
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
/**
 * Pure static utility class implementing the Run Lifecycle contract.
 *
 * All methods are side-effect free and return new {@link RunRecord} objects
 * rather than mutating their inputs.
 */
export class RunLifecycle {
    /**
     * Construct a RunLifecycle instance; primarily useful for DI/testing.
     * All functionality is also available as static methods.
     */
    constructor(initial) {
        // Expose the constructed record on the instance for convenience.
        this.record = RunLifecycle.create(initial);
    }
    // ──────────────────────────────────────────
    // Static factory
    // ──────────────────────────────────────────
    /**
     * Create a new {@link RunRecord} in `draft` status.
     *
     * Required fields: `workspace_id`, `repo_id`, `mode`.
     * A `run_id` is auto-generated (UUID v4) if not supplied.
     * `artifact_refs` defaults to `[]`.
     * `created_at` / `updated_at` default to the current UTC instant.
     */
    static create(input) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        const now = new Date().toISOString();
        return Object.assign(Object.assign({ task_id: (_a = input.task_id) !== null && _a !== void 0 ? _a : '', model_profile: (_b = input.model_profile) !== null && _b !== void 0 ? _b : '', provider_route: (_c = input.provider_route) !== null && _c !== void 0 ? _c : '', context_snapshot_hash: (_d = input.context_snapshot_hash) !== null && _d !== void 0 ? _d : '', prompt_snapshot_hash: (_e = input.prompt_snapshot_hash) !== null && _e !== void 0 ? _e : '', branch_or_worktree_id: (_f = input.branch_or_worktree_id) !== null && _f !== void 0 ? _f : '', permission_profile: (_g = input.permission_profile) !== null && _g !== void 0 ? _g : { profile: 'standard' }, budget_profile: (_h = input.budget_profile) !== null && _h !== void 0 ? _h : {} }, input), { run_id: (_j = input.run_id) !== null && _j !== void 0 ? _j : crypto.randomUUID(), status: 'draft', artifact_refs: (_k = input.artifact_refs) !== null && _k !== void 0 ? _k : [], created_at: (_l = input.created_at) !== null && _l !== void 0 ? _l : now, updated_at: (_m = input.updated_at) !== null && _m !== void 0 ? _m : now });
    }
    // ──────────────────────────────────────────
    // Transition helpers
    // ──────────────────────────────────────────
    /**
     * Return `true` when transitioning `from` → `to` is permitted.
     */
    static canTransition(from, to) {
        return ALLOWED_TRANSITIONS[from].includes(to);
    }
    /**
     * Produce a new {@link RunRecord} with `status` set to `next`.
     *
     * @throws {@link InvalidTransitionError} if the transition is not permitted.
     */
    static transition(record, next) {
        if (!RunLifecycle.canTransition(record.status, next)) {
            throw new InvalidTransitionError(record.status, next);
        }
        return Object.assign(Object.assign({}, record), { status: next, updated_at: new Date().toISOString() });
    }
    /**
     * Return `true` when `status` is a terminal node (no outgoing transitions).
     */
    static isTerminal(status) {
        return ALLOWED_TRANSITIONS[status].length === 0;
    }
    // ──────────────────────────────────────────
    // Record helpers
    // ──────────────────────────────────────────
    /**
     * Return a new {@link RunRecord} with `ref` appended to `artifact_refs`.
     * Duplicate refs are silently deduplicated (set semantics).
     */
    static withArtifact(record, ref) {
        if (record.artifact_refs.includes(ref))
            return record;
        return Object.assign(Object.assign({}, record), { artifact_refs: [...record.artifact_refs, ref], updated_at: new Date().toISOString() });
    }
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
    static withError(record, code, message) {
        const transitioned = RunLifecycle.transition(record, 'failed');
        return Object.assign(Object.assign({}, transitioned), { error: { code, message } });
    }
}
