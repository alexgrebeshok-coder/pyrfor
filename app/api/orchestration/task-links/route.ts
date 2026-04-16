/**
 * AgentTaskLink API — link agents to tasks
 * GET  — list links (filter by agentId or taskId)
 * POST — create link
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const sp = req.nextUrl.searchParams;
    const where: Record<string, unknown> = {};
    if (sp.get("agentId")) where.agentId = sp.get("agentId");
    if (sp.get("taskId")) where.taskId = sp.get("taskId");

    const links = await prisma.agentTaskLink.findMany({
      where,
      include: {
        agent: { select: { name: true, slug: true, role: true } },
        task: { select: { id: true, title: true, status: true } },
      },
      orderBy: { assignedAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ links });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { agentId, taskId, goalId } = await req.json();

    if (!agentId || !taskId) {
      return NextResponse.json({ error: "agentId and taskId required" }, { status: 400 });
    }

    const link = await prisma.agentTaskLink.create({
      data: { agentId, taskId, goalId: goalId ?? null },
    });

    return NextResponse.json({ link }, { status: 201 });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Link already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
