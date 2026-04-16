/**
 * Org Chart API — tree view of agent hierarchy
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getOrgChart } from "@/lib/orchestration/agent-service";

// GET /api/orchestration/org-chart
export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const workspaceId =
      req.nextUrl.searchParams.get("workspaceId") ?? "executive";

    const tree = await getOrgChart(workspaceId);
    return NextResponse.json({ tree });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
