import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { advanceWorkflowRun } from "@/lib/orchestration/workflow-service";
import { getErrorMessage } from "@/lib/orchestration/error-utils";

type Params = { params: Promise<{ runId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { runId } = await params;
    const run = await advanceWorkflowRun(runId);
    return NextResponse.json({ run });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to advance workflow run") },
      { status: 500 }
    );
  }
}
