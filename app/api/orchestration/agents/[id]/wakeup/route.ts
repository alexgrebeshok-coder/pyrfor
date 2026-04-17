/**
 * Agent Wakeup API — trigger a heartbeat run
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { getAgent } from "@/lib/orchestration/agent-service";
import { jobQueue } from "@/lib/orchestration/job-queue";
import {
  buildWakeupIdempotencyKey,
  resolveMaxRetries,
} from "@/lib/orchestration/retry-policy-service";
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
    const triggerData =
      body.triggerData && typeof body.triggerData === "object"
        ? (body.triggerData as Record<string, unknown>)
        : {};

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

    const circuitOpenUntil = agent.runtimeState?.circuitOpenUntil;
    if (
      agent.runtimeState?.circuitState === "open" &&
      circuitOpenUntil &&
      new Date(circuitOpenUntil) > new Date()
    ) {
      return NextResponse.json(
        {
          error: `Agent circuit is open until ${new Date(circuitOpenUntil).toISOString()}`,
        },
        { status: 409 }
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
      triggerData,
      idempotencyKey:
        typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
          ? body.idempotencyKey
          : buildWakeupIdempotencyKey({
              agentId: id,
              reason,
              triggerData,
              scope: "manual",
              bucketMs: 30_000,
            }),
      maxRetries: resolveMaxRetries(agent.runtimeConfig),
    });

    return NextResponse.json(
      { message: "Wakeup request queued", job },
      { status: 202 }
    );
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to create wakeup request") }, { status: 500 });
  }
}
