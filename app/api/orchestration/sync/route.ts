/**
 * Sync agent definitions from code → DB
 * POST /api/orchestration/sync — seeds agents from agents.ts into workspace
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { syncAgentDefinitions } from "@/lib/orchestration/agent-service";
import { getErrorMessage } from "@/lib/orchestration/error-utils";

export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json().catch(() => ({}));
    const workspaceId = body.workspaceId ?? "executive";

    const result = await syncAgentDefinitions(workspaceId);
    return NextResponse.json({
      message: `Synced ${result.created} agent definitions to workspace`,
      ...result,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to sync agents") }, { status: 500 });
  }
}
