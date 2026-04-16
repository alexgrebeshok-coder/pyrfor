/**
 * Agent Wakeup API — trigger a heartbeat run
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { getAgent } from "@/lib/orchestration/agent-service";
import { jobQueue } from "@/lib/orchestration/job-queue";
import type { WakeupReason } from "@/lib/orchestration/types";

type Params = { params: Promise<{ id: string }> };

// POST /api/orchestration/agents/[id]/wakeup
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const reason: WakeupReason = body.reason ?? "user";

    const agent = await getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    if (agent.status === "terminated") {
      return NextResponse.json(
        { error: "Cannot wake a terminated agent" },
        { status: 400 }
      );
    }

    if (agent.status === "paused") {
      return NextResponse.json(
        { error: "Agent is paused. Resume it first." },
        { status: 400 }
      );
    }

    // Budget check
    if (
      agent.budgetMonthlyCents > 0 &&
      agent.spentMonthlyCents >= agent.budgetMonthlyCents
    ) {
      return NextResponse.json(
        { error: "Agent has exceeded monthly budget" },
        { status: 402 }
      );
    }

    const job = await jobQueue.enqueue({
      agentId: id,
      reason,
      triggerData: body.triggerData,
    });

    return NextResponse.json(
      { message: "Wakeup request queued", job },
      { status: 202 }
    );
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to create wakeup request") }, { status: 500 });
  }
}
