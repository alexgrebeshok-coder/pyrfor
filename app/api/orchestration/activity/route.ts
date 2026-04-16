/**
 * Activity Log API — unified feed of agent activity
 * GET /api/orchestration/activity
 *
 * Merges: HeartbeatRun (agent runs), HeartbeatRunEvent (run steps)
 * Paginated, filterable by workspace, agent, date range.
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
    const agentId = sp.get("agentId") ?? undefined;
    const status = sp.get("status") ?? undefined;
    const limit = Math.min(Number(sp.get("limit") ?? "30"), 100);
    const cursor = sp.get("cursor") ?? undefined;
    const since = sp.get("since") ?? undefined;

    const where: Record<string, unknown> = { workspaceId };
    if (agentId) where.agentId = agentId;
    if (status) where.status = status;
    if (since) where.createdAt = { gte: new Date(since) };
    if (cursor) where.createdAt = { ...((where.createdAt as object) ?? {}), lt: new Date(cursor) };

    const runs = await prisma.heartbeatRun.findMany({
      where,
      include: {
        agent: { select: { name: true, slug: true, role: true } },
        events: { orderBy: { seq: "desc" }, take: 3 },
        _count: { select: { events: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = runs.length > limit;
    const items = hasMore ? runs.slice(0, limit) : runs;
    const nextCursor = hasMore
      ? items[items.length - 1].createdAt.toISOString()
      : null;

    // Compute summary stats
    const stats = await prisma.heartbeatRun.groupBy({
      by: ["status"],
      where: { workspaceId, ...(agentId ? { agentId } : {}) },
      _count: true,
    });

    return NextResponse.json({
      items: items.map((r) => ({
        id: r.id,
        type: "heartbeat_run",
        agentId: r.agentId,
        agentName: r.agent.name,
        agentRole: r.agent.role,
        status: r.status,
        invocationSource: r.invocationSource,
        createdAt: r.createdAt,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        eventCount: r._count.events,
        latestEvents: r.events.map((e) => ({
          type: e.type,
          content: e.content,
          createdAt: e.createdAt,
        })),
        usageJson: r.usageJson ? JSON.parse(r.usageJson) : null,
      })),
      nextCursor,
      stats: Object.fromEntries(stats.map((s) => [s.status, s._count])),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
