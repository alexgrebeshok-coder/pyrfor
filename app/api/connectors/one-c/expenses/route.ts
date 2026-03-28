import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  getOneCExpenseSyncPreview,
  syncOneCExpenses,
} from "@/lib/connectors/one-c-expense-sync";
import { broadcastSSE } from "@/lib/sse";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_CONNECTORS",
    workspaceId: "executive",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtimeState = getServerRuntimeState();
  if (!runtimeState.databaseConfigured) {
    return databaseUnavailable(runtimeState.dataMode);
  }

  try {
    const preview = await getOneCExpenseSyncPreview();
    return NextResponse.json(preview);
  } catch (error) {
    return serverError(error, "Failed to build 1C expense sync preview.");
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "MANAGE_IMPORTS",
    workspaceId: "executive",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtimeState = getServerRuntimeState();
  if (!runtimeState.databaseConfigured) {
    return databaseUnavailable(runtimeState.dataMode);
  }

  try {
    const result = await syncOneCExpenses();
    broadcastSSE("expenses_synced", {
      source: "one-c",
      trigger: "manual",
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      checkedAt: result.checkedAt,
    });
    return NextResponse.json(result);
  } catch (error) {
    return serverError(error, "Failed to sync 1C expenses.");
  }
}
