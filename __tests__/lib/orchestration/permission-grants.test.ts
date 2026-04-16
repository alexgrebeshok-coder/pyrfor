import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    permissionGrant: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  grantPermission,
  hasPermission,
  setPermissions,
} from "@/lib/orchestration/permission-grants";

describe("permission grants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.permissionGrant.findMany.mockResolvedValue([]);
    mocks.prisma.permissionGrant.upsert.mockResolvedValue({ id: "grant-1" });
    mocks.prisma.permissionGrant.deleteMany.mockResolvedValue({ count: 0 });
    mocks.prisma.permissionGrant.createMany.mockResolvedValue({ count: 0 });
    mocks.prisma.$transaction.mockImplementation(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations)
    );
  });

  it("treats empty scope as a workspace-wide grant", async () => {
    mocks.prisma.permissionGrant.findMany.mockResolvedValue([{ scope: "" }]);

    await expect(
      hasPermission({
        agentId: "agent-1",
        resource: "project",
        action: "read",
      })
    ).resolves.toBe(true);
  });

  it("matches only the requested scoped grant when scope is specific", async () => {
    mocks.prisma.permissionGrant.findMany.mockResolvedValue([{ scope: "project-1" }]);

    await expect(
      hasPermission({
        agentId: "agent-1",
        resource: "task",
        action: "write",
        scope: "project-1",
      })
    ).resolves.toBe(true);

    await expect(
      hasPermission({
        agentId: "agent-1",
        resource: "task",
        action: "write",
        scope: "project-2",
      })
    ).resolves.toBe(false);
  });

  it("normalizes missing scope to an empty string for upserts", async () => {
    await grantPermission("agent-1", "goal", "read");

    expect(mocks.prisma.permissionGrant.upsert).toHaveBeenCalledWith({
      where: {
        agentId_resource_action_scope: {
          agentId: "agent-1",
          resource: "goal",
          action: "read",
          scope: "",
        },
      },
      create: {
        agentId: "agent-1",
        resource: "goal",
        action: "read",
        scope: "",
      },
      update: {},
    });
  });

  it("normalizes bulk permission scopes before writing", async () => {
    await setPermissions("agent-1", [
      { resource: "project", action: "read" },
      { resource: "task", action: "write", scope: "project-7" },
    ]);

    expect(mocks.prisma.permissionGrant.deleteMany).toHaveBeenCalledWith({
      where: { agentId: "agent-1" },
    });
    expect(mocks.prisma.permissionGrant.createMany).toHaveBeenCalledWith({
      data: [
        {
          agentId: "agent-1",
          resource: "project",
          action: "read",
          scope: "",
        },
        {
          agentId: "agent-1",
          resource: "task",
          action: "write",
          scope: "project-7",
        },
      ],
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
