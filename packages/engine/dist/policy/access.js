export const workspaceCatalog = [
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
export function isPlatformRole(value) {
    return (value === "EXEC" ||
        value === "PM" ||
        value === "OPS" ||
        value === "FINANCE" ||
        value === "MEMBER");
}
export function isPlatformWorkspaceId(value) {
    return value === "executive" || value === "delivery" || value === "strategy";
}
export function normalizePlatformRole(value, fallback = "PM") {
    if (value === "OWNER")
        return "EXEC";
    if (value === "ADMIN" || value === "CURATOR" || value === "SOLO") {
        return "PM";
    }
    return isPlatformRole(value) ? value : fallback;
}
export function getWorkspaceById(workspaceId) {
    var _a;
    return (_a = workspaceCatalog.find((workspace) => workspace.id === workspaceId)) !== null && _a !== void 0 ? _a : workspaceCatalog[0];
}
export function getAvailableWorkspacesForRole(role) {
    return workspaceCatalog.filter((workspace) => workspace.allowedRoles.includes(role));
}
export function canAccessWorkspace(role, workspaceId) {
    return getWorkspaceById(workspaceId).allowedRoles.includes(role);
}
export function hasPermission(role, permission) {
    var _a, _b;
    return (_b = (_a = rolePermissions[role]) === null || _a === void 0 ? void 0 : _a.includes(permission)) !== null && _b !== void 0 ? _b : false;
}
export function resolveAccessibleWorkspace(role, requestedWorkspaceId) {
    var _a;
    if (requestedWorkspaceId && isPlatformWorkspaceId(requestedWorkspaceId)) {
        const requestedWorkspace = getWorkspaceById(requestedWorkspaceId);
        if (requestedWorkspace.allowedRoles.includes(role)) {
            return requestedWorkspace;
        }
    }
    return (_a = getAvailableWorkspacesForRole(role)[0]) !== null && _a !== void 0 ? _a : workspaceCatalog[0];
}
