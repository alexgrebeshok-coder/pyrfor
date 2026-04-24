/**
 * Permission Grants — granular RBAC for agents.
 *
 * Each grant allows an agent to perform a specific action on a resource type,
 * optionally scoped to a specific project.
 *
 * Resources: project, task, risk, expense, report, goal, *
 * Actions: read, write, delete, *
 * Scope: projectId or "*" (all projects) or "" (workspace-level)
 */
export interface PermissionCheck {
    agentId: string;
    resource: string;
    action: string;
    scope?: string;
}
/**
 * Check if an agent has a specific permission.
 * Checks in order: exact match → wildcard resource → wildcard action → full wildcard.
 */
export declare function hasPermission(check: PermissionCheck): Promise<boolean>;
/**
 * Check permission and throw if denied.
 */
export declare function requirePermission(check: PermissionCheck): Promise<void>;
export declare function grantPermission(agentId: string, resource: string, action: string, scope?: string): Promise<{
    id: string;
    createdAt: Date;
    resource: string;
    scope: string;
    agentId: string;
    action: string;
}>;
export declare function revokePermission(id: string): Promise<{
    id: string;
    createdAt: Date;
    resource: string;
    scope: string;
    agentId: string;
    action: string;
}>;
export declare function listPermissions(agentId: string): Promise<{
    id: string;
    createdAt: Date;
    resource: string;
    scope: string;
    agentId: string;
    action: string;
}[]>;
/**
 * Bulk set permissions for an agent (replaces all existing grants).
 */
export declare function setPermissions(agentId: string, grants: Array<{
    resource: string;
    action: string;
    scope?: string;
}>): Promise<void>;
//# sourceMappingURL=permission-grants.d.ts.map