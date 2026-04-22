/**
 * Project Tools for AI Agents
 * CRUD operations for projects
 */

import { randomUUID } from "crypto";
import { prisma } from '../../prisma';
import type { AITool, ToolResult } from "./types";

/**
 * List all projects
 */
export const listProjectsTool: AITool = {
  name: "list_projects",
  description: "Get a list of all projects with their status",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["planning", "active", "on_hold", "completed", "at_risk"],
        description: "Filter by project status",
      },
      limit: {
        type: "number",
        description: "Maximum number of projects to return",
      },
    },
  },
  async execute(params): Promise<ToolResult> {
    const projects = await prisma.project.findMany({
      where: params.status ? { status: params.status as string } : undefined,
      take: (params.limit as number) || 20,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        budgetPlan: true,
        progress: true,
        start: true,
        end: true,
      },
    });
    return { success: true, data: projects };
  },
};

/**
 * Get project status
 */
export const getProjectStatusTool: AITool = {
  name: "get_project_status",
  description: "Get detailed status of a specific project",
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
          select: { status: true, priority: true },
        },
        _count: {
          select: { tasks: true },
        },
      },
    });

    if (!project) {
      return { success: false, error: "Project not found" };
    }

    const tasksByStatus = project.tasks.reduce(
      (acc, task) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      success: true,
      data: {
        id: project.id,
        name: project.name,
        status: project.status,
        budgetPlan: project.budgetPlan,
        progress: project.progress,
        taskCount: project._count.tasks,
        tasksByStatus,
      },
    };
  },
};

/**
 * Update project budget
 */
export const updateProjectBudgetTool: AITool = {
  name: "update_project_budget",
  description: "Update the planned budget for a project",
  parameters: {
    type: "object",
    properties: {
      projectId: {
        type: "string",
        description: "Project ID",
      },
      budgetPlan: {
        type: "number",
        description: "New planned budget amount",
      },
    },
    required: ["projectId", "budgetPlan"],
  },
  async execute(params): Promise<ToolResult> {
    const project = await prisma.project.update({
      where: { id: params.projectId as string },
      data: { budgetPlan: params.budgetPlan as number },
    });
    return { success: true, data: project };
  },
};

/**
 * Update project progress
 */
export const updateProjectProgressTool: AITool = {
  name: "update_project_progress",
  description: "Update the progress percentage for a project",
  parameters: {
    type: "object",
    properties: {
      projectId: {
        type: "string",
        description: "Project ID",
      },
      progress: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Progress percentage (0-100)",
      },
    },
    required: ["projectId", "progress"],
  },
  async execute(params): Promise<ToolResult> {
    const project = await prisma.project.update({
      where: { id: params.projectId as string },
      data: { progress: params.progress as number },
    });
    return { success: true, data: project };
  },
};

/**
 * Create a new project
 */
export const createProjectTool: AITool = {
  name: "create_project",
  description: "Create a new project",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Project name",
      },
      description: {
        type: "string",
        description: "Project description",
      },
      direction: {
        type: "string",
        enum: ["metallurgy", "logistics", "trade", "construction"],
        description: "Project direction/category",
      },
      budgetPlan: {
        type: "number",
        description: "Initial planned budget",
      },
      startDate: {
        type: "string",
        format: "date",
        description: "Project start date (YYYY-MM-DD)",
      },
    },
    required: ["name", "direction", "startDate"],
  },
  async execute(params): Promise<ToolResult> {
    const startDate = params.startDate ? new Date(params.startDate as string) : new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 3); // Default 3 months

    const project = await prisma.project.create({
      data: {
        id: randomUUID(),
        name: params.name as string,
        description: params.description as string | undefined,
        direction: (params.direction as string) || "construction",
        budgetPlan: params.budgetPlan as number | undefined,
        start: startDate,
        end: endDate,
        status: "planning",
        priority: "medium",
        health: "good",
        updatedAt: new Date(),
      },
    });
    return { success: true, data: project };
  },
};

export const projectTools: AITool[] = [
  listProjectsTool,
  getProjectStatusTool,
  updateProjectBudgetTool,
  updateProjectProgressTool,
  createProjectTool,
];
