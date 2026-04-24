"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiQuickActions = void 0;
exports.getQuickActionsForContext = getQuickActionsForContext;
exports.getQuickActionById = getQuickActionById;
exports.aiQuickActions = [
    {
        id: "portfolio-brief",
        kind: "summarize_portfolio",
        agentId: "portfolio-analyst",
        labelKey: "ai.quick.portfolio",
        descriptionKey: "ai.quick.portfolioDescription",
        promptKey: "ai.quick.portfolioPrompt",
        contextTypes: ["portfolio"],
    },
    {
        id: "project-analysis",
        kind: "analyze_project",
        agentId: "portfolio-analyst",
        labelKey: "ai.quick.project",
        descriptionKey: "ai.quick.projectDescription",
        promptKey: "ai.quick.projectPrompt",
        contextTypes: ["project"],
    },
    {
        id: "project-task-plan",
        kind: "suggest_tasks",
        agentId: "execution-planner",
        labelKey: "ai.quick.tasks",
        descriptionKey: "ai.quick.tasksDescription",
        promptKey: "ai.quick.tasksPrompt",
        contextTypes: ["project"],
    },
    {
        id: "status-report",
        kind: "draft_status_report",
        agentId: "status-reporter",
        labelKey: "ai.quick.report",
        descriptionKey: "ai.quick.reportDescription",
        promptKey: "ai.quick.reportPrompt",
        contextTypes: ["portfolio", "project"],
    },
    {
        id: "budget-status",
        kind: "draft_status_report",
        agentId: "budget-controller",
        labelKey: "ai.quick.budget",
        descriptionKey: "ai.quick.budgetDescription",
        promptKey: "ai.quick.budgetPrompt",
        contextTypes: ["portfolio", "project"],
    },
    {
        id: "task-triage",
        kind: "triage_tasks",
        agentId: "risk-researcher",
        labelKey: "ai.quick.triage",
        descriptionKey: "ai.quick.triageDescription",
        promptKey: "ai.quick.triagePrompt",
        contextTypes: ["tasks"],
    },
];
function getQuickActionsForContext(contextType) {
    return exports.aiQuickActions.filter((action) => action.contextTypes.includes(contextType));
}
function getQuickActionById(actionId) {
    if (!actionId)
        return null;
    return exports.aiQuickActions.find((action) => action.id === actionId) ?? null;
}
