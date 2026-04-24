"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notify = notify;
exports.notifyTaskAssigned = notifyTaskAssigned;
exports.notifyDueDate = notifyDueDate;
exports.notifyStatusChanged = notifyStatusChanged;
exports.notifyMention = notifyMention;
exports.checkDueDates = checkDueDates;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../prisma");
/**
 * Create a notification for a user
 */
async function notify(payload) {
    try {
        const notification = await prisma_1.prisma.notification.create({
            data: {
                id: (0, node_crypto_1.randomUUID)(),
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
}
/**
 * Notify when a task is assigned to a user
 */
async function notifyTaskAssigned(taskId, taskTitle, assigneeId, assigneeName, projectName) {
    return notify({
        userId: assigneeId,
        type: "task_assigned",
        title: "Новая задача",
        message: `Вам назначена задача "${taskTitle}" в проекте "${projectName}"`,
        entityType: "task",
        entityId: taskId,
    });
}
/**
 * Notify when a task due date is approaching
 */
async function notifyDueDate(taskId, taskTitle, userId, daysLeft) {
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
}
/**
 * Notify when a project/task status changes
 */
async function notifyStatusChanged(entityType, entityId, entityName, userId, oldStatus, newStatus) {
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
}
/**
 * Notify when a user is mentioned
 */
async function notifyMention(entityType, entityId, entityName, mentionedUserId, mentionedByName) {
    return notify({
        userId: mentionedUserId,
        type: "mention",
        title: "Упоминание",
        message: `${mentionedByName} упомянул(а) вас в ${entityType === "project" ? "проекте" : "задаче"} "${entityName}"`,
        entityType,
        entityId,
    });
}
/**
 * Check for upcoming due dates and notify users
 * Should be called by a cron job or scheduled task
 */
async function checkDueDates() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const in3Days = new Date(now);
    in3Days.setDate(in3Days.getDate() + 3);
    const in7Days = new Date(now);
    in7Days.setDate(in7Days.getDate() + 7);
    // Find tasks due in 1, 3, or 7 days
    const tasks = await prisma_1.prisma.task.findMany({
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
        const notification = await notifyDueDate(task.id, task.title, task.assignee.id, daysLeft);
        if (notification) {
            notificationsCreated++;
        }
    }
    return { tasksChecked: tasks.length, notificationsCreated };
}
