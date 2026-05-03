/**
 * run-ledger.ts — durable RunLifecycle facade backed by EventLedger.
 *
 * This is the M0 orchestration substrate: a small API that keeps the canonical
 * in-memory RunRecord in sync with append-only ledger events. Workers and
 * adapters should use this instead of mutating run state directly.
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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { ALLOWED_TRANSITIONS, RunLifecycle, } from './run-lifecycle.js';
const RUN_MODES = new Set(['chat', 'edit', 'autonomous', 'pm']);
const RUN_STATUSES = new Set(Object.keys(ALLOWED_TRANSITIONS));
const ARTIFACT_INACTIVE_STATUSES = new Set([
    'completed',
    'failed',
    'cancelled',
    'archived',
]);
function isRunMode(value) {
    return typeof value === 'string' && RUN_MODES.has(value);
}
function isRunStatus(value) {
    return typeof value === 'string' && RUN_STATUSES.has(value);
}
function asPermissionProfile(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const profile = value.profile;
    if (profile === 'strict' || profile === 'standard' || profile === 'autonomous') {
        return value;
    }
    return undefined;
}
function asBudgetProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    return value;
}
function cloneRecord(record) {
    return Object.assign(Object.assign({}, record), { artifact_refs: [...record.artifact_refs], permission_profile: Object.assign(Object.assign({}, record.permission_profile), { overrides: record.permission_profile.overrides
                ? Object.assign({}, record.permission_profile.overrides) : undefined }), budget_profile: Object.assign({}, record.budget_profile), error: record.error ? Object.assign({}, record.error) : undefined });
}
export class RunLedger {
    constructor(options) {
        this.records = new Map();
        this.ledger = options.ledger;
    }
    createRun(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const { goal } = input, recordInput = __rest(input, ["goal"]);
            const record = RunLifecycle.create(recordInput);
            yield this.append({
                type: 'run.created',
                run_id: record.run_id,
                goal,
                task_id: record.task_id,
                parent_run_id: record.parent_run_id,
                workspace_id: record.workspace_id,
                repo_id: record.repo_id,
                branch_or_worktree_id: record.branch_or_worktree_id,
                mode: record.mode,
                status: record.status,
                model_profile: record.model_profile,
                provider_route: record.provider_route,
                context_snapshot_hash: record.context_snapshot_hash,
                prompt_snapshot_hash: record.prompt_snapshot_hash,
                artifact_refs: record.artifact_refs,
                permission_profile: record.permission_profile,
                budget_profile: record.budget_profile,
            });
            this.records.set(record.run_id, record);
            return cloneRecord(record);
        });
    }
    getRun(runId) {
        const record = this.records.get(runId);
        return record ? cloneRecord(record) : undefined;
    }
    listRuns() {
        return Array.from(this.records.values(), cloneRecord);
    }
    transition(runId, next, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            const current = this.requireRun(runId);
            const updated = RunLifecycle.transition(current, next);
            yield this.commitTransition(current, updated, reason);
            return cloneRecord(updated);
        });
    }
    proposePlan(runId, plan) {
        return __awaiter(this, void 0, void 0, function* () {
            const current = this.requireRun(runId);
            if (current.status === 'planned') {
                yield this.transition(runId, 'awaiting_approval', 'plan proposed');
            }
            yield this.append({ type: 'plan.proposed', run_id: runId, plan });
            yield this.append({ type: 'approval.requested', run_id: runId, reason: 'plan approval required' });
        });
    }
    approvePlan(runId, approvedBy) {
        return __awaiter(this, void 0, void 0, function* () {
            const updated = yield this.transition(runId, 'running', 'plan approved');
            yield this.append({ type: 'approval.granted', run_id: runId, approved_by: approvedBy });
            return updated;
        });
    }
    denyPlan(runId, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            const updated = yield this.transition(runId, 'cancelled', reason);
            yield this.append({ type: 'approval.denied', run_id: runId, reason });
            return updated;
        });
    }
    recordToolRequested(runId, tool, args) {
        return __awaiter(this, void 0, void 0, function* () {
            this.requireRun(runId);
            yield this.append({ type: 'tool.requested', run_id: runId, tool, args });
        });
    }
    recordToolExecuted(runId_1, tool_1) {
        return __awaiter(this, arguments, void 0, function* (runId, tool, result = {}) {
            this.requireRun(runId);
            yield this.append(Object.assign({ type: 'tool.executed', run_id: runId, tool }, result));
        });
    }
    recordArtifact(runId, artifactRef, files) {
        return __awaiter(this, void 0, void 0, function* () {
            const current = this.requireRun(runId);
            if (ARTIFACT_INACTIVE_STATUSES.has(current.status)) {
                throw new Error(`RunLedger: cannot record artifact for inactive run "${runId}" (${current.status})`);
            }
            const updated = RunLifecycle.withArtifact(current, artifactRef);
            if (updated === current)
                return cloneRecord(current);
            yield this.append({
                type: 'artifact.created',
                run_id: runId,
                artifact_id: artifactRef,
                files,
            });
            this.records.set(runId, updated);
            return cloneRecord(updated);
        });
    }
    blockRun(runId, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            const updated = yield this.transition(runId, 'blocked', reason);
            yield this.append({ type: 'run.blocked', run_id: runId, reason });
            return updated;
        });
    }
    completeRun(runId, status, summary) {
        return __awaiter(this, void 0, void 0, function* () {
            const current = this.requireRun(runId);
            let updated;
            if (status === 'failed') {
                updated = RunLifecycle.withError(current, 'run_failed', summary !== null && summary !== void 0 ? summary : 'Run failed');
            }
            else {
                updated = RunLifecycle.transition(current, status);
            }
            yield this.commitTransition(current, updated, summary);
            if (status === 'completed') {
                yield this.append({ type: 'run.completed', run_id: runId, status });
            }
            else if (status === 'failed') {
                yield this.append({ type: 'run.failed', run_id: runId, error: summary });
            }
            else {
                yield this.append({ type: 'run.cancelled', run_id: runId, reason: summary });
            }
            return cloneRecord(updated);
        });
    }
    eventsForRun(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.ledger.byRun(runId);
        });
    }
    replayRun(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
            const events = yield this.ledger.byRun(runId);
            let record;
            for (const event of events) {
                if (event.type === 'run.created') {
                    const created = RunLifecycle.create({
                        run_id: event.run_id,
                        task_id: (_b = (_a = event.task_id) !== null && _a !== void 0 ? _a : event.goal) !== null && _b !== void 0 ? _b : '',
                        parent_run_id: event.parent_run_id,
                        workspace_id: (_c = event.workspace_id) !== null && _c !== void 0 ? _c : 'unknown',
                        repo_id: (_d = event.repo_id) !== null && _d !== void 0 ? _d : 'unknown',
                        branch_or_worktree_id: (_e = event.branch_or_worktree_id) !== null && _e !== void 0 ? _e : '',
                        mode: isRunMode(event.mode) ? event.mode : 'autonomous',
                        model_profile: (_g = (_f = event.model_profile) !== null && _f !== void 0 ? _f : event.model) !== null && _g !== void 0 ? _g : '',
                        provider_route: (_j = (_h = event.provider_route) !== null && _h !== void 0 ? _h : event.provider) !== null && _j !== void 0 ? _j : '',
                        context_snapshot_hash: (_k = event.context_snapshot_hash) !== null && _k !== void 0 ? _k : '',
                        prompt_snapshot_hash: (_l = event.prompt_snapshot_hash) !== null && _l !== void 0 ? _l : '',
                        artifact_refs: (_m = event.artifact_refs) !== null && _m !== void 0 ? _m : [],
                        permission_profile: (_o = asPermissionProfile(event.permission_profile)) !== null && _o !== void 0 ? _o : { profile: 'standard' },
                        budget_profile: (_p = asBudgetProfile(event.budget_profile)) !== null && _p !== void 0 ? _p : {},
                        created_at: event.ts,
                        updated_at: event.ts,
                    });
                    record = Object.assign(Object.assign({}, created), { status: isRunStatus(event.status) ? event.status : created.status, created_at: event.ts, updated_at: event.ts });
                    continue;
                }
                if (!record)
                    continue;
                if (event.type === 'run.transitioned' && isRunStatus(event.to)) {
                    if (record.status !== event.to) {
                        record = Object.assign(Object.assign({}, RunLifecycle.transition(record, event.to)), { updated_at: event.ts });
                    }
                }
                else if (event.type === 'artifact.created' && event.artifact_id) {
                    record = Object.assign(Object.assign({}, RunLifecycle.withArtifact(record, event.artifact_id)), { updated_at: event.ts });
                }
                else if (event.type === 'run.completed') {
                    record = record.status === 'completed'
                        ? Object.assign(Object.assign({}, record), { updated_at: event.ts }) : Object.assign(Object.assign({}, RunLifecycle.transition(record, 'completed')), { updated_at: event.ts });
                }
                else if (event.type === 'run.failed') {
                    record = record.status === 'failed'
                        ? Object.assign(Object.assign({}, record), { updated_at: event.ts, error: (_q = record.error) !== null && _q !== void 0 ? _q : { code: 'run_failed', message: (_r = event.error) !== null && _r !== void 0 ? _r : 'Run failed' } }) : Object.assign(Object.assign({}, RunLifecycle.withError(record, 'run_failed', (_s = event.error) !== null && _s !== void 0 ? _s : 'Run failed')), { updated_at: event.ts });
                }
                else if (event.type === 'run.cancelled') {
                    record = record.status === 'cancelled'
                        ? Object.assign(Object.assign({}, record), { updated_at: event.ts }) : Object.assign(Object.assign({}, RunLifecycle.transition(record, 'cancelled')), { updated_at: event.ts });
                }
            }
            if (record)
                this.records.set(record.run_id, record);
            return record ? cloneRecord(record) : undefined;
        });
    }
    recoverInterruptedRuns() {
        return __awaiter(this, arguments, void 0, function* (reason = 'runtime_restarted') {
            const recovered = [];
            for (const record of this.listRuns()) {
                if (record.status !== 'running')
                    continue;
                recovered.push(yield this.blockRun(record.run_id, reason));
            }
            return recovered;
        });
    }
    requireRun(runId) {
        const record = this.records.get(runId);
        if (!record)
            throw new Error(`RunLedger: unknown run "${runId}"`);
        return record;
    }
    commitTransition(current, updated, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.append({
                type: 'run.transitioned',
                run_id: current.run_id,
                from: current.status,
                to: updated.status,
                reason,
            });
            this.records.set(updated.run_id, updated);
        });
    }
    append(event) {
        return this.ledger.append(event);
    }
}
