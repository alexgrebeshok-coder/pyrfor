/**
 * Analytics Tools for AI Agents
 * Dashboard and reporting operations
 */

import { prisma } from '../../prisma';
import type { AITool, ToolResult } from "./types";

/**
 * Get dashboard analytics
 */
export const getDashboardAnalyticsTool: AITool = {
  name: "get_dashboard_analytics",
  description: "Get overall dashboard analytics and KPIs",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute(): Promise<ToolResult> {
    const [projectCount, taskCount, activeProjects, overdueTasks] = await Promise.all([
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
  },
};

/**
 * Get project health report
 */
export const getProjectHealthReportTool: AITool = {
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
  async execute(params): Promise<ToolResult> {
    const project = await prisma.project.findUnique({
      where: { id: params.projectId as string },
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
    const severityMap: Record<string, number> = { low: 1, medium: 2, high: 3 };
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
export const getTeamWorkloadTool: AITool = {
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
  async execute(params): Promise<ToolResult> {
    const whereClause = params.projectId
      ? { projectId: params.projectId as string }
      : {};

    const tasks = await prisma.task.findMany({
      where: whereClause,
      select: {
        assigneeId: true,
        status: true,
        priority: true,
      },
    });

    const workload = tasks.reduce(
      (acc, task) => {
        const assigneeId = task.assigneeId || "unassigned";
        if (!acc[assigneeId]) {
          acc[assigneeId] = { total: 0, completed: 0, high: 0 };
        }
        acc[assigneeId].total++;
        if (task.status === "done") acc[assigneeId].completed++;
        if (task.priority === "high") acc[assigneeId].high++;
        return acc;
      },
      {} as Record<string, { total: number; completed: number; high: number }>
    );

    return { success: true, data: workload };
  },
};

export const analyticsTools: AITool[] = [
  getDashboardAnalyticsTool,
  getProjectHealthReportTool,
  getTeamWorkloadTool,
];
