import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { buildProjectGanttSnapshot } from "@/lib/scheduling/gantt-payload";
import {
  badRequest,
  databaseUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * GET /api/gantt/dependencies — Dependencies for Gantt chart
 * 
 * Returns task dependencies with positions for rendering lines
 */

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();
    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId")?.trim() || null;

    if (!projectId) {
      return badRequest("projectId is required");
    }

    const snapshot = await buildProjectGanttSnapshot(projectId);
    if (!snapshot) {
      return notFound("Project not found");
    }

    return NextResponse.json(snapshot.dependencies);
  } catch (error) {
    console.error("[Gantt Dependencies API] Error:", error);
    return serverError(error, "Failed to fetch gantt dependencies.");
  }
}
