import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { listWorkflowRuns } from "@/lib/orchestration/workflow-service";

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "executive";
    const status = req.nextUrl.searchParams.get("status") ?? undefined;
    const templateId = req.nextUrl.searchParams.get("templateId") ?? undefined;
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "20"), 100);

    const runs = await listWorkflowRuns(workspaceId, {
      status: status as never,
      templateId,
      limit,
    });

    return NextResponse.json({ runs });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to list workflow runs") },
      { status: 500 }
    );
  }
}
