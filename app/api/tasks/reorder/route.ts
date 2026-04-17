import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  normalizeTaskStatus,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { reorderTasksSchema } from "@/lib/validators/task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Authentication check
    const authResult = await authorizeRequest(request, {
      permission: "MANAGE_TASKS",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const parsed = await validateBody(request, reorderTasksSchema);
    const runtime = getServerRuntimeState();

    if (isValidationError(parsed)) {
      return parsed;
    }

    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const updates = Object.entries(parsed.columns).flatMap(([statusKey, taskIds]) => {
      const status = normalizeTaskStatus(statusKey);
      if (!status || !Array.isArray(taskIds)) return [];

      return taskIds.map((taskId, index) =>
        prisma.task.update({
          where: { id: taskId },
          data: {
            status,
            order: index,
            updatedAt: new Date(),
          },
        })
      );
    });

    await prisma.$transaction(updates);

    return NextResponse.json({
      reordered: true,
      count: updates.length,
    });
  } catch (error) {
    return serverError(error, "Failed to reorder tasks.");
  }
}
