import type { Prisma } from "@prisma/client";

import { prisma } from '../prisma';

type GoalListRecord = Prisma.GoalGetPayload<{
  include: {
    children: {
      select: {
        id: true;
        title: true;
        level: true;
        status: true;
        ownerAgentId: true;
      };
    };
    _count: { select: { children: true; taskLinks: true } };
  };
}>;

export type GoalTreeNode = GoalListRecord & {
  progress: number;
  subGoals: GoalTreeNode[];
};

export interface CreateGoalInput {
  workspaceId: string;
  parentId?: string | null;
  title: string;
  description?: string | null;
  level?: string;
  ownerAgentId?: string | null;
}

export interface UpdateGoalInput {
  title?: string;
  description?: string | null;
  status?: string;
  level?: string;
  parentId?: string | null;
  ownerAgentId?: string | null;
}

function withGoalProgress<T extends object>(goal: T): T & { progress: number } {
  return {
    ...goal,
    progress: 0,
  };
}

function buildGoalTree(goals: GoalListRecord[]): GoalTreeNode[] {
  const map = new Map<string, GoalTreeNode>();

  for (const goal of goals) {
    map.set(goal.id, {
      ...withGoalProgress(goal),
      subGoals: [],
    });
  }

  const roots: GoalTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.subGoals.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function listGoals(workspaceId: string, opts?: { flat?: boolean }) {
  const goals = await prisma.goal.findMany({
    where: { workspaceId },
    include: {
      children: {
        select: {
          id: true,
          title: true,
          level: true,
          status: true,
          ownerAgentId: true,
        },
      },
      _count: {
        select: {
          children: true,
          taskLinks: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (opts?.flat) {
    return goals.map((goal) => withGoalProgress(goal));
  }

  return buildGoalTree(goals);
}

export async function getGoal(id: string) {
  const goal = await prisma.goal.findUnique({
    where: { id },
    include: {
      children: {
        select: {
          id: true,
          title: true,
          level: true,
          status: true,
          ownerAgentId: true,
        },
      },
      parent: { select: { id: true, title: true } },
      _count: {
        select: {
          children: true,
          taskLinks: true,
        },
      },
    },
  });

  return goal ? withGoalProgress(goal) : null;
}

export async function createGoal(input: CreateGoalInput) {
  return prisma.goal.create({
    data: {
      workspaceId: input.workspaceId,
      parentId: input.parentId ?? null,
      title: input.title,
      description: input.description ?? null,
      level: input.level ?? "team",
      ownerAgentId: input.ownerAgentId ?? null,
    },
  });
}

export async function updateGoal(id: string, input: UpdateGoalInput) {
  const data: Prisma.GoalUpdateInput = {};

  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.status !== undefined) data.status = input.status;
  if (input.level !== undefined) data.level = input.level;
  if (input.parentId !== undefined) data.parent = input.parentId ? { connect: { id: input.parentId } } : { disconnect: true };
  if (input.ownerAgentId !== undefined) {
    data.owner = input.ownerAgentId
      ? { connect: { id: input.ownerAgentId } }
      : { disconnect: true };
  }

  return prisma.goal.update({
    where: { id },
    data,
  });
}

export async function deleteGoal(id: string) {
  return prisma.goal.delete({ where: { id } });
}
