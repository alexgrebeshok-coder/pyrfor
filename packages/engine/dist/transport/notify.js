var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from "node:crypto";
import { prisma } from '../prisma.js';
/**
 * Create a notification for a user
 */
export function notify(payload) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const notification = yield prisma.notification.create({
                data: {
                    id: randomUUID(),
                    userId: payload.userId,
                    type: payload.type,
                    title: payload.title,
                    message: payload.message,
                    entityType: payload.entityType,
                    entityId: payload.entityId,
                },
            });
            return notification;
        }
        catch (error) {
            console.error("[Notify] Error creating notification:", error);
            return null;
        }
    });
}
/**
 * Notify when a task is assigned to a user
 */
export function notifyTaskAssigned(taskId, taskTitle, assigneeId, assigneeName, projectName) {
    return __awaiter(this, void 0, void 0, function* () {
        return notify({
            userId: assigneeId,
            type: "task_assigned",
            title: "Новая задача",
            message: `Вам назначена задача "${taskTitle}" в проекте "${projectName}"`,
            entityType: "task",
            entityId: taskId,
        });
    });
}
/**
 * Notify when a task due date is approaching
 */
export function notifyDueDate(taskId, taskTitle, userId, daysLeft) {
    return __awaiter(this, void 0, void 0, function* () {
        const message = daysLeft === 0
            ? `Задача "${taskTitle}" должна быть выполнена сегодня`
            : daysLeft === 1
                ? `Задача "${taskTitle}" должна быть выполнена завтра`
                : `До срока задачи "${taskTitle}" осталось ${daysLeft} дней`;
        return notify({
            userId,
            type: "due_date",
            title: "Срок задачи",
            message,
            entityType: "task",
            entityId: taskId,
        });
    });
}
/**
 * Notify when a project/task status changes
 */
export function notifyStatusChanged(entityType, entityId, entityName, userId, oldStatus, newStatus) {
    return __awaiter(this, void 0, void 0, function* () {
        const statusLabels = {
            todo: "К выполнению",
            in_progress: "В работе",
            review: "На проверке",
            done: "Выполнено",
            blocked: "Заблокировано",
            active: "Активен",
            planning: "Планирование",
            at_risk: "Под угрозой",
            completed: "Завершён",
            on_hold: "Приостановлен",
        };
        return notify({
            userId,
            type: "status_changed",
            title: "Статус изменён",
            message: `${entityType === "project" ? "Проект" : "Задача"} "${entityName}" переш${entityType === "project" ? "ёл" : "ла"} из "${statusLabels[oldStatus] || oldStatus}" в "${statusLabels[newStatus] || newStatus}"`,
            entityType,
            entityId,
        });
    });
}
/**
 * Notify when a user is mentioned
 */
export function notifyMention(entityType, entityId, entityName, mentionedUserId, mentionedByName) {
    return __awaiter(this, void 0, void 0, function* () {
        return notify({
            userId: mentionedUserId,
            type: "mention",
            title: "Упоминание",
            message: `${mentionedByName} упомянул(а) вас в ${entityType === "project" ? "проекте" : "задаче"} "${entityName}"`,
            entityType,
            entityId,
        });
    });
}
/**
 * Check for upcoming due dates and notify users
 * Should be called by a cron job or scheduled task
 */
export function checkDueDates() {
    return __awaiter(this, void 0, void 0, function* () {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const in3Days = new Date(now);
        in3Days.setDate(in3Days.getDate() + 3);
        const in7Days = new Date(now);
        in7Days.setDate(in7Days.getDate() + 7);
        // Find tasks due in 1, 3, or 7 days
        const tasks = yield prisma.task.findMany({
            where: {
                status: { not: "done" },
                dueDate: {
                    in: [tomorrow, in3Days, in7Days],
                },
            },
            include: {
                project: true,
                assignee: true,
            },
        });
        let notificationsCreated = 0;
        for (const task of tasks) {
            if (!task.assignee)
                continue;
            const dueDate = new Date(task.dueDate);
            const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            const notification = yield notifyDueDate(task.id, task.title, task.assignee.id, daysLeft);
            if (notification) {
                notificationsCreated++;
            }
        }
        return { tasksChecked: tasks.length, notificationsCreated };
    });
}
