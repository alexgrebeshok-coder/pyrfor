/**
 * Heartbeat Execute API — internal endpoint called by daemon
 * POST /api/orchestration/heartbeat/execute
 *
 * Executes a HeartbeatRun that was created by the daemon scheduler.
 * This runs inside the Next.js process so it has access to all
 * AI execution infrastructure (agent-executor, cost-tracker, etc.)
 */
import { NextRequest, NextResponse } from "next/server";
import { executeHeartbeatRun } from "@/lib/orchestration/heartbeat-executor";

export async function POST(req: NextRequest) {
  try {
    // Internal endpoint — validate by checking for required fields
    // In production, add a shared secret between daemon and app
    const body = await req.json();
    const { runId, agentId, workspaceId, wakeupRequestId, task } = body;

    if (!agentId || !workspaceId) {
      return NextResponse.json(
        { error: "agentId and workspaceId required" },
        { status: 400 }
      );
    }

    const result = await executeHeartbeatRun({
      agentId,
      workspaceId,
      wakeupRequestId,
      invocationSource: "daemon",
      task,
    });

    return NextResponse.json({ result });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message ?? "Heartbeat execution failed" },
      { status: 500 }
    );
  }
}
