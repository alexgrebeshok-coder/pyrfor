/**
 * Pyrfor Runtime — Telegram PM Command Handlers
 *
 * Standalone module containing pure business-logic for Telegram PM commands.
 * No grammy / bot wiring here — orchestrator (cli.ts) wires the bot adapter.
 *
 * Prisma is injected via setTelegramPrismaClient to avoid @prisma/client dep.
 * runMessage for /ai is injected at call-site by orchestrator.
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
import { randomUUID } from 'crypto';
import { logger } from '../../observability/logger.js';
// ─── Prisma (injected, typed as any) ─────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _prisma = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setTelegramPrismaClient(client) {
    _prisma = client;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTelegramPrismaClient() {
    if (!_prisma) {
        throw new Error('[tg-handlers] Prisma client not initialised — call setTelegramPrismaClient first');
    }
    return _prisma;
}
// ─── ACL ─────────────────────────────────────────────────────────────────────
/**
 * Returns true when chatId is allowed.
 * Empty allowedChatIds = open mode (everyone allowed).
 */
export function isAllowedChat(chatId, allowedChatIds) {
    if (allowedChatIds.length === 0)
        return true;
    return allowedChatIds.includes(chatId);
}
// ─── Rate Limiter ─────────────────────────────────────────────────────────────
/**
 * In-memory sliding-window rate limiter, per chatId.
 * Keeps the last `perMinute` timestamps per chat in a 60-second window.
 */
