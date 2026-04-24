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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { prisma } from '../prisma';
/**
 * Check if an agent has a specific permission.
 * Checks in order: exact match → wildcard resource → wildcard action → full wildcard.
 */
export function hasPermission(check) {
    return __awaiter(this, void 0, void 0, function* () {
        const { agentId, resource, action, scope } = check;
        // Build conditions: check exact + wildcards
        const grants = yield prisma.permissionGrant.findMany({
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
    });
}
/**
 * Check permission and throw if denied.
 */
export function requirePermission(check) {
    return __awaiter(this, void 0, void 0, function* () {
        const allowed = yield hasPermission(check);
        if (!allowed) {
            throw new Error(`Permission denied: agent ${check.agentId} cannot ${check.action} ${check.resource}` +
                (check.scope ? ` in scope ${check.scope}` : ""));
        }
    });
}
// ── CRUD ──
export function grantPermission(agentId, resource, action, scope) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.permissionGrant.upsert({
            where: {
                agentId_resource_action_scope: {
                    agentId,
                    resource,
                    action,
                    scope: scope !== null && scope !== void 0 ? scope : "",
                },
            },
            create: { agentId, resource, action, scope: scope !== null && scope !== void 0 ? scope : "" },
            update: {},
        });
    });
}
export function revokePermission(id) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.permissionGrant.delete({ where: { id } });
    });
}
export function listPermissions(agentId) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.permissionGrant.findMany({
            where: { agentId },
            orderBy: [{ resource: "asc" }, { action: "asc" }],
        });
    });
}
/**
 * Bulk set permissions for an agent (replaces all existing grants).
 */
export function setPermissions(agentId, grants) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prisma.$transaction([
            prisma.permissionGrant.deleteMany({ where: { agentId } }),
            prisma.permissionGrant.createMany({
                data: grants.map((g) => {
                    var _a;
                    return ({
                        agentId,
                        resource: g.resource,
                        action: g.action,
                        scope: (_a = g.scope) !== null && _a !== void 0 ? _a : "",
                    });
                }),
            }),
        ]);
    });
}
