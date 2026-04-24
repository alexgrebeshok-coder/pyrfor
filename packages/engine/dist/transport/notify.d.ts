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
export declare function notify(payload: NotificationPayload): Promise<{
    id: string;
    createdAt: Date;
    type: string;
    title: string;
    message: string;
    entityType: string | null;
    read: boolean;
    entityId: string | null;
    userId: string;
    readAt: Date | null;
} | null>;
/**
 * Notify when a task is assigned to a user
 */
export declare function notifyTaskAssigned(taskId: string, taskTitle: string, assigneeId: string, assigneeName: string, projectName: string): Promise<{
    id: string;
    createdAt: Date;
    type: string;
    title: string;
    message: string;
    entityType: string | null;
    read: boolean;
    entityId: string | null;
    userId: string;
    readAt: Date | null;
} | null>;
/**
 * Notify when a task due date is approaching
 */
export declare function notifyDueDate(taskId: string, taskTitle: string, userId: string, daysLeft: number): Promise<{
    id: string;
    createdAt: Date;
    type: string;
    title: string;
    message: string;
    entityType: string | null;
    read: boolean;
    entityId: string | null;
    userId: string;
    readAt: Date | null;
} | null>;
/**
 * Notify when a project/task status changes
 */
export declare function notifyStatusChanged(entityType: "project" | "task", entityId: string, entityName: string, userId: string, oldStatus: string, newStatus: string): Promise<{
    id: string;
    createdAt: Date;
    type: string;
    title: string;
    message: string;
    entityType: string | null;
    read: boolean;
    entityId: string | null;
    userId: string;
    readAt: Date | null;
} | null>;
/**
 * Notify when a user is mentioned
 */
export declare function notifyMention(entityType: "project" | "task", entityId: string, entityName: string, mentionedUserId: string, mentionedByName: string): Promise<{
    id: string;
    createdAt: Date;
    type: string;
    title: string;
    message: string;
    entityType: string | null;
    read: boolean;
    entityId: string | null;
    userId: string;
    readAt: Date | null;
} | null>;
/**
 * Check for upcoming due dates and notify users
 * Should be called by a cron job or scheduled task
 */
export declare function checkDueDates(): Promise<{
    tasksChecked: number;
    notificationsCreated: number;
}>;
export {};
//# sourceMappingURL=notify.d.ts.map