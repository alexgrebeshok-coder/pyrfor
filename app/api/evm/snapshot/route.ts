import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { saveEvmSnapshot } from "@/lib/evm/snapshot-service";
import {
  badRequest,
  databaseUnavailable,
  parseDateInput,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  try {
    const body = (await request.json()) as { projectId?: string; snapshotDate?: string };
    const projectId = body.projectId?.trim();

    if (!projectId) {
      return badRequest("projectId is required");
    }

    const parsedDate = parseDateInput(body.snapshotDate);
    const result = await saveEvmSnapshot(projectId, parsedDate ?? new Date());

    return NextResponse.json({
      projectId,
      snapshot: result.snapshot,
      metrics: result.payload.metrics,
      source: result.payload.source,
    });
  } catch (error) {
    return serverError(error, "Failed to save EVM snapshot.");
  }
}
