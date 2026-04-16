/**
 * Single Run detail — get a specific heartbeat run with events
 * GET /api/orchestration/runs/[runId]
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ runId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { runId } = await params;
    const run = await prisma.heartbeatRun.findUnique({
      where: { id: runId },
      include: {
        agent: { select: { name: true, slug: true, role: true } },
        events: { orderBy: { seq: "asc" } },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
