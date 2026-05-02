var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from "crypto";
import { prisma } from '../prisma.js';
import { broadcastSSE } from '../transport/sse.js';
import { slugify } from '../utils/index.js';
import { createAgentDelegation, listWorkflowDelegations, updateDelegationStatusByChildRun, } from './delegation-service.js';
import { jobQueue } from './job-queue.js';
import { buildWorkflowDag, listReadyWorkflowSteps } from './workflow-dag-bridge.js';
function parseObject(raw) {
    if (!raw) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object"
            ? parsed
            : {};
    }
    catch (_a) {
        return {};
    }
}
function parseArray(raw) {
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
    }
    catch (_a) {
        return [];
    }
}
function parseWorkflowDefinition(definition) {
    var _a;
    const parsed = typeof definition === "string"
        ? JSON.parse(definition)
        : definition;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.nodes)) {
        throw new Error("Workflow definition must contain a nodes array");
    }
    const nodeIds = new Set();
    for (const node of parsed.nodes) {
        if (!node || typeof node !== "object") {
            throw new Error("Workflow node must be an object");
        }
        if (!node.id || typeof node.id !== "string") {
            throw new Error("Workflow node id is required");
        }
        if (nodeIds.has(node.id)) {
            throw new Error(`Duplicate workflow node id: ${node.id}`);
        }
        nodeIds.add(node.id);
        if (!node.name || typeof node.name !== "string") {
            throw new Error(`Workflow node ${node.id} must have a name`);
        }
        const kind = node.kind;
        if (kind !== "agent" && kind !== "approval") {
            throw new Error(`Workflow node ${node.id} has unsupported kind`);
        }
        if (kind === "agent") {
            const agentNode = node;
            if (!agentNode.agentId || typeof agentNode.agentId !== "string") {
                throw new Error(`Workflow node ${node.id} must reference an agentId`);
            }
            if (!agentNode.taskTemplate || typeof agentNode.taskTemplate !== "string") {
                throw new Error(`Workflow node ${node.id} must define taskTemplate`);
            }
        }
        if (kind === "approval") {
            const approvalNode = node;
            if (!approvalNode.approval || typeof approvalNode.approval !== "object") {
                throw new Error(`Workflow node ${node.id} must define approval config`);
            }
            if (!approvalNode.approval.title ||
                typeof approvalNode.approval.title !== "string") {
                throw new Error(`Workflow approval node ${node.id} must define approval.title`);
            }
        }
    }
    for (const node of parsed.nodes) {
        for (const dependencyId of (_a = node.dependsOn) !== null && _a !== void 0 ? _a : []) {
            if (!nodeIds.has(dependencyId)) {
                throw new Error(`Workflow node ${node.id} depends on unknown node ${dependencyId}`);
            }
        }
    }
    if (Array.isArray(parsed.outputNodes)) {
        for (const outputId of parsed.outputNodes) {
            if (!nodeIds.has(outputId)) {
                throw new Error(`Workflow output node ${outputId} does not exist`);
            }
        }
    }
    validateWorkflowDag(parsed.nodes);
    return parsed;
}
function validateWorkflowDag(nodes) {
    const remaining = new Set(nodes.map((node) => node.id));
    const completed = new Set();
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    while (remaining.size > 0) {
        const ready = Array.from(remaining).filter((id) => {
            var _a;
            const node = nodeMap.get(id);
            return ((_a = node === null || node === void 0 ? void 0 : node.dependsOn) !== null && _a !== void 0 ? _a : []).every((dependencyId) => completed.has(dependencyId));
        });
        if (ready.length === 0) {
            throw new Error("Workflow definition contains circular dependencies");
        }
        for (const id of ready) {
            remaining.delete(id);
            completed.add(id);
        }
    }
}
function stringifyWorkflowDefinition(definition) {
    return JSON.stringify(definition);
}
function ensureWorkflowAgentsExist(workspaceId, definition) {
    return __awaiter(this, void 0, void 0, function* () {
        const agentIds = definition.nodes
            .filter((node) => node.kind === "agent")
            .map((node) => node.agentId);
        if (agentIds.length === 0) {
            return;
        }
        const existingAgents = yield prisma.agent.findMany({
            where: {
                workspaceId,
                id: { in: agentIds },
            },
            select: { id: true },
        });
        const existingIds = new Set(existingAgents.map((agent) => agent.id));
        const missing = agentIds.filter((agentId) => !existingIds.has(agentId));
        if (missing.length > 0) {
            throw new Error(`Workflow references unknown agents: ${missing.join(", ")}`);
        }
    });
}
function normalizeTemplateStatus(value) {
    if (value === "archived" || value === "draft" || value === "active") {
        return value;
    }
    return "active";
}
function parseStepOutputText(outputJson) {
    const output = parseObject(outputJson);
    if (typeof output.content === "string" && output.content.trim()) {
        return output.content;
    }
    if (typeof output.comment === "string" && output.comment.trim()) {
        return output.comment;
    }
    if (typeof output.summary === "string" && output.summary.trim()) {
        return output.summary;
    }
    if (typeof output.result === "string" && output.result.trim()) {
        return output.result;
    }
    return Object.keys(output).length > 0 ? JSON.stringify(output) : "";
}
function resolveWorkflowInputText(runInput) {
    if (typeof runInput.prompt === "string" && runInput.prompt.trim()) {
        return runInput.prompt;
    }
    if (typeof runInput.input === "string" && runInput.input.trim()) {
        return runInput.input;
    }
    if (typeof runInput.task === "string" && runInput.task.trim()) {
        return runInput.task;
    }
    if (typeof runInput.description === "string" && runInput.description.trim()) {
        return runInput.description;
    }
    if (Object.keys(runInput).length > 0) {
        return JSON.stringify(runInput, null, 2);
    }
    return "";
}
function renderTemplate(template, runInput, stepsByNodeId, dependencies) {
    let rendered = template;
    rendered = rendered.replace(/\{\{input\}\}/g, resolveWorkflowInputText(runInput));
    const dependencyOutput = dependencies
        .map((dependencyId) => {
        const step = stepsByNodeId.get(dependencyId);
        if (!step || step.status !== "succeeded") {
            return "";
        }
        return parseStepOutputText(step.outputJson);
    })
        .filter(Boolean)
        .join("\n\n");
    rendered = rendered.replace(/\{\{prev\}\}/g, dependencyOutput || resolveWorkflowInputText(runInput));
    rendered = rendered.replace(/\{\{([\w-]+)\}\}/g, (_, nodeId) => {
        const step = stepsByNodeId.get(nodeId);
        return step ? parseStepOutputText(step.outputJson) : "";
    });
    return rendered;
}
function mapHeartbeatRunStatusToStepStatus(status) {
    switch (status) {
        case "queued":
            return "queued";
        case "running":
            return "running";
        case "succeeded":
            return "succeeded";
        case "cancelled":
            return "cancelled";
        case "failed":
        case "timed_out":
        default:
            return "failed";
    }
}
function mapHeartbeatRunStatusToDelegationStatus(status) {
    switch (status) {
        case "queued":
        case "running":
            return "running";
        case "succeeded":
            return "succeeded";
        case "cancelled":
            return "cancelled";
        case "failed":
        case "timed_out":
        default:
            return "failed";
    }
}
function summarizeSteps(steps) {
    return steps.reduce((summary, step) => {
        const status = step.status;
        if (status in summary) {
            summary[status] += 1;
        }
        return summary;
    }, {
        pending: 0,
        queued: 0,
        running: 0,
        waiting_approval: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
    });
}
function computeOutputNodeIds(definition) {
    if (definition.outputNodes && definition.outputNodes.length > 0) {
        return definition.outputNodes;
    }
    const dependencyIds = new Set(definition.nodes.flatMap((node) => { var _a; return (_a = node.dependsOn) !== null && _a !== void 0 ? _a : []; }));
    return definition.nodes
        .map((node) => node.id)
        .filter((nodeId) => !dependencyIds.has(nodeId));
}
function loadWorkflowRunInternal(workflowRunId) {
    return __awaiter(this, void 0, void 0, function* () {
        const run = yield prisma.workflowRun.findUnique({
            where: { id: workflowRunId },
            include: {
                template: true,
                steps: {
                    orderBy: { seq: "asc" },
                    include: {
                        agent: {
                            select: { id: true, name: true, role: true, slug: true },
                        },
                        heartbeatRun: {
                            select: {
                                id: true,
                                status: true,
                                createdAt: true,
                                startedAt: true,
                                finishedAt: true,
                            },
                        },
                    },
                },
            },
        });
        if (!run) {
            throw new Error("Workflow run not found");
        }
        return run;
    });
}
function hydrateWorkflowRun(workflowRunId) {
    return __awaiter(this, void 0, void 0, function* () {
        const run = yield loadWorkflowRunInternal(workflowRunId);
        const approvalIds = run.steps
            .map((step) => step.approvalId)
            .filter((approvalId) => typeof approvalId === "string");
        const [approvals, delegations] = yield Promise.all([
            approvalIds.length > 0
                ? prisma.approval.findMany({
                    where: { id: { in: approvalIds } },
                    select: {
                        id: true,
                        title: true,
                        status: true,
                        comment: true,
                        createdAt: true,
                        reviewedAt: true,
                    },
                })
                : Promise.resolve([]),
            listWorkflowDelegations(workflowRunId),
        ]);
        const approvalMap = new Map(approvals.map((approval) => [approval.id, approval]));
        return Object.assign(Object.assign({}, run), { inputJson: parseObject(run.inputJson), contextJson: parseObject(run.contextJson), resultJson: parseObject(run.resultJson), template: Object.assign(Object.assign({}, run.template), { definitionJson: parseWorkflowDefinition(run.template.definitionJson) }), steps: run.steps.map((step) => {
                var _a;
                return (Object.assign(Object.assign({}, step), { dependsOn: parseArray(step.dependsOnJson), inputJson: parseObject(step.inputJson), outputJson: parseObject(step.outputJson), approval: step.approvalId ? (_a = approvalMap.get(step.approvalId)) !== null && _a !== void 0 ? _a : null : null }));
            }), delegations: delegations.map((delegation) => (Object.assign(Object.assign({}, delegation), { metadataJson: parseObject(delegation.metadataJson) }))), summary: summarizeSteps(run.steps) });
    });
}
function queueAgentStep(run, step, node, stepsByNodeId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const claimed = yield prisma.workflowRunStep.updateMany({
            where: { id: step.id, status: "pending" },
            data: {
                status: "queued",
                startedAt: (_a = step.startedAt) !== null && _a !== void 0 ? _a : new Date(),
                errorMessage: null,
            },
        });
        if (claimed.count === 0) {
            return;
        }
        const runInput = parseObject(run.inputJson);
        const dependencies = parseArray(step.dependsOnJson);
        const dependentSteps = dependencies
            .map((dependencyId) => stepsByNodeId.get(dependencyId))
            .filter((dependency) => Boolean(dependency));
        const renderedTask = renderTemplate(node.taskTemplate, runInput, new Map(run.steps.map((candidate) => [
            candidate.nodeId,
            {
                outputJson: candidate.outputJson,
                status: candidate.status,
            },
        ])), dependencies);
        const attemptNumber = step.attemptCount + 1;
        const parentAgentStep = [...dependentSteps]
            .reverse()
            .find((dependency) => dependency.agentId && dependency.heartbeatRunId);
        const contextSnapshot = {
            workflowRunId: run.id,
            workflowStepId: step.id,
            workflowTemplateId: run.workflowTemplateId,
            workflowNodeId: step.nodeId,
            workflowNodeName: step.name,
            workflowStepType: step.stepType,
            workflowInput: runInput,
            workflowContext: parseObject(run.contextJson),
            dependencyNodeIds: dependentSteps.map((dependency) => dependency.nodeId),
            dependencyRunIds: dependentSteps
                .map((dependency) => dependency.heartbeatRunId)
                .filter((value) => typeof value === "string"),
            parentRunId: (_b = parentAgentStep === null || parentAgentStep === void 0 ? void 0 : parentAgentStep.heartbeatRunId) !== null && _b !== void 0 ? _b : null,
            delegatedByAgentId: (_c = parentAgentStep === null || parentAgentStep === void 0 ? void 0 : parentAgentStep.agentId) !== null && _c !== void 0 ? _c : null,
            workflowAttempt: attemptNumber,
            task: renderedTask,
        };
        const childRun = yield prisma.heartbeatRun.create({
            data: {
                workspaceId: run.workspaceId,
                agentId: node.agentId,
                status: "queued",
                invocationSource: "workflow",
                contextSnapshot: JSON.stringify(contextSnapshot),
            },
        });
        try {
            yield jobQueue.enqueue({
                agentId: node.agentId,
                reason: "event",
                idempotencyKey: `workflow:${run.id}:${step.nodeId}:attempt:${attemptNumber}`,
                maxRetries: (_d = node.maxRetries) !== null && _d !== void 0 ? _d : 1,
                triggerData: Object.assign(Object.assign({}, contextSnapshot), { runId: childRun.id }),
            });
            yield prisma.workflowRunStep.update({
                where: { id: step.id },
                data: {
                    status: "queued",
                    heartbeatRunId: childRun.id,
                    attemptCount: attemptNumber,
                    inputJson: JSON.stringify({
                        task: renderedTask,
                        dependencyNodeIds: dependentSteps.map((dependency) => dependency.nodeId),
                        dependencyRunIds: dependentSteps
                            .map((dependency) => dependency.heartbeatRunId)
                            .filter((value) => typeof value === "string"),
                    }),
                },
            });
            if ((parentAgentStep === null || parentAgentStep === void 0 ? void 0 : parentAgentStep.agentId) && parentAgentStep.heartbeatRunId) {
                yield createAgentDelegation({
                    workspaceId: run.workspaceId,
                    workflowRunId: run.id,
                    workflowStepId: step.id,
                    parentAgentId: parentAgentStep.agentId,
                    childAgentId: node.agentId,
                    parentRunId: parentAgentStep.heartbeatRunId,
                    childRunId: childRun.id,
                    reason: `Workflow "${run.template.name}" delegated "${step.name}"`,
                    metadata: {
                        nodeId: step.nodeId,
                        attemptNumber,
                    },
                });
            }
            yield prisma.workflowRun.update({
                where: { id: run.id },
                data: {
                    status: "running",
                    startedAt: (_e = run.startedAt) !== null && _e !== void 0 ? _e : new Date(),
                },
            });
            broadcastSSE("workflow_step_queued", {
                workflowRunId: run.id,
                workflowStepId: step.id,
                heartbeatRunId: childRun.id,
                agentId: node.agentId,
            });
        }
        catch (error) {
            yield prisma.heartbeatRun.update({
                where: { id: childRun.id },
                data: {
                    status: "cancelled",
                    finishedAt: new Date(),
                    resultJson: JSON.stringify({
                        error: error instanceof Error ? error.message : String(error),
                        errorType: "workflow_queue_error",
                    }),
                },
            });
            yield prisma.workflowRunStep.update({
                where: { id: step.id },
                data: {
                    status: "pending",
                    heartbeatRunId: null,
                    errorMessage: error instanceof Error ? error.message : String(error),
                },
            });
            throw error;
        }
    });
}
function createApprovalStep(run, step, node) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const claimed = yield prisma.workflowRunStep.updateMany({
            where: { id: step.id, status: "pending" },
            data: {
                status: "waiting_approval",
                startedAt: (_a = step.startedAt) !== null && _a !== void 0 ? _a : new Date(),
                errorMessage: null,
            },
        });
        if (claimed.count === 0) {
            return;
        }
        const dependencies = parseArray(step.dependsOnJson);
        const stepsByNodeId = new Map(run.steps.map((candidate) => [
            candidate.nodeId,
            {
                outputJson: candidate.outputJson,
                status: candidate.status,
            },
        ]));
        const runInput = parseObject(run.inputJson);
        const approval = yield prisma.approval.create({
            data: {
                id: `apr-wf-${randomUUID()}`,
                type: (_b = node.approval.type) !== null && _b !== void 0 ? _b : "workflow_gate",
                entityType: "orchestration_workflow_run",
                entityId: run.id,
                title: renderTemplate(node.approval.title, runInput, stepsByNodeId, dependencies),
                description: node.approval.description
                    ? renderTemplate(node.approval.description, runInput, stepsByNodeId, dependencies)
                    : null,
                metadata: JSON.stringify({
                    canonicalPath: `/settings/agents/workflows/runs/${run.id}`,
                    workflowRunId: run.id,
                    workflowStepId: step.id,
                    workflowNodeId: step.nodeId,
                    workflowNodeName: step.name,
                }),
                expiresAt: typeof node.approval.expiresInHours === "number"
                    ? new Date(Date.now() + node.approval.expiresInHours * 60 * 60 * 1000)
                    : null,
            },
        });
        yield prisma.workflowRunStep.update({
            where: { id: step.id },
            data: {
                approvalId: approval.id,
                inputJson: JSON.stringify({
                    title: approval.title,
                    description: approval.description,
                }),
            },
        });
        yield prisma.workflowRun.update({
            where: { id: run.id },
            data: {
                status: "waiting_approval",
                startedAt: (_c = run.startedAt) !== null && _c !== void 0 ? _c : new Date(),
            },
        });
        broadcastSSE("workflow_step_waiting_approval", {
            workflowRunId: run.id,
            workflowStepId: step.id,
            approvalId: approval.id,
        });
    });
}
function syncExistingStepState(run) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        const stepRunIds = run.steps
            .map((step) => step.heartbeatRunId)
            .filter((runId) => typeof runId === "string");
        const approvalIds = run.steps
            .map((step) => step.approvalId)
            .filter((approvalId) => typeof approvalId === "string");
        const [heartbeatRuns, approvals] = yield Promise.all([
            stepRunIds.length > 0
                ? prisma.heartbeatRun.findMany({
                    where: { id: { in: stepRunIds } },
                    include: {
                        checkpoints: {
                            orderBy: { createdAt: "desc" },
                            take: 1,
                        },
                    },
                })
                : Promise.resolve([]),
            approvalIds.length > 0
                ? prisma.approval.findMany({
                    where: { id: { in: approvalIds } },
                })
                : Promise.resolve([]),
        ]);
        const heartbeatMap = new Map(heartbeatRuns.map((heartbeatRun) => [heartbeatRun.id, heartbeatRun]));
        const approvalMap = new Map(approvals.map((approval) => [approval.id, approval]));
        for (const step of run.steps) {
            if (step.heartbeatRunId) {
                const heartbeatRun = heartbeatMap.get(step.heartbeatRunId);
                if (!heartbeatRun) {
                    continue;
                }
                const nextStatus = mapHeartbeatRunStatusToStepStatus(heartbeatRun.status);
                if (nextStatus === "failed" && step.attemptCount < step.maxRetries) {
                    yield prisma.workflowRunStep.update({
                        where: { id: step.id },
                        data: {
                            status: "pending",
                            heartbeatRunId: null,
                            outputJson: JSON.stringify({
                                lastFailureRunId: heartbeatRun.id,
                                lastFailureStatus: heartbeatRun.status,
                            }),
                            errorMessage: (_b = (_a = parseObject(heartbeatRun.resultJson).error) === null || _a === void 0 ? void 0 : _a.toString()) !== null && _b !== void 0 ? _b : `Heartbeat run ${heartbeatRun.status}`,
                            finishedAt: null,
                            checkpointId: (_d = (_c = heartbeatRun.checkpoints[0]) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : step.checkpointId,
                        },
                    });
                    continue;
                }
                yield prisma.workflowRunStep.update({
                    where: { id: step.id },
                    data: {
                        status: nextStatus,
                        startedAt: (_e = heartbeatRun.startedAt) !== null && _e !== void 0 ? _e : step.startedAt,
                        finishedAt: nextStatus === "queued" || nextStatus === "running"
                            ? null
                            : (_f = heartbeatRun.finishedAt) !== null && _f !== void 0 ? _f : new Date(),
                        outputJson: nextStatus === "succeeded" ? heartbeatRun.resultJson : step.outputJson,
                        errorMessage: nextStatus === "failed" || nextStatus === "cancelled"
                            ? (_h = (_g = parseObject(heartbeatRun.resultJson).error) === null || _g === void 0 ? void 0 : _g.toString()) !== null && _h !== void 0 ? _h : `Heartbeat run ${heartbeatRun.status}`
                            : null,
                        checkpointId: (_k = (_j = heartbeatRun.checkpoints[0]) === null || _j === void 0 ? void 0 : _j.id) !== null && _k !== void 0 ? _k : step.checkpointId,
                    },
                });
            }
            if (step.approvalId) {
                const approval = approvalMap.get(step.approvalId);
                if (!approval) {
                    continue;
                }
                if (approval.status === "approved") {
                    yield prisma.workflowRunStep.update({
                        where: { id: step.id },
                        data: {
                            status: "succeeded",
                            outputJson: JSON.stringify({
                                approvalId: approval.id,
                                comment: approval.comment,
                                reviewedAt: (_m = (_l = approval.reviewedAt) === null || _l === void 0 ? void 0 : _l.toISOString()) !== null && _m !== void 0 ? _m : null,
                            }),
                            errorMessage: null,
                            finishedAt: (_o = approval.reviewedAt) !== null && _o !== void 0 ? _o : new Date(),
                        },
                    });
                }
                else if (approval.status === "rejected") {
                    yield prisma.workflowRunStep.update({
                        where: { id: step.id },
                        data: {
                            status: "failed",
                            outputJson: JSON.stringify({
                                approvalId: approval.id,
                                comment: approval.comment,
                                reviewedAt: (_q = (_p = approval.reviewedAt) === null || _p === void 0 ? void 0 : _p.toISOString()) !== null && _q !== void 0 ? _q : null,
                            }),
                            errorMessage: (_r = approval.comment) !== null && _r !== void 0 ? _r : `${approval.title} was rejected`,
                            finishedAt: (_s = approval.reviewedAt) !== null && _s !== void 0 ? _s : new Date(),
                        },
                    });
                }
                else {
                    yield prisma.workflowRunStep.update({
                        where: { id: step.id },
                        data: {
                            status: "waiting_approval",
                        },
                    });
                }
            }
        }
    });
}
function updateWorkflowRunStatus(workflowRunId, definition) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const refreshedRun = yield loadWorkflowRunInternal(workflowRunId);
        const summary = summarizeSteps(refreshedRun.steps);
        let status = refreshedRun.status;
        let resultJson = refreshedRun.resultJson;
        let errorMessage = refreshedRun.errorMessage;
        let finishedAt = refreshedRun.finishedAt;
        let startedAt = refreshedRun.startedAt;
        if (summary.failed > 0) {
            status = "failed";
            finishedAt = finishedAt !== null && finishedAt !== void 0 ? finishedAt : new Date();
            errorMessage =
                (_b = (_a = refreshedRun.steps.find((step) => step.status === "failed")) === null || _a === void 0 ? void 0 : _a.errorMessage) !== null && _b !== void 0 ? _b : "Workflow failed";
        }
        else if (summary.cancelled > 0) {
            status = "cancelled";
            finishedAt = finishedAt !== null && finishedAt !== void 0 ? finishedAt : new Date();
            errorMessage =
                (_d = (_c = refreshedRun.steps.find((step) => step.status === "cancelled")) === null || _c === void 0 ? void 0 : _c.errorMessage) !== null && _d !== void 0 ? _d : "Workflow cancelled";
        }
        else if (summary.waiting_approval > 0) {
            status = "waiting_approval";
            startedAt = startedAt !== null && startedAt !== void 0 ? startedAt : new Date();
            finishedAt = null;
            errorMessage = null;
        }
        else if (summary.pending > 0 || summary.queued > 0 || summary.running > 0) {
            status = "running";
            startedAt = startedAt !== null && startedAt !== void 0 ? startedAt : new Date();
            finishedAt = null;
            errorMessage = null;
        }
        else {
            const outputNodeIds = computeOutputNodeIds(definition);
            const output = outputNodeIds.map((nodeId) => {
                var _a;
                const step = refreshedRun.steps.find((candidate) => candidate.nodeId === nodeId);
                return {
                    nodeId,
                    name: (_a = step === null || step === void 0 ? void 0 : step.name) !== null && _a !== void 0 ? _a : nodeId,
                    output: parseObject(step === null || step === void 0 ? void 0 : step.outputJson),
                };
            });
            status = "succeeded";
            finishedAt = finishedAt !== null && finishedAt !== void 0 ? finishedAt : new Date();
            errorMessage = null;
            resultJson = JSON.stringify({
                outputNodes: output,
                summary,
            });
        }
        yield prisma.workflowRun.update({
            where: { id: workflowRunId },
            data: {
                status,
                startedAt,
                finishedAt,
                errorMessage,
                resultJson,
            },
        });
        if (status === "succeeded" || status === "failed" || status === "cancelled") {
            broadcastSSE("workflow_run_completed", {
                workflowRunId,
                status,
            });
        }
    });
}
export function listWorkflowTemplates(workspaceId, status) {
    return __awaiter(this, void 0, void 0, function* () {
        const templates = yield prisma.workflowTemplate.findMany({
            where: Object.assign({ workspaceId }, (status ? { status } : {})),
            include: {
                runs: {
                    orderBy: { createdAt: "desc" },
                    take: 5,
                    select: {
                        id: true,
                        status: true,
                        createdAt: true,
                    },
                },
                _count: {
                    select: {
                        runs: true,
                    },
                },
            },
            orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        });
        return templates.map((template) => (Object.assign(Object.assign({}, template), { definitionJson: parseWorkflowDefinition(template.definitionJson), recentRunStats: summarizeSteps(template.runs.map((run) => ({
                status: run.status === "waiting_approval"
                    ? "waiting_approval"
                    : run.status === "succeeded"
                        ? "succeeded"
                        : run.status === "failed"
                            ? "failed"
                            : run.status === "cancelled"
                                ? "cancelled"
                                : "running",
            }))) })));
    });
}
export function createWorkflowTemplate(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const definition = parseWorkflowDefinition(input.definition);
        yield ensureWorkflowAgentsExist(input.workspaceId, definition);
        const template = yield prisma.workflowTemplate.create({
            data: {
                workspaceId: input.workspaceId,
                name: input.name,
                slug: (((_a = input.slug) === null || _a === void 0 ? void 0 : _a.trim()) || slugify(input.name)).slice(0, 60),
                description: (_b = input.description) !== null && _b !== void 0 ? _b : null,
                status: normalizeTemplateStatus(input.status),
                definitionJson: stringifyWorkflowDefinition(definition),
                createdBy: (_c = input.createdBy) !== null && _c !== void 0 ? _c : null,
            },
        });
        broadcastSSE("workflow_template_created", {
            templateId: template.id,
            workspaceId: input.workspaceId,
        });
        return Object.assign(Object.assign({}, template), { definitionJson: definition });
    });
}
export function updateWorkflowTemplate(templateId, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const existing = yield prisma.workflowTemplate.findUnique({
            where: { id: templateId },
        });
        if (!existing) {
            throw new Error("Workflow template not found");
        }
        const definition = input.definition
            ? parseWorkflowDefinition(input.definition)
            : parseWorkflowDefinition(existing.definitionJson);
        yield ensureWorkflowAgentsExist(existing.workspaceId, definition);
        const definitionChanged = stringifyWorkflowDefinition(definition) !== existing.definitionJson;
        const updated = yield prisma.workflowTemplate.update({
            where: { id: templateId },
            data: {
                name: (_a = input.name) !== null && _a !== void 0 ? _a : existing.name,
                slug: (((_b = input.slug) === null || _b === void 0 ? void 0 : _b.trim()) || existing.slug).slice(0, 60),
                description: input.description !== undefined ? input.description : existing.description,
                status: input.status !== undefined
                    ? normalizeTemplateStatus(input.status)
                    : existing.status,
                definitionJson: stringifyWorkflowDefinition(definition),
                version: definitionChanged ? existing.version + 1 : existing.version,
            },
        });
        return Object.assign(Object.assign({}, updated), { definitionJson: definition });
    });
}
export function getWorkflowTemplate(templateId) {
    return __awaiter(this, void 0, void 0, function* () {
        const template = yield prisma.workflowTemplate.findUnique({
            where: { id: templateId },
        });
        if (!template) {
            throw new Error("Workflow template not found");
        }
        return Object.assign(Object.assign({}, template), { definitionJson: parseWorkflowDefinition(template.definitionJson) });
    });
}
export function createWorkflowRun(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const template = yield prisma.workflowTemplate.findFirst({
            where: {
                id: input.templateId,
                workspaceId: input.workspaceId,
            },
        });
        if (!template) {
            throw new Error("Workflow template not found");
        }
        const definition = parseWorkflowDefinition(template.definitionJson);
        yield ensureWorkflowAgentsExist(input.workspaceId, definition);
        const runInput = typeof input.input === "string"
            ? { prompt: input.input }
            : (_a = input.input) !== null && _a !== void 0 ? _a : {};
        const workflowRun = yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const createdRun = yield tx.workflowRun.create({
                data: {
                    workflowTemplateId: template.id,
                    workspaceId: input.workspaceId,
                    status: "queued",
                    triggerType: (_a = input.triggerType) !== null && _a !== void 0 ? _a : "manual",
                    inputJson: JSON.stringify(runInput),
                    contextJson: JSON.stringify((_b = input.context) !== null && _b !== void 0 ? _b : {}),
                    createdBy: (_c = input.createdBy) !== null && _c !== void 0 ? _c : null,
                },
            });
            yield tx.workflowRunStep.createMany({
                data: definition.nodes.map((node, index) => {
                    var _a, _b;
                    return ({
                        workflowRunId: createdRun.id,
                        nodeId: node.id,
                        name: node.name,
                        stepType: node.kind,
                        seq: index,
                        agentId: node.kind === "agent" ? node.agentId : null,
                        dependsOnJson: JSON.stringify((_a = node.dependsOn) !== null && _a !== void 0 ? _a : []),
                        maxRetries: node.kind === "agent" ? (_b = node.maxRetries) !== null && _b !== void 0 ? _b : 1 : 1,
                    });
                }),
            });
            return createdRun;
        }));
        broadcastSSE("workflow_run_created", {
            workflowRunId: workflowRun.id,
            templateId: template.id,
        });
        return advanceWorkflowRun(workflowRun.id);
    });
}
export function advanceWorkflowRun(workflowRunId) {
    return __awaiter(this, void 0, void 0, function* () {
        const loadedRun = yield loadWorkflowRunInternal(workflowRunId);
        const definition = parseWorkflowDefinition(loadedRun.template.definitionJson);
        const nodeMap = new Map(definition.nodes.map((node) => [node.id, node]));
        yield syncExistingStepState(loadedRun);
        let refreshedRun = yield loadWorkflowRunInternal(workflowRunId);
        const refreshedStepsByNodeId = new Map(refreshedRun.steps.map((step) => [step.nodeId, step]));
        for (const step of refreshedRun.steps) {
            if (step.status !== "pending") {
                continue;
            }
            const dependencies = parseArray(step.dependsOnJson);
            const dependencySteps = dependencies
                .map((dependencyId) => refreshedStepsByNodeId.get(dependencyId))
                .filter(Boolean);
            const hasFailedDependency = dependencySteps.some((dependency) => dependency &&
                (dependency.status === "failed" || dependency.status === "cancelled"));
            if (!hasFailedDependency) {
                continue;
            }
            yield prisma.workflowRunStep.update({
                where: { id: step.id },
                data: {
                    status: "skipped",
                    errorMessage: "Dependency failed",
                    finishedAt: new Date(),
                },
            });
        }
        refreshedRun = yield loadWorkflowRunInternal(workflowRunId);
        const workflowDag = buildWorkflowDag({
            workflowRunId,
            steps: refreshedRun.steps,
        });
        const readyNodeIds = new Set(listReadyWorkflowSteps(workflowDag, refreshedRun.steps).map((step) => step.nodeId));
        const readySteps = refreshedRun.steps.filter((step) => step.status === "pending" && readyNodeIds.has(step.nodeId));
        const stepsByNodeId = new Map(refreshedRun.steps.map((step) => [step.nodeId, step]));
        for (const step of readySteps) {
            const node = nodeMap.get(step.nodeId);
            if (!node) {
                continue;
            }
            if (node.kind === "agent") {
                yield queueAgentStep(refreshedRun, step, node, stepsByNodeId);
            }
            else {
                yield createApprovalStep(refreshedRun, step, node);
            }
        }
        yield updateWorkflowRunStatus(workflowRunId, definition);
        return hydrateWorkflowRun(workflowRunId);
    });
}
export function listWorkflowRuns(workspaceId_1) {
    return __awaiter(this, arguments, void 0, function* (workspaceId, options = {}) {
        var _a;
        const limit = Math.min((_a = options.limit) !== null && _a !== void 0 ? _a : 20, 100);
        const runs = yield prisma.workflowRun.findMany({
            where: Object.assign(Object.assign({ workspaceId }, (options.status ? { status: options.status } : {})), (options.templateId ? { workflowTemplateId: options.templateId } : {})),
            include: {
                template: {
                    select: {
                        id: true,
                        name: true,
                        version: true,
                        status: true,
                    },
                },
                steps: {
                    select: {
                        status: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
        return runs.map((run) => (Object.assign(Object.assign({}, run), { inputJson: parseObject(run.inputJson), contextJson: parseObject(run.contextJson), resultJson: parseObject(run.resultJson), summary: summarizeSteps(run.steps) })));
    });
}
export function getWorkflowRunDetail(workflowRunId) {
    return __awaiter(this, void 0, void 0, function* () {
        return hydrateWorkflowRun(workflowRunId);
    });
}
export function syncWorkflowStepFromHeartbeatRun(runId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        const heartbeatRun = yield prisma.heartbeatRun.findUnique({
            where: { id: runId },
            include: {
                checkpoints: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
        });
        if (!heartbeatRun) {
            return null;
        }
        const contextSnapshot = parseObject(heartbeatRun.contextSnapshot);
        const workflowStepId = typeof contextSnapshot.workflowStepId === "string"
            ? contextSnapshot.workflowStepId
            : null;
        const workflowRunId = typeof contextSnapshot.workflowRunId === "string"
            ? contextSnapshot.workflowRunId
            : null;
        if (!workflowStepId || !workflowRunId) {
            return null;
        }
        const step = yield prisma.workflowRunStep.findUnique({
            where: { id: workflowStepId },
            select: {
                id: true,
                workflowRunId: true,
                maxRetries: true,
                attemptCount: true,
            },
        });
        if (!step || step.workflowRunId !== workflowRunId) {
            return null;
        }
        const mappedStatus = mapHeartbeatRunStatusToStepStatus(heartbeatRun.status);
        if (mappedStatus === "failed" && step.attemptCount < step.maxRetries) {
            yield prisma.workflowRunStep.update({
                where: { id: workflowStepId },
                data: {
                    status: "pending",
                    heartbeatRunId: null,
                    checkpointId: (_b = (_a = heartbeatRun.checkpoints[0]) === null || _a === void 0 ? void 0 : _a.id) !== null && _b !== void 0 ? _b : null,
                    outputJson: JSON.stringify({
                        lastFailureRunId: heartbeatRun.id,
                        lastFailureStatus: heartbeatRun.status,
                    }),
                    errorMessage: (_d = (_c = parseObject(heartbeatRun.resultJson).error) === null || _c === void 0 ? void 0 : _c.toString()) !== null && _d !== void 0 ? _d : `Heartbeat run ${heartbeatRun.status}`,
                    finishedAt: null,
                },
            });
        }
        else {
            yield prisma.workflowRunStep.update({
                where: { id: workflowStepId },
                data: {
                    status: mappedStatus,
                    heartbeatRunId: heartbeatRun.id,
                    checkpointId: (_f = (_e = heartbeatRun.checkpoints[0]) === null || _e === void 0 ? void 0 : _e.id) !== null && _f !== void 0 ? _f : null,
                    startedAt: (_g = heartbeatRun.startedAt) !== null && _g !== void 0 ? _g : undefined,
                    finishedAt: mappedStatus === "queued" || mappedStatus === "running"
                        ? null
                        : (_h = heartbeatRun.finishedAt) !== null && _h !== void 0 ? _h : new Date(),
                    outputJson: mappedStatus === "succeeded"
                        ? heartbeatRun.resultJson
                        : JSON.stringify({
                            runId: heartbeatRun.id,
                            status: heartbeatRun.status,
                        }),
                    errorMessage: mappedStatus === "failed" || mappedStatus === "cancelled"
                        ? (_k = (_j = parseObject(heartbeatRun.resultJson).error) === null || _j === void 0 ? void 0 : _j.toString()) !== null && _k !== void 0 ? _k : `Heartbeat run ${heartbeatRun.status}`
                        : null,
                },
            });
        }
        yield updateDelegationStatusByChildRun(heartbeatRun.id, mapHeartbeatRunStatusToDelegationStatus(heartbeatRun.status), {
            workflowRunId,
            workflowStepId,
        });
        return advanceWorkflowRun(workflowRunId);
    });
}
