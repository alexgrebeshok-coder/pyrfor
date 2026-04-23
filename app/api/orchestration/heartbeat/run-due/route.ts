/**
 * Heartbeat Cron Endpoint — production loop on Vercel
 * POST /api/orchestration/heartbeat/run-due
 *
 * Replaces the local croner daemon for production. Called every minute
 * by Vercel Cron. Drains AgentWakeupRequest queue + wakes scheduled agents.
 *
 * Differs from /api/orchestration/heartbeat/execute (which runs ONE wake-up
 * for a single agent): this endpoint orchestrates the full heartbeat cycle
 * by calling the scheduler with an in-process fetchImpl that invokes
 * `executeHeartbeatRun` directly (no localhost HTTP roundtrip).
 */
import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { runHeartbeatScheduler } from "@/lib/orchestration/heartbeat-scheduler";
import { executeHeartbeatRun } from "@/lib/orchestration/heartbeat-executor";
import { prisma } from "@/lib/prisma";
import { jsonError, serverError, serviceUnavailable } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: (msg: string, data?: Record<string, unknown>) => {
    console.error(`[heartbeat-cron] ${msg}`, data);
  },
};

/**
 * In-process fetchImpl that intercepts heartbeat/execute calls and runs
 * the executor directly. Avoids the localhost HTTP roundtrip in serverless.
 */
const inProcessFetch: typeof fetch = async (url, init) => {
  const urlStr = typeof url === "string" ? url : url.toString();
  if (!urlStr.includes("/api/orchestration/heartbeat/execute")) {
    return fetch(url, init);
  }
  try {
    const body = JSON.parse((init?.body as string) ?? "{}");
    const result = await executeHeartbeatRun({
      runId: body.runId,
      agentId: body.agentId,
      workspaceId: body.workspaceId,
      wakeupRequestId: body.wakeupRequestId,
      invocationSource: "cron",
      task: body.task,
    });
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

async function handleRun(request: NextRequest): Promise<NextResponse> {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (isProduction && !cronSecret) {
      return NextResponse.json(
        {
          error: "AUTH_NOT_CONFIGURED",
          message: "CRON_SECRET environment variable is required in production",
        },
        { status: 500 }
      );
    }

    const authResult = await authorizeRequest(request, {
      apiKey: cronSecret,
      permission: "RUN_SCHEDULED_DIGESTS",
      requireApiKey: true,
      workspaceId: "executive",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();
    if (!runtimeState.databaseConfigured) {
      return serviceUnavailable(
        "DATABASE_URL is not configured for live mode.",
        "DATABASE_UNAVAILABLE",
        { dataMode: runtimeState.dataMode }
      );
    }

    const startTime = Date.now();
    const result = await runHeartbeatScheduler(
      {
        prisma,
        logger: noopLogger,
        fetchImpl: inProcessFetch,
      },
      {
        batchSize: Number(process.env.HEARTBEAT_BATCH_SIZE ?? 5),
      }
    );
    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      ok: true,
      durationMs,
      ...result,
    });
  } catch (error) {
    return serverError(error, "Failed to run heartbeat cycle.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleRun(request);
}

// Vercel Cron uses GET requests (with Authorization: Bearer ${CRON_SECRET})
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleRun(request);
}
