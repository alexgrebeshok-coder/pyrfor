/**
 * CommandHandler — executes dashboard commands based on parsed intents
 *
 * Flow:
 * 1. User message → IntentParser → ParsedCommand
 * 2. ParsedCommand → CommandHandler → DashboardClient → API call
 * 3. Result → formatted response for user
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
import { getDashboardClient, DashboardAPIError, } from "./dashboard-client.js";
import { parseCommand } from "./intent-parser.js";
/**
 * Execute a natural language command
 *
 * @param text - User message (e.g., "Добавь задачу в ЧЭМК — согласовать СП")
 * @returns CommandResult with success status and message
 */
export function executeCommand(text_1) {
    return __awaiter(this, arguments, void 0, function* (text, client = getDashboardClient()) {
        const parsed = parseCommand(text);
        try {
            switch (parsed.intent) {
                case "createTask":
                    return yield handleCreateTask(parsed, client);
                case "listProjects":
                    return yield handleListProjects(client);
                case "showStatus":
                    return yield handleShowStatus(parsed, client);
                default:
                    return {
                        success: false,
                        message: `Не понял команду. Попробуй: "Добавь задачу в [проект]", "Покажи проекты", "Статус [проект]"`,
                    };
            }
        }
        catch (error) {
            if (error instanceof DashboardAPIError) {
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
    });
}
/**
 * Handle createTask intent
 */
function handleCreateTask(parsed, client) {
    return __awaiter(this, void 0, void 0, function* () {
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
        const project = yield client.findProjectByName(projectName);
        if (!project) {
            const projects = yield client.listProjects();
            const projectNames = projects.map((p) => p.name).join(", ");
            return {
                success: false,
                message: `Проект "${projectName}" не найден. Доступные проекты: ${projectNames}`,
            };
        }
        // Create task
        const newTask = yield client.createTask({
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
    });
}
/**
 * Handle listProjects intent
 */
function handleListProjects(client) {
    return __awaiter(this, void 0, void 0, function* () {
        const projects = yield client.listProjects();
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
    });
}
/**
 * Handle showStatus intent
 */
function handleShowStatus(parsed, client) {
    return __awaiter(this, void 0, void 0, function* () {
        const { project: projectName } = parsed.entities;
        if (!projectName) {
            return {
                success: false,
                message: "Укажи проект. Например: 'Статус ЧЭМК'",
            };
        }
        // Find project by name
        const project = yield client.findProjectByName(projectName);
        if (!project) {
            return {
                success: false,
                message: `Проект "${projectName}" не найден.`,
            };
        }
        // Get project tasks
        const tasks = yield client.listTasks(project.id);
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
    });
}
