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

import { prisma } from "@/lib/prisma";

export interface PermissionCheck {
  agentId: string;
  resource: string;
  action: string;
  scope?: string; // projectId; omit for workspace-level checks
}

/**
 * Check if an agent has a specific permission.
 * Checks in order: exact match → wildcard resource → wildcard action → full wildcard.
 */
export async function hasPermission(check: PermissionCheck): Promise<boolean> {
  const { agentId, resource, action, scope } = check;

  // Build conditions: check exact + wildcards
  const grants = await prisma.permissionGrant.findMany({
    where: {
      agentId,
      resource: { in: [resource, "*"] },
      action: { in: [action, "*"] },
    },
    select: { resource: true, action: true, scope: true },
  });

  for (const grant of grants) {
    // Wildcard or empty scope matches everything
    if (grant.scope === "*" || grant.scope === "") return true;
    // Specific scope must match
    if (scope && grant.scope === scope) return true;
  }

  return false;
}

/**
 * Check permission and throw if denied.
 */
export async function requirePermission(check: PermissionCheck): Promise<void> {
  const allowed = await hasPermission(check);
  if (!allowed) {
    throw new Error(
      `Permission denied: agent ${check.agentId} cannot ${check.action} ${check.resource}` +
        (check.scope ? ` in scope ${check.scope}` : "")
    );
  }
}

// ── CRUD ──

export async function grantPermission(
  agentId: string,
  resource: string,
  action: string,
  scope?: string
) {
  return prisma.permissionGrant.upsert({
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

export async function revokePermission(id: string) {
  return prisma.permissionGrant.delete({ where: { id } });
}

export async function listPermissions(agentId: string) {
  return prisma.permissionGrant.findMany({
    where: { agentId },
    orderBy: [{ resource: "asc" }, { action: "asc" }],
  });
}

/**
 * Bulk set permissions for an agent (replaces all existing grants).
 */
export async function setPermissions(
  agentId: string,
  grants: Array<{ resource: string; action: string; scope?: string }>
) {
  await prisma.$transaction([
    prisma.permissionGrant.deleteMany({ where: { agentId } }),
    prisma.permissionGrant.createMany({
      data: grants.map((g) => ({
        agentId,
        resource: g.resource,
        action: g.action,
        scope: g.scope ?? "",
      })),
    }),
  ]);
}
