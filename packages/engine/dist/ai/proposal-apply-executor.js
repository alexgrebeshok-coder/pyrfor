var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { buildApplyResult, reduceProposalState } from './action-engine';
import { executeAIKernelTool } from './kernel-tool-plane';
import { buildApplySafetySummary } from './safety';
import { prisma } from '../prisma';
import { isDatabaseConfigured } from '../config/runtime-mode';
export function executeServerAIProposalApply(run, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!isDatabaseConfigured()) {
            return null;
        }
        const proposal = (_a = run.result) === null || _a === void 0 ? void 0 : _a.proposal;
        if (!proposal || proposal.id !== input.proposalId || proposal.type !== "create_tasks") {
            return null;
        }
        const existingDecision = yield readApplyDecision(run.id, proposal.id);
        if (existingDecision) {
            return resolveExistingApplyDecision(run, proposal, existingDecision);
        }
        const appliedAt = new Date().toISOString();
        const safety = buildApplySafetySummary(proposal);
        const idempotencyKey = buildProposalIdempotencyKey(run.id, proposal);
        const decision = yield createExecutingDecision({
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
        const results = yield Promise.all(toolCalls.map(({ toolCallId, task }) => executeAIKernelTool({
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
            yield prisma.aiApplyDecisionLedger.update({
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
        yield prisma.aiApplyDecisionLedger.update({
            where: { id: decision.record.id },
            data: {
                status: "executed",
                toolCallIdsJson: JSON.stringify(execution.toolCallIds),
                resultJson: JSON.stringify(actionResult),
                executedAt: new Date(appliedAt),
            },
        });
        return reduceProposalState(Object.assign(Object.assign({}, run), { updatedAt: appliedAt }), proposal.id, "applied", actionResult);
    });
}
function readApplyDecision(runId, proposalId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.aiApplyDecisionLedger.findFirst({
            where: {
                runId,
                proposalId,
            },
        });
    });
}
function createExecutingDecision(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const record = yield prisma.aiApplyDecisionLedger.create({
                data: {
                    id: `ai-apply-${randomUUID()}`,
                    runId: input.runId,
                    proposalId: input.proposal.id,
                    proposalType: input.proposal.type,
                    idempotencyKey: input.idempotencyKey,
                    status: "executing",
                    operatorId: (_a = input.operatorId) !== null && _a !== void 0 ? _a : null,
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
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                const existing = yield readApplyDecision(input.runId, input.proposal.id);
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
    });
}
function resolveExistingApplyDecision(run, proposal, decision) {
    var _a, _b, _c, _d, _e, _f;
    if (decision.status === "executing") {
        throw new Error(`Proposal ${proposal.id} apply is already in progress.`);
    }
    if (decision.status === "failed") {
        throw new Error((_a = decision.errorMessage) !== null && _a !== void 0 ? _a : `Proposal ${proposal.id} apply failed and requires operator review before retry.`);
    }
    if (decision.status === "executed") {
        if (((_c = (_b = run.result) === null || _b === void 0 ? void 0 : _b.proposal) === null || _c === void 0 ? void 0 : _c.state) === "applied" && ((_d = run.result) === null || _d === void 0 ? void 0 : _d.actionResult)) {
            return run;
        }
        const stored = parseStoredApplyResult(decision.resultJson);
        if (!stored) {
            throw new Error(`Proposal ${proposal.id} apply ledger is missing its result payload.`);
        }
        return reduceProposalState(Object.assign(Object.assign({}, run), { updatedAt: (_f = (_e = decision.executedAt) === null || _e === void 0 ? void 0 : _e.toISOString()) !== null && _f !== void 0 ? _f : new Date().toISOString() }), proposal.id, "applied", stored);
    }
    throw new Error(`Unsupported apply decision status: ${decision.status}`);
}
function buildProposalIdempotencyKey(runId, proposal) {
    return createHash("sha256")
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
    var _a, _b;
    const parts = [(_a = task.description) === null || _a === void 0 ? void 0 : _a.trim(), ((_b = task.reason) === null || _b === void 0 ? void 0 : _b.trim()) ? `AI reason: ${task.reason}` : null].filter((value) => Boolean(value && value.trim()));
    return parts.length > 0 ? parts.join("\n\n") : undefined;
}
function buildExecutionSummary(input) {
    var _a;
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
        operatorId: (_a = input.operatorId) !== null && _a !== void 0 ? _a : null,
        idempotencyKey: input.idempotencyKey,
        toolCallIds: input.results.map((result) => result.toolCallId),
        steps,
    };
}
function buildExecutedApplyResult(input) {
    const base = buildApplyResult(input.proposal, input.appliedAt);
    return Object.assign(Object.assign({}, base), { summary: `Created ${input.execution.steps.length} live task(s) from the approved proposal.`, safety: Object.assign(Object.assign({}, base.safety), { liveMutation: true, mutationSurface: "Live task backlog" }), execution: input.execution });
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
    catch (_a) {
        return null;
    }
}