export function createRateLimiter(perMinute) {
    const windows = new Map();
    return {
        allow(chatId) {
            var _a;
            const now = Date.now();
            const windowMs = 60000;
            const cutoff = now - windowMs;
            let timestamps = (_a = windows.get(chatId)) !== null && _a !== void 0 ? _a : [];
            // Drop expired timestamps
            timestamps = timestamps.filter((t) => t > cutoff);
            if (timestamps.length >= perMinute) {
                logger.warn('[tg-handlers] rate limit exceeded', { chatId });
                return false;
            }
            timestamps.push(now);
            windows.set(chatId, timestamps);
            return true;
        },
    };
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Escape MarkdownV2 special characters for Telegram.
 *  Null/undefined input is coerced to empty string (defensive: DB fields may be nullable at runtime). */
export function escapeMarkdown(text) {
    return (text !== null && text !== void 0 ? text : '').replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
function formatDate(date) {
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
// ─── Command Handlers ─────────────────────────────────────────────────────────
export function handleStatus(_a) {
    return __awaiter(this, arguments, void 0, function* ({ chatId }) {
        const prisma = getTelegramPrismaClient();
        logger.debug('[tg-handlers] handleStatus', { chatId });
        const projects = yield prisma.project.findMany({
            select: { name: true, status: true, progress: true, health: true },
            take: 10,
        });
        if (projects.length === 0) {
            return '📊 Нет проектов в системе. Создайте первый проект в дашборде.';
        }
        const lines = ['📊 *Статус проектов:*\n'];
        for (const project of projects) {
            const emoji = project.status === 'active' ? '🟢' :
                project.status === 'completed' ? '✅' :
                    project.status === 'at-risk' ? '🔴' :
                        project.status === 'on-hold' ? '⏸️' : '🟡';
            const healthBar = project.health !== null && project.health !== undefined
                ? ` | Health: ${project.health}%` : '';
            const progressBar = project.progress !== null && project.progress !== undefined
                ? ` (${project.progress}%)` : '';
            lines.push(`${emoji} *${escapeMarkdown(project.name)}*${progressBar}${healthBar}`);
        }
        const totalActive = projects.filter((p) => p.status === 'active').length;
        const totalAtRisk = projects.filter((p) => p.status === 'at-risk').length;
        lines.push('');
        lines.push(`📈 Активных: ${totalActive} | ⚠️ В риске: ${totalAtRisk}`);
        return lines.join('\n');
    });
}
export function handleProjects(_a) {
    return __awaiter(this, arguments, void 0, function* ({ chatId }) {
        var _b;
        const prisma = getTelegramPrismaClient();
        logger.debug('[tg-handlers] handleProjects', { chatId });
        const projects = yield prisma.project.findMany({
            select: { id: true, name: true, status: true, progress: true, health: true, description: true, priority: true },
            orderBy: { updatedAt: 'desc' },
            take: 10,
        });
        if (projects.length === 0)
            return '📂 Проектов пока нет.';
        const lines = ['📂 *Проекты:*\n'];
        for (const project of projects) {
            const priorityEmoji = project.priority === 'critical' ? '🔴' :
                project.priority === 'high' ? '🟠' :
                    project.priority === 'medium' ? '🟡' : '🟢';
            lines.push(`${priorityEmoji} *${escapeMarkdown(project.name)}*`);
            if (project.description) {
                const desc = project.description.length > 80
                    ? project.description.slice(0, 80) + '...' : project.description;
                lines.push(`  _${escapeMarkdown(desc)}_`);
            }
            lines.push(`  Прогресс: ${(_b = project.progress) !== null && _b !== void 0 ? _b : 0}% | Статус: ${project.status}`);
            lines.push('');
        }
        return lines.join('\n');
    });
}
export function handleTasks(_a) {
    return __awaiter(this, arguments, void 0, function* ({ chatId }) {
        var _b;
        const prisma = getTelegramPrismaClient();
        logger.debug('[tg-handlers] handleTasks', { chatId });
        const tasks = yield prisma.task.findMany({
            where: { status: { in: ['todo', 'in_progress', 'in-progress', 'blocked'] } },
            select: {
                title: true,
                status: true,
                priority: true,
                dueDate: true,
                assignee: true,
                project: { select: { name: true } },
            },
            orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
            take: 15,
        });
        if (tasks.length === 0)
            return '✅ Все задачи выполнены! Нет открытых задач.';
        const lines = ['📋 *Текущие задачи:*\n'];
        for (const task of tasks) {
            const statusEmoji = task.status === 'blocked' ? '🚫' :
                task.status === 'in_progress' || task.status === 'in-progress' ? '🔄' : '📌';
            const priorityEmoji = task.priority === 'critical' ? '🔴' :
                task.priority === 'high' ? '🟠' :
                    task.priority === 'medium' ? '🟡' : '🟢';
            const dueStr = task.dueDate ? ` | 📅 ${formatDate(task.dueDate)}` : '';
            const projectStr = ((_b = task.project) === null || _b === void 0 ? void 0 : _b.name) ? ` [${escapeMarkdown(task.project.name)}]` : '';
            lines.push(`${statusEmoji}${priorityEmoji} *${escapeMarkdown(task.title)}*${projectStr}${dueStr}`);
        }
        const blockedCount = tasks.filter((t) => t.status === 'blocked').length;
        if (blockedCount > 0)
            lines.push(`\n⚠️ Заблокировано: ${blockedCount}`);
        return lines.join('\n');
    });
}
export function handleAddTask(_a) {
    return __awaiter(this, arguments, void 0, function* ({ chatId, params }) {
        var _b;
        const prisma = getTelegramPrismaClient();
        const projectQuery = (_b = params[0]) !== null && _b !== void 0 ? _b : '';
        const taskTitle = params.slice(1).join(' ');
        if (!projectQuery || !taskTitle) {
            return '❌ Использование: /add_task <проект> <задача>\n\nПример: /add_task Мост Проверить арматуру';
        }
        logger.debug('[tg-handlers] handleAddTask', { chatId, projectQuery, taskTitle });
        const project = yield prisma.project.findFirst({
            where: { name: { contains: projectQuery } },
            select: { id: true, name: true },
        });
        if (!project) {
            const projects = yield prisma.project.findMany({ select: { name: true }, take: 5 });
            const suggestions = projects.map((p) => `• ${p.name}`).join('\n');
            return `❌ Проект "${projectQuery}" не найден.\n\nДоступные проекты:\n${suggestions}`;
        }
        const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        yield prisma.task.create({
            data: {
                id: randomUUID(),
                title: taskTitle,
                projectId: project.id,
                status: 'todo',
                priority: 'medium',
                dueDate,
                updatedAt: new Date(),
            },
        });
        return `✅ Задача создана!\n\n*${escapeMarkdown(taskTitle)}*\nПроект: ${escapeMarkdown(project.name)}\nСрок: ${formatDate(dueDate)}`;
    });
}
/**
 * /ai handler — delegates to `runMessage` injected by orchestrator.
 * If runMessage is not provided, returns a stub message (orchestrator must wire it).
 */
export function handleAi(_a, runMessage_1) {
    return __awaiter(this, arguments, void 0, function* ({ chatId, params }, runMessage) {
        const query = params.join(' ').trim();
        if (!query) {
            return '❌ Использование: /ai <вопрос>\n\nПример: /ai Какие задачи просрочены?';
        }
        logger.debug('[tg-handlers] handleAi', { chatId, query: query.slice(0, 80) });
        if (!runMessage) {
            // Orchestrator has not wired the AI runtime yet
            return '⚠️ AI runtime not wired. Orchestrator must inject runMessage.';
        }
        return runMessage(query);
    });
}
export function handleMorningBrief(_a) {
    return __awaiter(this, arguments, void 0, function* ({ chatId }) {
        var _b, _c;
        const prisma = getTelegramPrismaClient();
        logger.debug('[tg-handlers] handleMorningBrief', { chatId });
        const now = new Date();
        const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const [projects, overdueTasks, upcomingTasks, blockedTasks] = yield Promise.all([
            prisma.project.findMany({
                where: { status: { in: ['active', 'at-risk'] } },
                select: { name: true, status: true, progress: true, health: true },
            }),
            prisma.task.findMany({
                where: { status: { in: ['todo', 'in_progress', 'in-progress'] }, dueDate: { lt: now } },
                select: { title: true, dueDate: true, project: { select: { name: true } } },
                take: 5,
            }),
            prisma.task.findMany({
                where: { status: { in: ['todo', 'in_progress', 'in-progress'] }, dueDate: { gte: now, lte: weekFromNow } },
                select: { title: true, dueDate: true, priority: true },
                orderBy: { dueDate: 'asc' },
                take: 5,
            }),
            prisma.task.findMany({
                where: { status: 'blocked' },
                select: { title: true, description: true },
                take: 3,
            }),
        ]);
        const lines = [`☀️ *Утренний брифинг — ${formatDate(now)}*\n`];
        const atRisk = projects.filter((p) => p.status === 'at-risk');
        lines.push(`📊 *Проекты:* ${projects.length} активных${atRisk.length > 0 ? `, ${atRisk.length} в риске` : ''}`);
        if (atRisk.length > 0) {
            for (const p of atRisk) {
                lines.push(`  🔴 ${escapeMarkdown(p.name)} — ${(_b = p.progress) !== null && _b !== void 0 ? _b : 0}%`);
            }
        }
        if (overdueTasks.length > 0) {
            lines.push(`\n⚠️ *Просрочено (${overdueTasks.length}):*`);
            for (const t of overdueTasks) {
                lines.push(`  • ${escapeMarkdown(t.title)}${t.project ? ` [${escapeMarkdown(t.project.name)}]` : ''}`);
            }
        }
        if (upcomingTasks.length > 0) {
            lines.push(`\n📅 *На этой неделе:*`);
            for (const t of upcomingTasks) {
                const emoji = t.priority === 'critical' ? '🔴' :
                    t.priority === 'high' ? '🟠' : '📌';
                lines.push(`  ${emoji} ${escapeMarkdown(t.title)} — ${t.dueDate ? formatDate(t.dueDate) : 'без срока'}`);
            }
        }
        if (blockedTasks.length > 0) {
            lines.push(`\n🚫 *Заблокировано (${blockedTasks.length}):*`);
            for (const t of blockedTasks) {
                lines.push(`  • ${escapeMarkdown(t.title)}: ${escapeMarkdown((_c = t.description) !== null && _c !== void 0 ? _c : 'причина не указана')}`);
            }
        }
        if (overdueTasks.length === 0 && blockedTasks.length === 0) {
            lines.push('\n✅ Всё идёт по плану!');
        }
        return lines.join('\n');
    });
}
