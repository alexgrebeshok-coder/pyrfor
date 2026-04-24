/**
 * Project Tools for AI Agents
 * CRUD operations for projects
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
import { randomUUID } from "crypto";
import { prisma } from '../../prisma';
/**
 * List all projects
 */
export const listProjectsTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const projects = yield prisma.project.findMany({
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
        });
    },
};
/**
 * Get project status
 */
export const getProjectStatusTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const project = yield prisma.project.findUnique({
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
        });
    },
};
/**
 * Update project budget
 */
export const updateProjectBudgetTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const project = yield prisma.project.update({
                where: { id: params.projectId },
                data: { budgetPlan: params.budgetPlan },
            });
            return { success: true, data: project };
        });
    },
};
/**
 * Update project progress
 */
export const updateProjectProgressTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const project = yield prisma.project.update({
                where: { id: params.projectId },
                data: { progress: params.progress },
            });
            return { success: true, data: project };
        });
    },
};
/**
 * Create a new project
 */
export const createProjectTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const startDate = params.startDate ? new Date(params.startDate) : new Date();
            const endDate = new Date(startDate);
            endDate.setMonth(endDate.getMonth() + 3); // Default 3 months
            const project = yield prisma.project.create({
                data: {
                    id: randomUUID(),
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
        });
    },
};
export const projectTools = [
    listProjectsTool,
    getProjectStatusTool,
    updateProjectBudgetTool,
    updateProjectProgressTool,
    createProjectTool,
];
