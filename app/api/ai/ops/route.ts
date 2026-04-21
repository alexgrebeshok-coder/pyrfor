import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getAllCircuitBreakerSnapshots } from "@/lib/ai/circuit-breaker";
import { agentBus } from "@/lib/ai/messaging/agent-bus";
import { getDailyCostPosture, getRecentBudgetAlerts } from "@/lib/ai/cost-tracker";
import { getServerAIStatus } from "@/lib/ai/server-runs";
import { getRouter } from "@/lib/ai/providers";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * AI Ops snapshot — read-only observability endpoint for the multi-agent core.
 *
 * Returns:
 *  - Current server AI execution mode (gateway/provider/mock/unavailable).
 *  - Per-provider circuit breaker state and counters.
 *  - Available providers and models.
 *  - Recent agent-bus persist failures (bounded buffer, best-effort).
 *  - Today's AI cost posture against the configured daily limit for the
 *    caller's workspace.
 *
 * Scope is always limited to the caller's workspace; cross-workspace access
 * is not possible from this endpoint.
 */
export async function GET(req: NextRequest) {
  const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
  if (authResult instanceof NextResponse) return authResult;

  const workspaceId = authResult.workspace.id;
  const busLimit = Math.min(Number(req.nextUrl.searchParams.get("busLimit") ?? "20"), 100);

  try {
    const [status, circuitBreakers, costPosture] = await Promise.all([
      Promise.resolve(getServerAIStatus()),
      Promise.resolve(getAllCircuitBreakerSnapshots()),
      getDailyCostPosture(workspaceId),
    ]);

    const router = getRouter();
    const providers = router.getAvailableProviders();
    const models = router.getAvailableModels();
    const recentBusErrors = agentBus.recentPersistErrors(busLimit);
    const recentBudgetAlerts = getRecentBudgetAlerts(workspaceId, busLimit);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      workspaceId,
      status,
      providers: {
        available: providers,
        models,
      },
      circuitBreakers,
      cost: {
        ...costPosture,
        recentAlerts: recentBudgetAlerts,
      },
      bus: {
        recentPersistErrors: recentBusErrors,
      },
    });
  } catch (error) {
    logger.error("[api/ai/ops] snapshot failed", {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: "Failed to load AI ops snapshot",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
