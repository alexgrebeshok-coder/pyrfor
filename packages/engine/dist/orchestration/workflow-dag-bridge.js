import { DurableDag, } from '../runtime/durable-dag.js';
export function buildWorkflowDag(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const dag = (_a = input.dag) !== null && _a !== void 0 ? _a : new DurableDag({ dagId: `workflow:${input.workflowRunId}` });
    for (const step of [...input.steps].sort((a, b) => a.nodeId.localeCompare(b.nodeId))) {
        const status = mapWorkflowStepStatusToDagStatus(step.status);
        dag.hydrateNode({
            id: step.nodeId,
            kind: `workflow.${step.stepType}`,
            status,
            dependsOn: parseDependencyIds(step.dependsOnJson),
            payload: {
                workflowRunId: input.workflowRunId,
                workflowStepId: step.id,
                workflowNodeId: step.nodeId,
                stepType: step.stepType,
                name: (_b = step.name) !== null && _b !== void 0 ? _b : step.nodeId,
                heartbeatRunId: (_c = step.heartbeatRunId) !== null && _c !== void 0 ? _c : undefined,
                checkpointId: (_d = step.checkpointId) !== null && _d !== void 0 ? _d : undefined,
            },
            attempts: (_e = step.attemptCount) !== null && _e !== void 0 ? _e : 0,
            idempotencyKey: `workflow:${input.workflowRunId}:${step.nodeId}`,
            retryClass: step.status === 'waiting_approval' ? 'human_needed' : 'transient',
            timeoutClass: step.stepType === 'approval' ? 'manual' : 'normal',
            failure: status === 'failed'
                ? { reason: (_f = step.errorMessage) !== null && _f !== void 0 ? _f : 'workflow step failed', retryable: isRetryableStepFailure(step) }
                : undefined,
            createdAt: toMs(step.createdAt),
            updatedAt: (_h = (_g = toMs(step.updatedAt)) !== null && _g !== void 0 ? _g : toMs(step.finishedAt)) !== null && _h !== void 0 ? _h : toMs(step.startedAt),
            provenance: workflowStepProvenance(step),
        });
    }
    return dag;
}
export function listReadyWorkflowSteps(dag, steps) {
    const readyIds = new Set(dag.listReady().map((node) => node.id));
    return steps
        .filter((step) => step.status === 'pending' && readyIds.has(step.nodeId))
        .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}
export function provenanceFromHeartbeatRun(heartbeatRun) {
    var _a;
    return [
        { kind: 'run', ref: heartbeatRun.id, role: 'evidence', meta: { status: heartbeatRun.status } },
        ...(((_a = heartbeatRun.checkpoints) !== null && _a !== void 0 ? _a : []).map((checkpoint) => ({
            kind: 'worker_frame',
            ref: checkpoint.id,
            role: 'evidence',
            meta: { source: 'heartbeat_checkpoint' },
        }))),
    ];
}
export function hydrateStepIntoDag(dag, step, heartbeatRun) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const provenance = [
        ...workflowStepProvenance(step),
        ...(heartbeatRun ? provenanceFromHeartbeatRun(heartbeatRun) : []),
    ];
    return dag.hydrateNode({
        id: step.nodeId,
        kind: `workflow.${step.stepType}`,
        status: mapWorkflowStepStatusToDagStatus(step.status),
        dependsOn: parseDependencyIds(step.dependsOnJson),
        payload: {
            workflowRunId: step.workflowRunId,
            workflowStepId: step.id,
            workflowNodeId: step.nodeId,
            stepType: step.stepType,
            heartbeatRunId: (_b = (_a = heartbeatRun === null || heartbeatRun === void 0 ? void 0 : heartbeatRun.id) !== null && _a !== void 0 ? _a : step.heartbeatRunId) !== null && _b !== void 0 ? _b : undefined,
            checkpointId: (_f = (_e = (_d = (_c = heartbeatRun === null || heartbeatRun === void 0 ? void 0 : heartbeatRun.checkpoints) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.id) !== null && _e !== void 0 ? _e : step.checkpointId) !== null && _f !== void 0 ? _f : undefined,
        },
        attempts: (_g = step.attemptCount) !== null && _g !== void 0 ? _g : 0,
        idempotencyKey: `workflow:${step.workflowRunId}:${step.nodeId}`,
        failure: step.status === 'failed'
            ? { reason: (_h = step.errorMessage) !== null && _h !== void 0 ? _h : 'workflow step failed', retryable: isRetryableStepFailure(step) }
            : undefined,
        provenance,
    });
}
export function mapWorkflowStepStatusToDagStatus(status) {
    switch (status) {
        case 'pending':
            return 'pending';
        case 'queued':
        case 'waiting_approval':
            return 'leased';
        case 'running':
            return 'running';
        case 'succeeded':
            return 'succeeded';
        case 'failed':
            return 'failed';
        case 'skipped':
        case 'cancelled':
            return 'cancelled';
        default:
            return 'pending';
    }
}
function workflowStepProvenance(step) {
    const provenance = [
        { kind: 'run', ref: step.workflowRunId, role: 'input' },
    ];
    if (step.heartbeatRunId) {
        provenance.push({ kind: 'run', ref: step.heartbeatRunId, role: 'evidence' });
    }
    if (step.checkpointId) {
        provenance.push({ kind: 'worker_frame', ref: step.checkpointId, role: 'evidence' });
    }
    return provenance;
}
function parseDependencyIds(raw) {
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((value) => typeof value === 'string').sort()
            : [];
    }
    catch (_a) {
        return [];
    }
}
function isRetryableStepFailure(step) {
    var _a, _b;
    return ((_a = step.attemptCount) !== null && _a !== void 0 ? _a : 0) < ((_b = step.maxRetries) !== null && _b !== void 0 ? _b : 1);
}
function toMs(value) {
    if (!value)
        return undefined;
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
}
