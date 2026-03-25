import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { listWorkspaceEvmSnapshots, getProjectEvmSnapshot } from "@/lib/evm/snapshot-service";
import { databaseUnavailable, parseDateInput, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim();
    const referenceDate = parseDateInput(searchParams.get("referenceDate")) ?? new Date();

    if (projectId) {
      const snapshot = await getProjectEvmSnapshot(projectId, referenceDate);
      return NextResponse.json(snapshot);
    }

    const portfolio = await listWorkspaceEvmSnapshots(
      authResult.accessProfile.workspaceId,
      referenceDate
    );
    return NextResponse.json(portfolio);
  } catch (error) {
    return serverError(error, "Failed to load EVM metrics.");
  }
}
