import { buildApplySafetySummary, getProposalSafetyProfile } from './safety.js';
export function hasPendingProposal(result) {
    var _a;
    return ((_a = result === null || result === void 0 ? void 0 : result.proposal) === null || _a === void 0 ? void 0 : _a.state) === "pending";
}
export function getProposalItemCount(proposal) {
    switch (proposal.type) {
        case "create_tasks":
            return proposal.tasks.length;
        case "update_tasks":
            return proposal.taskUpdates.length;
        case "reschedule_tasks":
            return proposal.taskReschedules.length;
        case "raise_risks":
            return proposal.risks.length;
        case "draft_status_report":
            return 1;
        case "notify_team":
            return proposal.notifications.length;
    }
}
export function getProposalPeople(proposal) {
    switch (proposal.type) {
        case "create_tasks":
            return proposal.tasks.map((task) => task.assignee).filter(Boolean);
        case "update_tasks":
            return proposal.taskUpdates.map((task) => task.assignee).filter(Boolean);
        case "reschedule_tasks":
            return proposal.taskReschedules
                .map((task) => task.assignee)
                .filter(Boolean);
        case "raise_risks":
            return proposal.risks.map((risk) => risk.owner).filter(Boolean);
        case "draft_status_report":
            return [proposal.statusReport.audience].filter(Boolean);
        case "notify_team":
            return proposal.notifications.flatMap((item) => item.recipients).filter(Boolean);
    }
}
export function getProposalDates(proposal) {
    switch (proposal.type) {
        case "create_tasks":
            return proposal.tasks.map((task) => task.dueDate);
        case "update_tasks":
            return proposal.taskUpdates
                .map((task) => task.dueDate)
                .filter(Boolean);
        case "reschedule_tasks":
            return proposal.taskReschedules.map((task) => task.newDueDate);
        default:
            return [];
    }
}
export function getProposalPreviewItems(proposal) {
    switch (proposal.type) {
        case "create_tasks":
            return proposal.tasks.map((task, index) => ({
                key: `${proposal.id}-task-${index}`,
                title: task.title,
                description: task.description,
                reason: task.reason,
                assignee: task.assignee,
                dueDate: task.dueDate,
                priority: task.priority,
            }));
        case "update_tasks":
            return proposal.taskUpdates.map((task, index) => {
                var _a;
                return ({
                    key: `${proposal.id}-update-${index}`,
                    title: task.title,
                    description: (_a = task.description) !== null && _a !== void 0 ? _a : "Update task fields before the next execution cycle.",
                    reason: task.reason,
                    assignee: task.assignee,
                    dueDate: task.dueDate,
                    priority: task.priority,
                });
            });
        case "reschedule_tasks":
            return proposal.taskReschedules.map((task, index) => ({
                key: `${proposal.id}-reschedule-${index}`,
                title: task.title,
                description: `Move due date from ${task.previousDueDate} to ${task.newDueDate}.`,
                reason: task.reason,
                assignee: task.assignee,
                dueDate: task.newDueDate,
            }));
        case "raise_risks":
            return proposal.risks.map((risk, index) => ({
                key: `${proposal.id}-risk-${index}`,
                title: risk.title,
                description: risk.description,
                reason: risk.reason,
                assignee: risk.owner,
                priority: risk.impact >= 80 || risk.probability >= 80
                    ? "critical"
                    : risk.impact >= 60 || risk.probability >= 60
                        ? "high"
                        : "medium",
            }));
        case "draft_status_report":
            return [
                {
                    key: `${proposal.id}-report`,
                    title: proposal.statusReport.title,
                    description: proposal.statusReport.summary,
                    reason: proposal.statusReport.reason,
                    assignee: proposal.statusReport.audience,
                },
            ];
        case "notify_team":
            return proposal.notifications.map((item, index) => ({
                key: `${proposal.id}-notify-${index}`,
                title: `${item.channel} notification`,
                description: item.message,
                reason: item.reason,
                assignee: item.recipients.join(", "),
            }));
    }
}
export { getProposalSafetyProfile };
function buildApplySummary(proposal, itemCount) {
    switch (proposal.type) {
        case "create_tasks":
            return `Created ${itemCount} task drafts from the approved proposal.`;
        case "update_tasks":
            return `Prepared ${itemCount} task updates from the approved proposal.`;
        case "reschedule_tasks":
            return `Prepared ${itemCount} task reschedules from the approved proposal.`;
        case "raise_risks":
            return `Added ${itemCount} risks from the approved proposal.`;
        case "draft_status_report":
            return "Prepared one approved status report draft.";
        case "notify_team":
            return `Prepared ${itemCount} approved team notifications.`;
    }
}
export function buildApplyResult(proposal, appliedAt) {
    const itemCount = getProposalItemCount(proposal);
    return {
        proposalId: proposal.id,
        type: proposal.type,
        appliedAt,
        summary: buildApplySummary(proposal, itemCount),
        itemCount,
        tasksCreated: proposal.type === "create_tasks" ? [...proposal.tasks] : [],
        tasksUpdated: proposal.type === "update_tasks" ? [...proposal.taskUpdates] : [],
        tasksRescheduled: proposal.type === "reschedule_tasks" ? [...proposal.taskReschedules] : [],
        risksRaised: proposal.type === "raise_risks" ? [...proposal.risks] : [],
        draftedStatusReport: proposal.type === "draft_status_report" ? proposal.statusReport : null,
        notificationsSent: proposal.type === "notify_team" ? [...proposal.notifications] : [],
        safety: buildApplySafetySummary(proposal),
    };
}
export function reduceProposalState(run, proposalId, nextState, actionResult) {
    var _a, _b;
    const proposal = (_a = run.result) === null || _a === void 0 ? void 0 : _a.proposal;
    if (!proposal || proposal.id !== proposalId) {
        throw new Error(`Proposal ${proposalId} not found in run ${run.id}`);
    }
    const result = run.result;
    if (!result) {
        throw new Error(`Run ${run.id} has no result payload`);
    }
    return Object.assign(Object.assign({}, run), { status: nextState === "pending" ? "needs_approval" : "done", updatedAt: new Date().toISOString(), result: Object.assign(Object.assign({}, result), { actionResult: (_b = actionResult !== null && actionResult !== void 0 ? actionResult : result.actionResult) !== null && _b !== void 0 ? _b : null, proposal: Object.assign(Object.assign({}, proposal), { state: nextState }) }) });
}
export function applyAIProposal(run, proposalId) {
    var _a;
    const proposal = (_a = run.result) === null || _a === void 0 ? void 0 : _a.proposal;
    if (!proposal || proposal.id !== proposalId) {
        throw new Error(`Proposal ${proposalId} not found in run ${run.id}`);
    }
    if (proposal.state !== "pending") {
        throw new Error(`Proposal ${proposalId} is already ${proposal.state}`);
    }
    const appliedAt = new Date().toISOString();
    return reduceProposalState(Object.assign(Object.assign({}, run), { updatedAt: appliedAt }), proposalId, "applied", buildApplyResult(proposal, appliedAt));
}
