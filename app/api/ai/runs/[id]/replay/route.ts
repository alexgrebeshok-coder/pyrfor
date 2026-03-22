import { NextResponse } from "next/server";

import { isAIUnavailableError, replayServerAIRun } from "@/lib/ai/server-runs";
import { notFound, serverError, serviceUnavailable } from "@/lib/server/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const run = await replayServerAIRun(id);
    return NextResponse.json(run);
  } catch (error) {
    if (isAIUnavailableError(error)) {
      return serviceUnavailable(error.message, "AI_UNAVAILABLE");
    }

    if (error instanceof Error && /not found/i.test(error.message)) {
      return notFound(error.message, "AI_RUN_NOT_FOUND");
    }

    return serverError(error, "Failed to replay AI run.", "AI_RUN_REPLAY_FAILED");
  }
}
