import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "executive";
    const status = req.nextUrl.searchParams.get("status") ?? "open";
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "20"), 100);

    const items = await prisma.deadLetterJob.findMany({
      where: {
        workspaceId,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        agent: {
          select: {
            name: true,
            slug: true,
            role: true,
          },
        },
      },
    });

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        agentId: item.agentId,
        agentName: item.agent.name,
        agentSlug: item.agent.slug,
        agentRole: item.agent.role,
        wakeupRequestId: item.wakeupRequestId,
        runId: item.runId,
        reason: item.reason,
        errorType: item.errorType,
        errorMessage: item.errorMessage,
        attempts: item.attempts,
        status: item.status,
        createdAt: item.createdAt,
        resolvedAt: item.resolvedAt,
      })),
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load dead-letter queue") },
      { status: 500 }
    );
  }
}
