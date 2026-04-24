"use strict";
/**
 * Analytics Tools for AI Agents
 * Dashboard and reporting operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyticsTools = exports.getTeamWorkloadTool = exports.getProjectHealthReportTool = exports.getDashboardAnalyticsTool = void 0;
const prisma_1 = require("../../prisma");
/**
 * Get dashboard analytics
 */
exports.getDashboardAnalyticsTool = {
    name: "get_dashboard_analytics",
    description: "Get overall dashboard analytics and KPIs",
    parameters: {
        type: "object",
        properties: {},
    },
    async execute() {
        const [projectCount, taskCount, activeProjects, overdueTasks] = await Promise.all([
            prisma_1.prisma.project.count(),
            prisma_1.prisma.task.count(),
            prisma_1.prisma.project.count({ where: { status: "active" } }),
            prisma_1.prisma.task.count({
                where: {
                    dueDate: { lt: new Date() },
                    status: { notIn: ["done", "completed"] },
                },
            }),
        ]);
        return {
            success: true,
            data: {
                totalProjects: projectCount,
                totalTasks: taskCount,
                activeProjects,
                overdueTasks,
            },
        };
    },
};
/**
 * Get project health report
 */
exports.getProjectHealthReportTool = {
    name: "get_project_health_report",
    description: "Get health report for a specific project",
    parameters: {
        type: "object",
        properties: {
            projectId: {
                type: "string",
                description: "Project ID",
            },
        },
        required: ["projectId"],
    },
    async execute(params) {
        const project = await prisma_1.prisma.project.findUnique({
            where: { id: params.projectId },
            include: {
                tasks: {
                    select: {
                        status: true,
                        priority: true,
                        dueDate: true,
                    },
                },
                risks: {
                    select: {
                        probability: true,
                        impact: true,
                    },
                },
            },
        });
        if (!project) {
            return { success: false, error: "Project not found" };
        }
        const completedTasks = project.tasks.filter((t) => t.status === "done").length;
        const totalTasks = project.tasks.length;
        // Map probability/impact strings to numbers
        const severityMap = { low: 1, medium: 2, high: 3 };
        const highRisks = project.risks.filter((r) => {
            const prob = severityMap[r.probability] ?? 1;
            const imp = severityMap[r.impact] ?? 1;
            return prob * imp > 4; // high*high = 9, high*medium = 6
        }).length;
        return {
            success: true,
            data: {
                projectId: project.id,
                projectName: project.name,
                progress: project.progress,
                taskCompletionRate: totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0,
                totalTasks,
                completedTasks,
                highRiskCount: highRisks,
                healthScore: Math.max(0, 100 - highRisks * 10),
            },
        };
    },
};
/**
 * Get team workload
 */
exports.getTeamWorkloadTool = {
    name: "get_team_workload",
    description: "Get workload distribution across team members",
    parameters: {
        type: "object",
        properties: {
            projectId: {
                type: "string",
                description: "Optional project ID to filter by",
            },
        },
    },
    async execute(params) {
        const whereClause = params.projectId
            ? { projectId: params.projectId }
            : {};
        const tasks = await prisma_1.prisma.task.findMany({
            where: whereClause,
            select: {
                assigneeId: true,
                status: true,
                priority: true,
            },
        });
        const workload = tasks.reduce((acc, task) => {
            const assigneeId = task.assigneeId || "unassigned";
            if (!acc[assigneeId]) {
                acc[assigneeId] = { total: 0, completed: 0, high: 0 };
            }
            acc[assigneeId].total++;
            if (task.status === "done")
                acc[assigneeId].completed++;
            if (task.priority === "high")
                acc[assigneeId].high++;
            return acc;
        }, {});
        return { success: true, data: workload };
    },
};
exports.analyticsTools = [
    exports.getDashboardAnalyticsTool,
    exports.getProjectHealthReportTool,
    exports.getTeamWorkloadTool,
];
