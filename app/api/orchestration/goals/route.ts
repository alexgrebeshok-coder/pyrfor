/**
 * Goals API — CRUD + hierarchy
 * GET /api/orchestration/goals — list goals (tree or flat)
 * POST /api/orchestration/goals — create goal
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const sp = req.nextUrl.searchParams;
    const workspaceId = sp.get("workspaceId") ?? "executive";
    const flat = sp.get("flat") === "true";

    const goals = await prisma.goal.findMany({
      where: { workspaceId },
      include: {
        children: { select: { id: true, title: true, level: true, status: true } },
        _count: { select: { children: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    if (flat) return NextResponse.json({ goals });

    // Build tree
    type GoalNode = (typeof goals)[number] & { subGoals: GoalNode[] };
    const map = new Map<string, GoalNode>();
    for (const g of goals) map.set(g.id, { ...g, subGoals: [] });
    const roots: GoalNode[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.subGoals.push(node);
      } else {
        roots.push(node);
      }
    }

    return NextResponse.json({ goals: roots });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json();
    const { workspaceId = "executive", parentId, title, description, level = "team", ownerAgentId } = body;

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const goal = await prisma.goal.create({
      data: {
        workspaceId,
        parentId: parentId ?? null,
        title,
        description: description ?? null,
        level,
        ownerAgentId: ownerAgentId ?? null,
      },
    });

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
