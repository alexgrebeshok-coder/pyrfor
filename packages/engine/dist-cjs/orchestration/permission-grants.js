"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPermission = hasPermission;
exports.requirePermission = requirePermission;
exports.grantPermission = grantPermission;
exports.revokePermission = revokePermission;
exports.listPermissions = listPermissions;
exports.setPermissions = setPermissions;
const prisma_1 = require("../prisma");
/**
 * Check if an agent has a specific permission.
 * Checks in order: exact match → wildcard resource → wildcard action → full wildcard.
 */
async function hasPermission(check) {
    const { agentId, resource, action, scope } = check;
    // Build conditions: check exact + wildcards
    const grants = await prisma_1.prisma.permissionGrant.findMany({
        where: {
            agentId,
            resource: { in: [resource, "*"] },
            action: { in: [action, "*"] },
        },
        select: { resource: true, action: true, scope: true },
    });
    for (const grant of grants) {
        // Wildcard or empty scope matches everything
        if (grant.scope === "*" || grant.scope === "")
            return true;
        // Specific scope must match
        if (scope && grant.scope === scope)
            return true;
    }
    return false;
}
/**
 * Check permission and throw if denied.
 */
async function requirePermission(check) {
    const allowed = await hasPermission(check);
    if (!allowed) {
        throw new Error(`Permission denied: agent ${check.agentId} cannot ${check.action} ${check.resource}` +
            (check.scope ? ` in scope ${check.scope}` : ""));
    }
}
// ── CRUD ──
async function grantPermission(agentId, resource, action, scope) {
    return prisma_1.prisma.permissionGrant.upsert({
        where: {
            agentId_resource_action_scope: {
                agentId,
                resource,
                action,
                scope: scope ?? "",
            },
        },
        create: { agentId, resource, action, scope: scope ?? "" },
        update: {},
    });
}
async function revokePermission(id) {
    return prisma_1.prisma.permissionGrant.delete({ where: { id } });
}
async function listPermissions(agentId) {
    return prisma_1.prisma.permissionGrant.findMany({
        where: { agentId },
        orderBy: [{ resource: "asc" }, { action: "asc" }],
    });
}
/**
 * Bulk set permissions for an agent (replaces all existing grants).
 */
async function setPermissions(agentId, grants) {
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.permissionGrant.deleteMany({ where: { agentId } }),
        prisma_1.prisma.permissionGrant.createMany({
            data: grants.map((g) => ({
                agentId,
                resource: g.resource,
                action: g.action,
                scope: g.scope ?? "",
            })),
        }),
    ]);
}
