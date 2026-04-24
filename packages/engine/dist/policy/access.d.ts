import type { MessageKey } from '../utils/translations';
export type PlatformRole = "EXEC" | "PM" | "OPS" | "FINANCE" | "MEMBER";
export type PlatformWorkspaceId = "executive" | "delivery" | "strategy";
export type PlatformPermission = "VIEW_EXECUTIVE_BRIEFS" | "SEND_TELEGRAM_DIGESTS" | "SEND_EMAIL_DIGESTS" | "RUN_SCHEDULED_DIGESTS" | "VIEW_CONNECTORS" | "MANAGE_IMPORTS" | "VIEW_WORK_REPORTS" | "CREATE_WORK_REPORTS" | "REVIEW_WORK_REPORTS" | "RUN_MEETING_TO_ACTION" | "RUN_DUE_DATE_SCAN" | "RUN_AI_ACTIONS" | "VIEW_TASKS" | "MANAGE_TASKS";
export interface PolicyWorkspaceOption {
    id: PlatformWorkspaceId;
    initials: string;
    nameKey: MessageKey;
    descriptionKey: MessageKey;
    allowedRoles: PlatformRole[];
}
export declare const workspaceCatalog: PolicyWorkspaceOption[];
export declare function isPlatformRole(value: unknown): value is PlatformRole;
export declare function isPlatformWorkspaceId(value: unknown): value is PlatformWorkspaceId;
export declare function normalizePlatformRole(value: unknown, fallback?: PlatformRole): PlatformRole;
export declare function getWorkspaceById(workspaceId: PlatformWorkspaceId): PolicyWorkspaceOption;
export declare function getAvailableWorkspacesForRole(role: PlatformRole): PolicyWorkspaceOption[];
export declare function canAccessWorkspace(role: PlatformRole, workspaceId: PlatformWorkspaceId): boolean;
export declare function hasPermission(role: PlatformRole, permission: PlatformPermission): boolean;
export declare function resolveAccessibleWorkspace(role: PlatformRole, requestedWorkspaceId?: string | null): PolicyWorkspaceOption;
//# sourceMappingURL=access.d.ts.map