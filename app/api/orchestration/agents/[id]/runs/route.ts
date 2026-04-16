/**
 * Agent Runs API — list runs for a specific agent
 * GET /api/orchestration/agents/[id]/runs
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "20");
    const status = req.nextUrl.searchParams.get("status") ?? undefined;

    const where: Record<string, unknown> = { agentId: id };
    if (status) where.status = status;

    const runs = await prisma.heartbeatRun.findMany({
      where,
      include: {
        events: { orderBy: { seq: "asc" }, take: 50 },
        _count: { select: { events: true } },
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
    });

    return NextResponse.json({ runs });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load runs") }, { status: 500 });
  }
}
