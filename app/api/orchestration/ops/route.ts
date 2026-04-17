import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { getOrchestrationOpsSnapshot } from "@/lib/orchestration/ops-service";

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "executive";
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "8"), 24);

    const snapshot = await getOrchestrationOpsSnapshot(workspaceId, limit);
    return NextResponse.json(snapshot);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load orchestration operations snapshot") },
      { status: 500 }
    );
  }
}
