"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateAIRunFixture = evaluateAIRunFixture;
exports.runAIRunEvalSuite = runAIRunEvalSuite;
const action_engine_1 = require("./action-engine");
const mock_adapter_1 = require("./mock-adapter");
const trace_1 = require("./trace");
const zod_1 = require("zod");
const taskDraftSchema = zod_1.z.object({
    projectId: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().min(1),
    assignee: zod_1.z.string().min(1),
    dueDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    priority: zod_1.z.enum(["low", "medium", "high", "critical"]),
    reason: zod_1.z.string().min(1),
});
const taskUpdateDraftSchema = zod_1.z.object({
    taskId: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().optional(),
    assignee: zod_1.z.string().optional(),
    dueDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: zod_1.z.enum(["low", "medium", "high", "critical"]).optional(),
    reason: zod_1.z.string().min(1),
});
const taskRescheduleDraftSchema = zod_1.z.object({
    taskId: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    previousDueDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    newDueDate: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    assignee: zod_1.z.string().optional(),
    reason: zod_1.z.string().min(1),
});
const riskDraftSchema = zod_1.z.object({
    projectId: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    description: zod_1.z.string().min(1),
    owner: zod_1.z.string().min(1),
    probability: zod_1.z.number().min(0).max(100),
    impact: zod_1.z.number().min(0).max(100),
    mitigation: zod_1.z.string().min(1),
    reason: zod_1.z.string().min(1),
});
const statusReportSchema = zod_1.z.object({
    projectId: zod_1.z.string().min(1).optional(),
    title: zod_1.z.string().min(1),
    audience: zod_1.z.string().min(1),
    channel: zod_1.z.string().min(1),
    summary: zod_1.z.string().min(1),
    body: zod_1.z.string().min(1),
    reason: zod_1.z.string().min(1),
});
const notificationSchema = zod_1.z.object({
    channel: zod_1.z.string().min(1),
    recipients: zod_1.z.array(zod_1.z.string().min(1)).min(1),
    message: zod_1.z.string().min(1),
    reason: zod_1.z.string().min(1),
});
const proposalSchema = zod_1.z.discriminatedUnion("type", [
    zod_1.z.object({
        id: zod_1.z.string().min(1),
        type: zod_1.z.literal("create_tasks"),
        title: zod_1.z.string().min(1),
        summary: zod_1.z.string().min(1),
        state: zod_1.z.enum(["pending", "applied", "dismissed"]),
        tasks: zod_1.z.array(taskDraftSchema).min(1),
    }),
    zod_1.z.object({
        id: zod_1.z.string().min(1),
        type: zod_1.z.literal("update_tasks"),
        title: zod_1.z.string().min(1),
        summary: zod_1.z.string().min(1),
        state: zod_1.z.enum(["pending", "applied", "dismissed"]),
        tasks: zod_1.z.array(taskDraftSchema),
        taskUpdates: zod_1.z.array(taskUpdateDraftSchema).min(1),
    }),
    zod_1.z.object({
        id: zod_1.z.string().min(1),
        type: zod_1.z.literal("reschedule_tasks"),
        title: zod_1.z.string().min(1),
        summary: zod_1.z.string().min(1),
        state: zod_1.z.enum(["pending", "applied", "dismissed"]),
        tasks: zod_1.z.array(taskDraftSchema),
        taskReschedules: zod_1.z.array(taskRescheduleDraftSchema).min(1),
    }),
    zod_1.z.object({
        id: zod_1.z.string().min(1),
        type: zod_1.z.literal("raise_risks"),
        title: zod_1.z.string().min(1),
        summary: zod_1.z.string().min(1),
        state: zod_1.z.enum(["pending", "applied", "dismissed"]),
        tasks: zod_1.z.array(taskDraftSchema),
        risks: zod_1.z.array(riskDraftSchema).min(1),
    }),
    zod_1.z.object({
        id: zod_1.z.string().min(1),
        type: zod_1.z.literal("draft_status_report"),
        title: zod_1.z.string().min(1),
        summary: zod_1.z.string().min(1),
        state: zod_1.z.enum(["pending", "applied", "dismissed"]),
        tasks: zod_1.z.array(taskDraftSchema),
        statusReport: statusReportSchema,
    }),
    zod_1.z.object({
        id: zod_1.z.string().min(1),
        type: zod_1.z.literal("notify_team"),
        title: zod_1.z.string().min(1),
        summary: zod_1.z.string().min(1),
        state: zod_1.z.enum(["pending", "applied", "dismissed"]),
        tasks: zod_1.z.array(taskDraftSchema),
        notifications: zod_1.z.array(notificationSchema).min(1),
    }),
]);
function hasProjectContext(input) {
    return Boolean(input.context.project?.id || input.context.activeContext.projectId);
}
function evaluateAIRunFixture(fixture) {
    const issues = [];
    if (!hasProjectContext(fixture.input)) {
        issues.push("missing_project_context");
    }
    if (fixture.expectedFailure) {
        const status = issues.includes(fixture.expectedFailure) ? "passed" : "failed";
        return {
            fixtureId: fixture.id,
            label: fixture.label,
            status,
            issues,
            proposalType: null,
            proposalItemCount: 0,
            traceWorkflow: fixture.input.source?.workflow ?? null,
        };
    }
    const run = (0, mock_adapter_1.buildMockFinalRun)(fixture.input, {
        id: `eval-${fixture.id}`,
        createdAt: "2026-03-11T09:00:00.000Z",
        updatedAt: "2026-03-11T09:00:05.000Z",
        quickActionId: fixture.input.quickAction?.id,
    });
    const entry = {
        origin: "mock",
        input: fixture.input,
        run,
    };
    const trace = (0, trace_1.buildAIRunTrace)(entry);
    const proposal = run.result?.proposal ?? null;
    const parsedProposal = proposalSchema.safeParse(proposal);
    if (!parsedProposal.success) {
        issues.push(`proposal_schema_invalid:${parsedProposal.error.issues[0]?.message ?? "unknown"}`);
    }
    if (!proposal) {
        issues.push("proposal_missing");
    }
    else {
        if (fixture.expectedProposalType && proposal.type !== fixture.expectedProposalType) {
            issues.push(`proposal_type_mismatch:${proposal.type}:expected:${fixture.expectedProposalType}`);
        }
        const itemCount = (0, action_engine_1.getProposalItemCount)(proposal);
        if (fixture.minProposalItems && itemCount < fixture.minProposalItems) {
            issues.push(`proposal_item_count_too_low:${itemCount}:expected:${fixture.minProposalItems}`);
        }
    }
    return {
        fixtureId: fixture.id,
        label: fixture.label,
        status: issues.length === 0 ? "passed" : "failed",
        issues,
        proposalType: proposal?.type ?? null,
        proposalItemCount: proposal ? (0, action_engine_1.getProposalItemCount)(proposal) : 0,
        traceWorkflow: trace.workflow,
    };
}
function runAIRunEvalSuite(fixtures) {
    const results = fixtures.map((fixture) => evaluateAIRunFixture(fixture));
    const passed = results.filter((result) => result.status === "passed").length;
    return {
        summary: {
            total: results.length,
            passed,
            failed: results.length - passed,
        },
        results,
    };
}
