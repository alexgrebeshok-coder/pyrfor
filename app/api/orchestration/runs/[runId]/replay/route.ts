import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { queueHeartbeatRunReplay } from "@/lib/orchestration/checkpoint-service";
import { getErrorMessage } from "@/lib/orchestration/error-utils";

type Params = { params: Promise<{ runId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { runId } = await params;
    const body = await req.json().catch(() => ({}));
    const replay = await queueHeartbeatRunReplay({
      runId,
      checkpointId:
        typeof body.checkpointId === "string" && body.checkpointId.trim()
          ? body.checkpointId
          : undefined,
      requestedBy: authResult.accessProfile.userId,
    });

    return NextResponse.json(
      {
        replayRunId: replay.replayRunId,
        replayOfRunId: replay.replayOfRunId,
        replayReason: replay.replayReason,
        replayedFromCheckpointId: replay.replayedFromCheckpointId,
      },
      { status: 202 }
    );
  } catch (error: unknown) {
    const message = getErrorMessage(error, "Failed to queue replay");
    return NextResponse.json(
      { error: message },
      { status: message === "Run not found" || message === "Checkpoint not found" ? 404 : 500 }
    );
  }
}
