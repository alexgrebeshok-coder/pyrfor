"use strict";
/**
 * Project Tools for AI Agents
 * CRUD operations for projects
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectTools = exports.createProjectTool = exports.updateProjectProgressTool = exports.updateProjectBudgetTool = exports.getProjectStatusTool = exports.listProjectsTool = void 0;
const crypto_1 = require("crypto");
const prisma_1 = require("../../prisma");
/**
 * List all projects
 */
exports.listProjectsTool = {
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
    async execute(params) {
        const projects = await prisma_1.prisma.project.findMany({
            where: params.status ? { status: params.status } : undefined,
            take: params.limit || 20,
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
exports.getProjectStatusTool = {
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
    async execute(params) {
        const project = await prisma_1.prisma.project.findUnique({
            where: { id: params.projectId },
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
        const tasksByStatus = project.tasks.reduce((acc, task) => {
            acc[task.status] = (acc[task.status] || 0) + 1;
            return acc;
        }, {});
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
exports.updateProjectBudgetTool = {
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
    async execute(params) {
        const project = await prisma_1.prisma.project.update({
            where: { id: params.projectId },
            data: { budgetPlan: params.budgetPlan },
        });
        return { success: true, data: project };
    },
};
/**
 * Update project progress
 */
exports.updateProjectProgressTool = {
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
    async execute(params) {
        const project = await prisma_1.prisma.project.update({
            where: { id: params.projectId },
            data: { progress: params.progress },
        });
        return { success: true, data: project };
    },
};
/**
 * Create a new project
 */
exports.createProjectTool = {
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
    async execute(params) {
        const startDate = params.startDate ? new Date(params.startDate) : new Date();
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + 3); // Default 3 months
        const project = await prisma_1.prisma.project.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                name: params.name,
                description: params.description,
                direction: params.direction || "construction",
                budgetPlan: params.budgetPlan,
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
exports.projectTools = [
    exports.listProjectsTool,
    exports.getProjectStatusTool,
    exports.updateProjectBudgetTool,
    exports.updateProjectProgressTool,
    exports.createProjectTool,
];
