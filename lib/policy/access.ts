import type { MessageKey } from "@/lib/translations";

export type PlatformRole = "EXEC" | "PM" | "OPS" | "FINANCE" | "MEMBER";
export type PlatformWorkspaceId = "executive" | "delivery" | "strategy";
export type PlatformPermission =
  | "VIEW_EXECUTIVE_BRIEFS"
  | "SEND_TELEGRAM_DIGESTS"
  | "SEND_EMAIL_DIGESTS"
  | "RUN_SCHEDULED_DIGESTS"
  | "VIEW_CONNECTORS"
  | "MANAGE_IMPORTS"
  | "VIEW_WORK_REPORTS"
  | "CREATE_WORK_REPORTS"
  | "REVIEW_WORK_REPORTS"
  | "RUN_MEETING_TO_ACTION"
  | "RUN_DUE_DATE_SCAN"
  | "RUN_AI_ACTIONS"
  | "VIEW_TASKS"
  | "MANAGE_TASKS";

export interface PolicyWorkspaceOption {
  id: PlatformWorkspaceId;
  initials: string;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  allowedRoles: PlatformRole[];
}

export const workspaceCatalog: PolicyWorkspaceOption[] = [
  {
    id: "executive",
    initials: "HQ",
    nameKey: "workspace.executive.name",
    descriptionKey: "workspace.executive.description",
    allowedRoles: ["EXEC", "PM", "FINANCE"],
  },
  {
    id: "delivery",
    initials: "DO",
    nameKey: "workspace.delivery.name",
    descriptionKey: "workspace.delivery.description",
    allowedRoles: ["EXEC", "PM", "OPS", "MEMBER"],
  },
  {
    id: "strategy",
    initials: "SR",
    nameKey: "workspace.strategy.name",
    descriptionKey: "workspace.strategy.description",
    allowedRoles: ["EXEC", "PM", "FINANCE"],
  },
];

const rolePermissions: Record<PlatformRole, PlatformPermission[]> = {
  EXEC: [
    "VIEW_EXECUTIVE_BRIEFS",
    "SEND_TELEGRAM_DIGESTS",
    "SEND_EMAIL_DIGESTS",
    "RUN_SCHEDULED_DIGESTS",
    "VIEW_CONNECTORS",
    "MANAGE_IMPORTS",
    "VIEW_WORK_REPORTS",
    "CREATE_WORK_REPORTS",
    "REVIEW_WORK_REPORTS",
    "RUN_MEETING_TO_ACTION",
    "RUN_DUE_DATE_SCAN",
    "VIEW_TASKS",
  ],
  PM: [
    "VIEW_EXECUTIVE_BRIEFS",
    "SEND_TELEGRAM_DIGESTS",
    "SEND_EMAIL_DIGESTS",
    "RUN_SCHEDULED_DIGESTS",
    "VIEW_CONNECTORS",
    "MANAGE_IMPORTS",
    "VIEW_WORK_REPORTS",
    "CREATE_WORK_REPORTS",
    "REVIEW_WORK_REPORTS",
    "RUN_MEETING_TO_ACTION",
    "RUN_DUE_DATE_SCAN",
    "VIEW_TASKS",
  ],
  OPS: [
    "VIEW_WORK_REPORTS",
    "CREATE_WORK_REPORTS",
    "REVIEW_WORK_REPORTS",
    "RUN_MEETING_TO_ACTION",
    "VIEW_TASKS",
  ],
  FINANCE: ["VIEW_EXECUTIVE_BRIEFS", "VIEW_WORK_REPORTS", "VIEW_TASKS"],
  MEMBER: ["VIEW_WORK_REPORTS", "CREATE_WORK_REPORTS", "VIEW_TASKS"],
};

export function isPlatformRole(value: unknown): value is PlatformRole {
  return (
    value === "EXEC" ||
    value === "PM" ||
    value === "OPS" ||
    value === "FINANCE" ||
    value === "MEMBER"
  );
}

export function isPlatformWorkspaceId(value: unknown): value is PlatformWorkspaceId {
  return value === "executive" || value === "delivery" || value === "strategy";
}

export function normalizePlatformRole(
  value: unknown,
  fallback: PlatformRole = "PM"
): PlatformRole {
  if (value === "OWNER") return "EXEC";
  if (value === "ADMIN" || value === "CURATOR" || value === "SOLO") {
    return "PM";
  }
  return isPlatformRole(value) ? value : fallback;
}

export function getWorkspaceById(workspaceId: PlatformWorkspaceId): PolicyWorkspaceOption {
  return workspaceCatalog.find((workspace) => workspace.id === workspaceId) ?? workspaceCatalog[0];
}

export function getAvailableWorkspacesForRole(role: PlatformRole): PolicyWorkspaceOption[] {
  return workspaceCatalog.filter((workspace) => workspace.allowedRoles.includes(role));
}

export function canAccessWorkspace(role: PlatformRole, workspaceId: PlatformWorkspaceId): boolean {
  return getWorkspaceById(workspaceId).allowedRoles.includes(role);
}

export function hasPermission(role: PlatformRole, permission: PlatformPermission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

export function resolveAccessibleWorkspace(
  role: PlatformRole,
  requestedWorkspaceId?: string | null
): PolicyWorkspaceOption {
  if (requestedWorkspaceId && isPlatformWorkspaceId(requestedWorkspaceId)) {
    const requestedWorkspace = getWorkspaceById(requestedWorkspaceId);
    if (requestedWorkspace.allowedRoles.includes(role)) {
      return requestedWorkspace;
    }
  }

  return getAvailableWorkspacesForRole(role)[0] ?? workspaceCatalog[0];
}
