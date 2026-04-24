"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceCatalog = void 0;
exports.isPlatformRole = isPlatformRole;
exports.isPlatformWorkspaceId = isPlatformWorkspaceId;
exports.normalizePlatformRole = normalizePlatformRole;
exports.getWorkspaceById = getWorkspaceById;
exports.getAvailableWorkspacesForRole = getAvailableWorkspacesForRole;
exports.canAccessWorkspace = canAccessWorkspace;
exports.hasPermission = hasPermission;
exports.resolveAccessibleWorkspace = resolveAccessibleWorkspace;
exports.workspaceCatalog = [
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
const rolePermissions = {
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
        "RUN_AI_ACTIONS",
        "VIEW_TASKS",
        "MANAGE_TASKS",
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
        "RUN_AI_ACTIONS",
        "VIEW_TASKS",
        "MANAGE_TASKS",
    ],
    OPS: [
        "VIEW_WORK_REPORTS",
        "CREATE_WORK_REPORTS",
        "REVIEW_WORK_REPORTS",
        "RUN_MEETING_TO_ACTION",
        "RUN_AI_ACTIONS",
        "VIEW_TASKS",
        "MANAGE_TASKS",
    ],
    FINANCE: ["VIEW_EXECUTIVE_BRIEFS", "VIEW_WORK_REPORTS", "VIEW_TASKS"],
    MEMBER: ["VIEW_WORK_REPORTS", "CREATE_WORK_REPORTS", "VIEW_TASKS"],
};
function isPlatformRole(value) {
    return (value === "EXEC" ||
        value === "PM" ||
        value === "OPS" ||
        value === "FINANCE" ||
        value === "MEMBER");
}
function isPlatformWorkspaceId(value) {
    return value === "executive" || value === "delivery" || value === "strategy";
}
function normalizePlatformRole(value, fallback = "PM") {
    if (value === "OWNER")
        return "EXEC";
    if (value === "ADMIN" || value === "CURATOR" || value === "SOLO") {
        return "PM";
    }
    return isPlatformRole(value) ? value : fallback;
}
function getWorkspaceById(workspaceId) {
    return exports.workspaceCatalog.find((workspace) => workspace.id === workspaceId) ?? exports.workspaceCatalog[0];
}
function getAvailableWorkspacesForRole(role) {
    return exports.workspaceCatalog.filter((workspace) => workspace.allowedRoles.includes(role));
}
function canAccessWorkspace(role, workspaceId) {
    return getWorkspaceById(workspaceId).allowedRoles.includes(role);
}
function hasPermission(role, permission) {
    return rolePermissions[role]?.includes(permission) ?? false;
}
function resolveAccessibleWorkspace(role, requestedWorkspaceId) {
    if (requestedWorkspaceId && isPlatformWorkspaceId(requestedWorkspaceId)) {
        const requestedWorkspace = getWorkspaceById(requestedWorkspaceId);
        if (requestedWorkspace.allowedRoles.includes(role)) {
            return requestedWorkspace;
        }
    }
    return getAvailableWorkspacesForRole(role)[0] ?? exports.workspaceCatalog[0];
}
