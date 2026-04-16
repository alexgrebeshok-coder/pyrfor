import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/orchestration/agents/:id/revisions — config change history
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const revisions = await prisma.agentConfigRevision.findMany({
    where: { agentId: id },
    orderBy: { changedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ revisions });
}
