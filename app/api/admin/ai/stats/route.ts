/**
 * GET /api/admin/ai/stats
 *
 * AI Observability Dashboard endpoint.
 * Returns real-time stats: provider health, circuit breaker states,
 * recent costs, run counts, agent activity.
 *
 * Requires: MANAGE_WORKSPACE permission (admin only)
 */

import { type NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { circuitBreakers } from "@/lib/ai/circuit-breaker";
import { getRouter } from "@/lib/ai/providers";
import { agentBus } from "@/lib/ai/messaging/agent-bus";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, { permission: "RUN_AI_ACTIONS" });
  if (authResult instanceof NextResponse) return authResult;

  try {
    const router = getRouter();
    const availableProviders = router.getAvailableProviders();

    // Circuit breaker states
    const circuitStates = Object.fromEntries(
      Array.from(circuitBreakers.entries()).map(([name, cb]) => [name, cb.getState()])
    );

    // Cost stats (last 24h)
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    let costStats24h = { totalCostUsd: 0, totalCostRub: 0, runCount: 0 };
    let costStats7d = { totalCostUsd: 0, totalCostRub: 0, runCount: 0 };
    let topAgents: Array<{ agentId: string; runCount: number; totalCostUsd: number }> = [];
    let providerBreakdown: Array<{ provider: string; runCount: number; totalCostUsd: number }> = [];

    try {
      const [raw24h, raw7d, rawAgents, rawProviders] = await Promise.all([
        prisma.aIRunCost.aggregate({
          where: { createdAt: { gte: since24h } },
          _sum: { costUsd: true, costRub: true },
          _count: true,
        }),
        prisma.aIRunCost.aggregate({
          where: { createdAt: { gte: since7d } },
          _sum: { costUsd: true, costRub: true },
          _count: true,
        }),
        prisma.aIRunCost.groupBy({
          by: ["agentId"],
          where: { createdAt: { gte: since7d }, agentId: { not: null } },
          _count: true,
          _sum: { costUsd: true },
          orderBy: { _sum: { costUsd: "desc" } },
          take: 10,
        }),
        prisma.aIRunCost.groupBy({
          by: ["provider"],
          where: { createdAt: { gte: since7d } },
          _count: true,
          _sum: { costUsd: true },
          orderBy: { _sum: { costUsd: "desc" } },
        }),
      ]);

      costStats24h = {
        totalCostUsd: raw24h._sum.costUsd ?? 0,
        totalCostRub: raw24h._sum.costRub ?? 0,
        runCount: raw24h._count ?? 0,
      };
      costStats7d = {
        totalCostUsd: raw7d._sum.costUsd ?? 0,
        totalCostRub: raw7d._sum.costRub ?? 0,
        runCount: raw7d._count ?? 0,
      };
      topAgents = rawAgents.map((r) => ({
        agentId: r.agentId ?? "unknown",
        runCount: typeof r._count === "number" ? r._count : 0,
        totalCostUsd: r._sum?.costUsd ?? 0,
      }));
      providerBreakdown = rawProviders.map((r) => ({
        provider: r.provider,
        runCount: typeof r._count === "number" ? r._count : 0,
        totalCostUsd: r._sum?.costUsd ?? 0,
      }));
    } catch (dbErr) {
      logger.warn("admin/ai/stats: DB query failed", {
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }

    // Recent bus activity
    const recentBusMessages = agentBus.recent({ limit: 20 }).map((m) => ({
      id: m.id,
      type: m.type,
      source: m.source,
      target: m.target,
      timestamp: m.timestamp,
    }));

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      providers: {
        available: availableProviders,
        count: availableProviders.length,
      },
      circuitBreakers: circuitStates,
      costs: {
        last24h: costStats24h,
        last7d: costStats7d,
        topAgents,
        providerBreakdown,
      },
      bus: {
        recentMessages: recentBusMessages,
      },
    });
  } catch (err) {
    logger.error("admin/ai/stats: unhandled error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
