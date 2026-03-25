import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { calculateCriticalPath } from "@/lib/scheduling/critical-path";
import { getProjectSchedulingContext, serializeCriticalPath } from "@/lib/scheduling/service";
import { badRequest, databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  try {
    const projectId = new URL(request.url).searchParams.get("projectId")?.trim();
    if (!projectId) {
      return badRequest("projectId is required");
    }

    const context = await getProjectSchedulingContext(projectId);
    if (!context) {
      return notFound("Project not found");
    }

    const result = calculateCriticalPath({
      tasks: context.tasks,
      dependencies: context.dependencies,
      projectStart: context.project.start,
      projectEnd: context.project.end,
    });

    return NextResponse.json(serializeCriticalPath(result));
  } catch (error) {
    return serverError(error, "Failed to calculate critical path.");
  }
}
