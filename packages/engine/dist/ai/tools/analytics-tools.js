/**
 * Analytics Tools for AI Agents
 * Dashboard and reporting operations
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../../prisma';
/**
 * Get dashboard analytics
 */
export const getDashboardAnalyticsTool = {
    name: "get_dashboard_analytics",
    description: "Get overall dashboard analytics and KPIs",
    parameters: {
        type: "object",
        properties: {},
    },
    execute() {
        return __awaiter(this, void 0, void 0, function* () {
            const [projectCount, taskCount, activeProjects, overdueTasks] = yield Promise.all([
                prisma.project.count(),
                prisma.task.count(),
                prisma.project.count({ where: { status: "active" } }),
                prisma.task.count({
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
        });
    },
};
/**
 * Get project health report
 */
export const getProjectHealthReportTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const project = yield prisma.project.findUnique({
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
                var _a, _b;
                const prob = (_a = severityMap[r.probability]) !== null && _a !== void 0 ? _a : 1;
                const imp = (_b = severityMap[r.impact]) !== null && _b !== void 0 ? _b : 1;
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
        });
    },
};
/**
 * Get team workload
 */
export const getTeamWorkloadTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const whereClause = params.projectId
                ? { projectId: params.projectId }
                : {};
            const tasks = yield prisma.task.findMany({
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
        });
    },
};
export const analyticsTools = [
    getDashboardAnalyticsTool,
    getProjectHealthReportTool,
    getTeamWorkloadTool,
];
