/**
 * Task Tools for AI Agents
 * CRUD operations for tasks
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
 * Create a new task in a project
 */
export const createTaskTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const projectId = params.projectId;
                const title = params.title;
                const description = params.description || "";
                const priority = params.priority || "medium";
                const dueDate = params.dueDate
                    ? new Date(params.dueDate)
                    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Default: 7 days
                // Verify project exists
                const project = yield prisma.project.findUnique({
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
                    id: randomUUID(),
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
                const task = yield prisma.task.create({ data: taskData });
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
        });
    },
};
/**
 * List all tasks for a project
 */
export const listTasksTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
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
                const tasks = yield prisma.task.findMany({
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
        });
    },
};
/**
 * Update task status
 */
export const updateTaskStatusTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                const taskId = params.taskId;
                const status = params.status;
                const existingTask = yield prisma.task.findUnique({
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
                    let nextDescription = (_a = descriptionParam !== null && descriptionParam !== void 0 ? descriptionParam : existingTask.description) !== null && _a !== void 0 ? _a : "";
                    if (blockedReason) {
                        const reasonText = `Blocked: ${blockedReason}`;
                        nextDescription = nextDescription
                            ? `${nextDescription}\n\n${reasonText}`
                            : reasonText;
                    }
                    updateData.description = nextDescription;
                }
                const task = yield prisma.task.update({
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
        });
    },
};
/**
 * Assign task to team member
 */
export const assignTaskTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const taskId = params.taskId;
                const assigneeId = params.assigneeId;
                // Verify assignee exists
                const member = yield prisma.teamMember.findUnique({
                    where: { id: assigneeId },
                });
                if (!member) {
                    return {
                        success: false,
                        error: `Team member not found: ${assigneeId}`,
                    };
                }
                const task = yield prisma.task.update({
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
        });
    },
};
/**
 * Delete a task
 */
export const deleteTaskTool = {
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
    execute(params) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const taskId = params.taskId;
                yield prisma.task.delete({
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
        });
    },
};
/**
 * Export all task tools
 */
export const taskTools = [
    createTaskTool,
    listTasksTool,
    updateTaskStatusTool,
    assignTaskTool,
    deleteTaskTool,
];
