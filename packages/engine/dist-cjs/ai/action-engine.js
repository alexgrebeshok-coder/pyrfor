"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProposalSafetyProfile = void 0;
exports.hasPendingProposal = hasPendingProposal;
exports.getProposalItemCount = getProposalItemCount;
exports.getProposalPeople = getProposalPeople;
exports.getProposalDates = getProposalDates;
exports.getProposalPreviewItems = getProposalPreviewItems;
exports.buildApplyResult = buildApplyResult;
exports.reduceProposalState = reduceProposalState;
exports.applyAIProposal = applyAIProposal;
const safety_1 = require("./safety");
Object.defineProperty(exports, "getProposalSafetyProfile", { enumerable: true, get: function () { return safety_1.getProposalSafetyProfile; } });
function hasPendingProposal(result) {
    return result?.proposal?.state === "pending";
}
function getProposalItemCount(proposal) {
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
function getProposalPeople(proposal) {
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
function getProposalDates(proposal) {
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
function getProposalPreviewItems(proposal) {
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
            return proposal.taskUpdates.map((task, index) => ({
                key: `${proposal.id}-update-${index}`,
                title: task.title,
                description: task.description ?? "Update task fields before the next execution cycle.",
                reason: task.reason,
                assignee: task.assignee,
                dueDate: task.dueDate,
                priority: task.priority,
            }));
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
function buildApplyResult(proposal, appliedAt) {
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
        safety: (0, safety_1.buildApplySafetySummary)(proposal),
    };
}
function reduceProposalState(run, proposalId, nextState, actionResult) {
    const proposal = run.result?.proposal;
    if (!proposal || proposal.id !== proposalId) {
        throw new Error(`Proposal ${proposalId} not found in run ${run.id}`);
    }
    const result = run.result;
    if (!result) {
        throw new Error(`Run ${run.id} has no result payload`);
    }
    return {
        ...run,
        status: nextState === "pending" ? "needs_approval" : "done",
        updatedAt: new Date().toISOString(),
        result: {
            ...result,
            actionResult: actionResult ?? result.actionResult ?? null,
            proposal: {
                ...proposal,
                state: nextState,
            },
        },
    };
}
function applyAIProposal(run, proposalId) {
    const proposal = run.result?.proposal;
    if (!proposal || proposal.id !== proposalId) {
        throw new Error(`Proposal ${proposalId} not found in run ${run.id}`);
    }
    if (proposal.state !== "pending") {
        throw new Error(`Proposal ${proposalId} is already ${proposal.state}`);
    }
    const appliedAt = new Date().toISOString();
    return reduceProposalState({
        ...run,
        updatedAt: appliedAt,
    }, proposalId, "applied", buildApplyResult(proposal, appliedAt));
}
