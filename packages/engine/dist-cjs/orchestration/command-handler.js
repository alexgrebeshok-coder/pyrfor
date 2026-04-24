"use strict";
/**
 * CommandHandler — executes dashboard commands based on parsed intents
 *
 * Flow:
 * 1. User message → IntentParser → ParsedCommand
 * 2. ParsedCommand → CommandHandler → DashboardClient → API call
 * 3. Result → formatted response for user
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeCommand = executeCommand;
const dashboard_client_1 = require("./dashboard-client");
const intent_parser_1 = require("./intent-parser");
/**
 * Execute a natural language command
 *
 * @param text - User message (e.g., "Добавь задачу в ЧЭМК — согласовать СП")
 * @returns CommandResult with success status and message
 */
async function executeCommand(text, client = (0, dashboard_client_1.getDashboardClient)()) {
    const parsed = (0, intent_parser_1.parseCommand)(text);
    try {
        switch (parsed.intent) {
            case "createTask":
                return await handleCreateTask(parsed, client);
            case "listProjects":
                return await handleListProjects(client);
            case "showStatus":
                return await handleShowStatus(parsed, client);
            default:
                return {
                    success: false,
                    message: `Не понял команду. Попробуй: "Добавь задачу в [проект]", "Покажи проекты", "Статус [проект]"`,
                };
        }
    }
    catch (error) {
        if (error instanceof dashboard_client_1.DashboardAPIError) {
            return {
                success: false,
                message: `Ошибка API: ${error.message}`,
            };
        }
        return {
            success: false,
            message: `Ошибка: ${error instanceof Error ? error.message : "Неизвестная ошибка"}`,
        };
    }
}
/**
 * Handle createTask intent
 */
async function handleCreateTask(parsed, client) {
    const { project: projectName, task: taskTitle } = parsed.entities;
    if (!projectName) {
        return {
            success: false,
            message: "Укажи проект. Например: 'Добавь задачу в ЧЭМК — согласовать СП'",
        };
    }
    if (!taskTitle) {
        return {
            success: false,
            message: "Укажи задачу. Например: 'Добавь задачу в ЧЭМК — согласовать СП'",
        };
    }
    // Find project by name
    const project = await client.findProjectByName(projectName);
    if (!project) {
        const projects = await client.listProjects();
        const projectNames = projects.map((p) => p.name).join(", ");
        return {
            success: false,
            message: `Проект "${projectName}" не найден. Доступные проекты: ${projectNames}`,
        };
    }
    // Create task
    const newTask = await client.createTask({
        projectId: project.id,
        title: taskTitle,
        status: "todo",
        priority: "medium",
    });
    return {
        success: true,
        message: `✅ Задача "${taskTitle}" добавлена в проект "${project.name}"`,
        data: newTask,
    };
}
/**
 * Handle listProjects intent
 */
async function handleListProjects(client) {
    const projects = await client.listProjects();
    if (projects.length === 0) {
        return {
            success: true,
            message: "Проектов пока нет.",
        };
    }
    const projectList = projects
        .map((p, i) => {
        const progress = p.progress || 0;
        const status = p.status === "active" ? "🟢" : p.status === "at-risk" ? "🔴" : "🟡";
        return `${i + 1}. ${status} ${p.name} (${progress}%)`;
    })
        .join("\n");
    return {
        success: true,
        message: `📋 Проекты (${projects.length}):\n${projectList}`,
        data: projects,
    };
}
/**
 * Handle showStatus intent
 */
async function handleShowStatus(parsed, client) {
    const { project: projectName } = parsed.entities;
    if (!projectName) {
        return {
            success: false,
            message: "Укажи проект. Например: 'Статус ЧЭМК'",
        };
    }
    // Find project by name
    const project = await client.findProjectByName(projectName);
    if (!project) {
        return {
            success: false,
            message: `Проект "${projectName}" не найден.`,
        };
    }
    // Get project tasks
    const tasks = await client.listTasks(project.id);
    const completedTasks = tasks.filter((t) => t.status === "done").length;
    const totalTasks = tasks.length;
    // Format status
    const statusEmoji = project.status === "active" ? "🟢" : project.status === "at-risk" ? "🔴" : "🟡";
    const progress = project.progress || 0;
    const budget = project.budget || { planned: 0, actual: 0 };
    const budgetUsed = budget.actual > 0 && budget.planned > 0
        ? Math.round((budget.actual / budget.planned) * 100)
        : 0;
    const dates = project.dates || { start: "?", end: "?" };
    const message = [
        `${statusEmoji} **${project.name}**`,
        ``,
        `📊 Прогресс: ${progress}%`,
        `📝 Задачи: ${completedTasks}/${totalTasks} выполнено`,
        `💰 Бюджет: ${budget.actual.toLocaleString()} / ${budget.planned.toLocaleString()} (${budgetUsed}%)`,
        `📅 Срок: ${dates.start} → ${dates.end}`,
    ].join("\n");
    return {
        success: true,
        message,
        data: { project, tasks },
    };
}
