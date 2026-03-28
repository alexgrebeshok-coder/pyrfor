import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getEvmHistory } from "@/lib/evm/snapshot-service";
import {
  badRequest,
  databaseUnavailable,
  parseDateInput,
  serverError,
} from "@/lib/server/api-utils";
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

    if (!projectId) {
      return badRequest("projectId is required");
    }

    const fromDate = parseDateInput(searchParams.get("from"));
    const toDate = parseDateInput(searchParams.get("to"));
    const history = await getEvmHistory(projectId, { fromDate, toDate });

    return NextResponse.json({
      projectId,
      fromDate: (fromDate ?? history[0]?.date ?? null)?.toISOString?.() ?? null,
      toDate: (toDate ?? history[history.length - 1]?.date ?? null)?.toISOString?.() ?? null,
      snapshots: history,
    });
  } catch (error) {
    return serverError(error, "Failed to load EVM history.");
  }
}
