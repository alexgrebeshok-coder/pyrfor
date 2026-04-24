"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeServerAIProposalApply = executeServerAIProposalApply;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const action_engine_1 = require("./action-engine");
const kernel_tool_plane_1 = require("./kernel-tool-plane");
const safety_1 = require("./safety");
const prisma_1 = require("../prisma");
const runtime_mode_1 = require("../config/runtime-mode");
async function executeServerAIProposalApply(run, input) {
    if (!(0, runtime_mode_1.isDatabaseConfigured)()) {
        return null;
    }
    const proposal = run.result?.proposal;
    if (!proposal || proposal.id !== input.proposalId || proposal.type !== "create_tasks") {
        return null;
    }
    const existingDecision = await readApplyDecision(run.id, proposal.id);
    if (existingDecision) {
        return resolveExistingApplyDecision(run, proposal, existingDecision);
    }
    const appliedAt = new Date().toISOString();
    const safety = (0, safety_1.buildApplySafetySummary)(proposal);
    const idempotencyKey = buildProposalIdempotencyKey(run.id, proposal);
    const decision = await createExecutingDecision({
        runId: run.id,
        proposal,
        operatorId: input.operatorId,
        idempotencyKey,
        compensationMode: safety.compensationMode,
        compensationSummary: safety.compensationSummary,
    });
    if (!decision.created) {
        return resolveExistingApplyDecision(run, proposal, decision.record);
    }
    const toolCalls = proposal.tasks.map((task, index) => ({
        toolCallId: buildTaskToolCallId(proposal.id, index),
        task,
    }));
    const results = await Promise.all(toolCalls.map(({ toolCallId, task }) => (0, kernel_tool_plane_1.executeAIKernelTool)({
        toolName: "create_task",
        toolCallId,
        arguments: buildCreateTaskArguments(task),
    })));
    const execution = buildExecutionSummary({
        decisionId: decision.record.id,
        idempotencyKey,
        operatorId: input.operatorId,
        results,
    });
    if (results.some((result) => !result.success)) {
        await prisma_1.prisma.aiApplyDecisionLedger.update({
            where: { id: decision.record.id },
            data: {
                status: "failed",
                toolCallIdsJson: JSON.stringify(execution.toolCallIds),
                resultJson: JSON.stringify(execution),
                errorMessage: buildFailureMessage(results),
                failedAt: new Date(appliedAt),
            },
        });
        throw new Error(buildFailureMessage(results));
    }
    const actionResult = buildExecutedApplyResult({
        proposal,
        appliedAt,
        execution,
    });
    await prisma_1.prisma.aiApplyDecisionLedger.update({
        where: { id: decision.record.id },
        data: {
            status: "executed",
            toolCallIdsJson: JSON.stringify(execution.toolCallIds),
            resultJson: JSON.stringify(actionResult),
            executedAt: new Date(appliedAt),
        },
    });
    return (0, action_engine_1.reduceProposalState)({
        ...run,
        updatedAt: appliedAt,
    }, proposal.id, "applied", actionResult);
}
async function readApplyDecision(runId, proposalId) {
    return prisma_1.prisma.aiApplyDecisionLedger.findFirst({
        where: {
            runId,
            proposalId,
        },
    });
}
async function createExecutingDecision(input) {
    try {
        const record = await prisma_1.prisma.aiApplyDecisionLedger.create({
            data: {
                id: `ai-apply-${(0, node_crypto_1.randomUUID)()}`,
                runId: input.runId,
                proposalId: input.proposal.id,
                proposalType: input.proposal.type,
                idempotencyKey: input.idempotencyKey,
                status: "executing",
                operatorId: input.operatorId ?? null,
                toolCallIdsJson: JSON.stringify([]),
                resultJson: JSON.stringify({ status: "executing" }),
                errorMessage: null,
                compensationMode: input.compensationMode,
                compensationSummary: input.compensationSummary,
            },
        });
        return {
            created: true,
            id: record.id,
            record,
        };
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const existing = await readApplyDecision(input.runId, input.proposal.id);
            if (existing) {
                return {
                    created: false,
                    id: existing.id,
                    record: existing,
                };
            }
        }
        throw error;
    }
}
function resolveExistingApplyDecision(run, proposal, decision) {
    if (decision.status === "executing") {
        throw new Error(`Proposal ${proposal.id} apply is already in progress.`);
    }
    if (decision.status === "failed") {
        throw new Error(decision.errorMessage ??
            `Proposal ${proposal.id} apply failed and requires operator review before retry.`);
    }
    if (decision.status === "executed") {
        if (run.result?.proposal?.state === "applied" && run.result?.actionResult) {
            return run;
        }
        const stored = parseStoredApplyResult(decision.resultJson);
        if (!stored) {
            throw new Error(`Proposal ${proposal.id} apply ledger is missing its result payload.`);
        }
        return (0, action_engine_1.reduceProposalState)({
            ...run,
            updatedAt: decision.executedAt?.toISOString() ?? new Date().toISOString(),
        }, proposal.id, "applied", stored);
    }
    throw new Error(`Unsupported apply decision status: ${decision.status}`);
}
function buildProposalIdempotencyKey(runId, proposal) {
    return (0, node_crypto_1.createHash)("sha256")
        .update(JSON.stringify({
        runId,
        proposalId: proposal.id,
        type: proposal.type,
        tasks: proposal.type === "create_tasks"
            ? proposal.tasks.map((task) => ({
                projectId: task.projectId,
                title: task.title,
                description: task.description,
                assignee: task.assignee,
                dueDate: task.dueDate,
                priority: task.priority,
                reason: task.reason,
            }))
            : [],
    }))
        .digest("hex");
}
function buildTaskToolCallId(proposalId, index) {
    return `apply-${proposalId}-task-${index}`;
}
function buildCreateTaskArguments(task) {
    const description = buildTaskDescription(task);
    return {
        projectId: task.projectId,
        title: task.title,
        description,
        priority: task.priority,
        dueDate: task.dueDate,
    };
}
function buildTaskDescription(task) {
    const parts = [task.description?.trim(), task.reason?.trim() ? `AI reason: ${task.reason}` : null].filter((value) => Boolean(value && value.trim()));
    return parts.length > 0 ? parts.join("\n\n") : undefined;
}
function buildExecutionSummary(input) {
    const steps = input.results.map((result) => ({
        toolCallId: result.toolCallId,
        toolName: result.name,
        success: result.success,
        message: result.displayMessage,
        entityId: typeof result.result.taskId === "string" ? result.result.taskId : undefined,
    }));
    return {
        decisionId: input.decisionId,
        status: input.results.every((result) => result.success) ? "executed" : "failed",
        operatorId: input.operatorId ?? null,
        idempotencyKey: input.idempotencyKey,
        toolCallIds: input.results.map((result) => result.toolCallId),
        steps,
    };
}
function buildExecutedApplyResult(input) {
    const base = (0, action_engine_1.buildApplyResult)(input.proposal, input.appliedAt);
    return {
        ...base,
        summary: `Created ${input.execution.steps.length} live task(s) from the approved proposal.`,
        safety: {
            ...base.safety,
            liveMutation: true,
            mutationSurface: "Live task backlog",
        },
        execution: input.execution,
    };
}
function buildFailureMessage(results) {
    const failures = results.filter((result) => !result.success);
    return failures.length > 0
        ? `Proposal apply failed: ${failures.map((result) => `${result.toolCallId}: ${result.displayMessage}`).join("; ")}`
        : "Proposal apply failed.";
}
function parseStoredApplyResult(value) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
