import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";

export type NotificationType = "task_assigned" | "due_date" | "status_changed" | "mention";

interface NotificationPayload {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: "project" | "task" | "risk";
  entityId?: string;
}

/**
 * Create a notification for a user
 */
export async function notify(payload: NotificationPayload) {
  try {
    const notification = await prisma.notification.create({
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
  } catch (error) {
    console.error("[Notify] Error creating notification:", error);
    return null;
  }
}

/**
 * Notify when a task is assigned to a user
 */
export async function notifyTaskAssigned(
  taskId: string,
  taskTitle: string,
  assigneeId: string,
  assigneeName: string,
  projectName: string
) {
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
export async function notifyDueDate(
  taskId: string,
  taskTitle: string,
  userId: string,
  daysLeft: number
) {
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
export async function notifyStatusChanged(
  entityType: "project" | "task",
  entityId: string,
  entityName: string,
  userId: string,
  oldStatus: string,
  newStatus: string
) {
  const statusLabels: Record<string, string> = {
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
export async function notifyMention(
  entityType: "project" | "task",
  entityId: string,
  entityName: string,
  mentionedUserId: string,
  mentionedByName: string
) {
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
export async function checkDueDates() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  const in3Days = new Date(now);
  in3Days.setDate(in3Days.getDate() + 3);

  const in7Days = new Date(now);
  in7Days.setDate(in7Days.getDate() + 7);

  // Find tasks due in 1, 3, or 7 days
  const tasks = await prisma.task.findMany({
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
    if (!task.assignee) continue;

    const dueDate = new Date(task.dueDate);
    const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    const notification = await notifyDueDate(
      task.id,
      task.title,
      task.assignee.id,
      daysLeft
    );

    if (notification) {
      notificationsCreated++;
    }
  }

  return { tasksChecked: tasks.length, notificationsCreated };
}
