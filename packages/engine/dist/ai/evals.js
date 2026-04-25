import { getProposalItemCount } from './action-engine.js';
import { buildMockFinalRun } from './mock-adapter.js';
import { buildAIRunTrace } from './trace.js';
import { z } from "zod";
const taskDraftSchema = z.object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    assignee: z.string().min(1),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    priority: z.enum(["low", "medium", "high", "critical"]),
    reason: z.string().min(1),
});
const taskUpdateDraftSchema = z.object({
    taskId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    assignee: z.string().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    reason: z.string().min(1),
});
const taskRescheduleDraftSchema = z.object({
    taskId: z.string().min(1),
    title: z.string().min(1),
    previousDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    assignee: z.string().optional(),
    reason: z.string().min(1),
});
const riskDraftSchema = z.object({
    projectId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    owner: z.string().min(1),
    probability: z.number().min(0).max(100),
    impact: z.number().min(0).max(100),
    mitigation: z.string().min(1),
    reason: z.string().min(1),
});
const statusReportSchema = z.object({
    projectId: z.string().min(1).optional(),
    title: z.string().min(1),
    audience: z.string().min(1),
    channel: z.string().min(1),
    summary: z.string().min(1),
    body: z.string().min(1),
    reason: z.string().min(1),
});
const notificationSchema = z.object({
    channel: z.string().min(1),
    recipients: z.array(z.string().min(1)).min(1),
    message: z.string().min(1),
    reason: z.string().min(1),
});
const proposalSchema = z.discriminatedUnion("type", [
    z.object({
        id: z.string().min(1),
        type: z.literal("create_tasks"),
        title: z.string().min(1),
        summary: z.string().min(1),
        state: z.enum(["pending", "applied", "dismissed"]),
        tasks: z.array(taskDraftSchema).min(1),
    }),
    z.object({
        id: z.string().min(1),
        type: z.literal("update_tasks"),
        title: z.string().min(1),
        summary: z.string().min(1),
        state: z.enum(["pending", "applied", "dismissed"]),
        tasks: z.array(taskDraftSchema),
        taskUpdates: z.array(taskUpdateDraftSchema).min(1),
    }),
    z.object({
        id: z.string().min(1),
        type: z.literal("reschedule_tasks"),
        title: z.string().min(1),
        summary: z.string().min(1),
        state: z.enum(["pending", "applied", "dismissed"]),
        tasks: z.array(taskDraftSchema),
        taskReschedules: z.array(taskRescheduleDraftSchema).min(1),
    }),
    z.object({
        id: z.string().min(1),
        type: z.literal("raise_risks"),
        title: z.string().min(1),
        summary: z.string().min(1),
        state: z.enum(["pending", "applied", "dismissed"]),
        tasks: z.array(taskDraftSchema),
        risks: z.array(riskDraftSchema).min(1),
    }),
    z.object({
        id: z.string().min(1),
        type: z.literal("draft_status_report"),
        title: z.string().min(1),
        summary: z.string().min(1),
        state: z.enum(["pending", "applied", "dismissed"]),
        tasks: z.array(taskDraftSchema),
        statusReport: statusReportSchema,
    }),
    z.object({
        id: z.string().min(1),
        type: z.literal("notify_team"),
        title: z.string().min(1),
        summary: z.string().min(1),
        state: z.enum(["pending", "applied", "dismissed"]),
        tasks: z.array(taskDraftSchema),
        notifications: z.array(notificationSchema).min(1),
    }),
]);
function hasProjectContext(input) {
    var _a;
    return Boolean(((_a = input.context.project) === null || _a === void 0 ? void 0 : _a.id) || input.context.activeContext.projectId);
}
export function evaluateAIRunFixture(fixture) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
            traceWorkflow: (_b = (_a = fixture.input.source) === null || _a === void 0 ? void 0 : _a.workflow) !== null && _b !== void 0 ? _b : null,
        };
    }
    const run = buildMockFinalRun(fixture.input, {
        id: `eval-${fixture.id}`,
        createdAt: "2026-03-11T09:00:00.000Z",
        updatedAt: "2026-03-11T09:00:05.000Z",
        quickActionId: (_c = fixture.input.quickAction) === null || _c === void 0 ? void 0 : _c.id,
    });
    const entry = {
        origin: "mock",
        input: fixture.input,
        run,
    };
    const trace = buildAIRunTrace(entry);
    const proposal = (_e = (_d = run.result) === null || _d === void 0 ? void 0 : _d.proposal) !== null && _e !== void 0 ? _e : null;
    const parsedProposal = proposalSchema.safeParse(proposal);
    if (!parsedProposal.success) {
        issues.push(`proposal_schema_invalid:${(_g = (_f = parsedProposal.error.issues[0]) === null || _f === void 0 ? void 0 : _f.message) !== null && _g !== void 0 ? _g : "unknown"}`);
    }
    if (!proposal) {
        issues.push("proposal_missing");
    }
    else {
        if (fixture.expectedProposalType && proposal.type !== fixture.expectedProposalType) {
            issues.push(`proposal_type_mismatch:${proposal.type}:expected:${fixture.expectedProposalType}`);
        }
        const itemCount = getProposalItemCount(proposal);
        if (fixture.minProposalItems && itemCount < fixture.minProposalItems) {
            issues.push(`proposal_item_count_too_low:${itemCount}:expected:${fixture.minProposalItems}`);
        }
    }
    return {
        fixtureId: fixture.id,
        label: fixture.label,
        status: issues.length === 0 ? "passed" : "failed",
        issues,
        proposalType: (_h = proposal === null || proposal === void 0 ? void 0 : proposal.type) !== null && _h !== void 0 ? _h : null,
        proposalItemCount: proposal ? getProposalItemCount(proposal) : 0,
        traceWorkflow: trace.workflow,
    };
}
export function runAIRunEvalSuite(fixtures) {
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
