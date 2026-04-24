"use strict";
/**
 * Task Tools for AI Agents
 * CRUD operations for tasks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskTools = exports.deleteTaskTool = exports.assignTaskTool = exports.updateTaskStatusTool = exports.listTasksTool = exports.createTaskTool = void 0;
const crypto_1 = require("crypto");
const prisma_1 = require("../../prisma");
/**
 * Create a new task in a project
 */
exports.createTaskTool = {
    name: "create_task",
    description: "Create a new task in a project",
    parameters: {
        type: "object",
        properties: {
            projectId: {
                type: "string",
                description: "Project ID to add the task to",
            },
            title: {
                type: "string",
                description: "Task title",
            },
            description: {
                type: "string",
                description: "Task description (optional)",
            },
            priority: {
                type: "string",
                enum: ["low", "medium", "high", "critical"],
                description: "Task priority (default: medium)",
            },
            dueDate: {
                type: "string",
                description: "Due date in ISO format (optional)",
            },
            assigneeId: {
                type: "string",
                description: "Team member ID to assign (optional)",
            },
        },
        required: ["projectId", "title"],
    },
    async execute(params) {
        try {
            const projectId = params.projectId;
            const title = params.title;
            const description = params.description || "";
            const priority = params.priority || "medium";
            const dueDate = params.dueDate
                ? new Date(params.dueDate)
                : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default: 7 days
            // Verify project exists
            const project = await prisma_1.prisma.project.findUnique({
                where: { id: projectId },
            });
            if (!project) {
                return {
                    success: false,
                    error: `Project not found: ${projectId}`,
                };
            }
            // Create task
            const taskData = {
                id: (0, crypto_1.randomUUID)(),
                projectId,
                title,
                description,
                priority,
                status: "todo",
                dueDate,
                updatedAt: new Date(),
            };
            if (params.assigneeId) {
                taskData.assigneeId = params.assigneeId;
            }
            const task = await prisma_1.prisma.task.create({ data: taskData });
            return {
                success: true,
                data: {
                    id: task.id,
                    title: task.title,
                    status: task.status,
                    priority: task.priority,
                    dueDate: task.dueDate,
                },
            };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to create task",
            };
        }
    },
};
/**
 * List all tasks for a project
 */
exports.listTasksTool = {
    name: "list_tasks",
    description: "List all tasks for a project, optionally filtered by status",
    parameters: {
        type: "object",
        properties: {
            projectId: {
                type: "string",
                description: "Project ID",
            },
            status: {
                type: "string",
                enum: ["todo", "in_progress", "blocked", "done", "cancelled"],
                description: "Filter by status (optional)",
            },
            priority: {
                type: "string",
                enum: ["low", "medium", "high", "critical"],
                description: "Filter by priority (optional)",
            },
            limit: {
                type: "string",
                description: "Maximum number of tasks to return (default: 50)",
            },
        },
        required: ["projectId"],
    },
    async execute(params) {
        try {
            const projectId = params.projectId;
            const limit = params.limit ? parseInt(params.limit, 10) : 50;
            const whereClause = { projectId };
            if (params.status) {
                whereClause.status = params.status;
            }
            if (params.priority) {
                whereClause.priority = params.priority;
            }
            const tasks = await prisma_1.prisma.task.findMany({
                where: whereClause,
                include: {
                    assignee: {
                        select: { id: true, name: true, initials: true },
                    },
                },
                orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
                take: limit,
            });
            return {
                success: true,
                data: tasks.map((task) => ({
                    id: task.id,
                    title: task.title,
                    status: task.status,
                    priority: task.priority,
                    dueDate: task.dueDate,
                    assignee: task.assignee
                        ? { name: task.assignee.name, initials: task.assignee.initials }
                        : null,
                })),
            };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to list tasks",
            };
        }
    },
};
/**
 * Update task status
 */
exports.updateTaskStatusTool = {
    name: "update_task_status",
    description: "Update the status of a task",
    parameters: {
        type: "object",
        properties: {
            taskId: {
                type: "string",
                description: "Task ID",
            },
            status: {
                type: "string",
                enum: ["todo", "in_progress", "blocked", "done", "cancelled"],
                description: "New status",
            },
            description: {
                type: "string",
                description: "Optional updated description",
            },
            blockedReason: {
                type: "string",
                description: "Reason for blocking (optional)",
            },
        },
        required: ["taskId", "status"],
    },
    async execute(params) {
        try {
            const taskId = params.taskId;
            const status = params.status;
            const existingTask = await prisma_1.prisma.task.findUnique({
                where: { id: taskId },
            });
            if (!existingTask) {
                return { success: false, error: `Task not found: ${taskId}` };
            }
            const updateData = {
                status,
            };
            if (status === "done") {
                updateData.completedAt = new Date();
            }
            const descriptionParam = params.description;
            const blockedReason = params.blockedReason;
            if (descriptionParam || blockedReason) {
                let nextDescription = descriptionParam ?? existingTask.description ?? "";
                if (blockedReason) {
                    const reasonText = `Blocked: ${blockedReason}`;
                    nextDescription = nextDescription
                        ? `${nextDescription}\n\n${reasonText}`
                        : reasonText;
                }
                updateData.description = nextDescription;
            }
            const task = await prisma_1.prisma.task.update({
                where: { id: taskId },
                data: updateData,
            });
            return {
                success: true,
                data: {
                    id: task.id,
                    title: task.title,
                    status: task.status,
                },
            };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to update task",
            };
        }
    },
};
/**
 * Assign task to team member
 */
exports.assignTaskTool = {
    name: "assign_task",
    description: "Assign a task to a team member",
    parameters: {
        type: "object",
        properties: {
            taskId: {
                type: "string",
                description: "Task ID",
            },
            assigneeId: {
                type: "string",
                description: "Team member ID",
            },
        },
        required: ["taskId", "assigneeId"],
    },
    async execute(params) {
        try {
            const taskId = params.taskId;
            const assigneeId = params.assigneeId;
            // Verify assignee exists
            const member = await prisma_1.prisma.teamMember.findUnique({
                where: { id: assigneeId },
            });
            if (!member) {
                return {
                    success: false,
                    error: `Team member not found: ${assigneeId}`,
                };
            }
            const task = await prisma_1.prisma.task.update({
                where: { id: taskId },
                data: { assigneeId },
                include: {
                    assignee: {
                        select: { name: true, initials: true },
                    },
                },
            });
            return {
                success: true,
                data: {
                    id: task.id,
                    title: task.title,
                    assignee: task.assignee
                        ? { name: task.assignee.name, initials: task.assignee.initials }
                        : null,
                },
            };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to assign task",
            };
        }
    },
};
/**
 * Delete a task
 */
exports.deleteTaskTool = {
    name: "delete_task",
    description: "Delete a task",
    parameters: {
        type: "object",
        properties: {
            taskId: {
                type: "string",
                description: "Task ID to delete",
            },
        },
        required: ["taskId"],
    },
    async execute(params) {
        try {
            const taskId = params.taskId;
            await prisma_1.prisma.task.delete({
                where: { id: taskId },
            });
            return {
                success: true,
                data: { id: taskId, deleted: true },
            };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to delete task",
            };
        }
    },
};
/**
 * Export all task tools
 */
exports.taskTools = [
    exports.createTaskTool,
    exports.listTasksTool,
    exports.updateTaskStatusTool,
    exports.assignTaskTool,
    exports.deleteTaskTool,
];
