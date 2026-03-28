import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { syncOneCExpenses } from "@/lib/connectors/one-c-expense-sync";
import { broadcastSSE } from "@/lib/sse";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (isProduction && !cronSecret) {
      return NextResponse.json(
        {
          error: "AUTH_NOT_CONFIGURED",
          message: "CRON_SECRET environment variable is required in production",
        },
        { status: 500 }
      );
    }

    const authResult = await authorizeRequest(request, {
      apiKey: cronSecret,
      permission: "MANAGE_IMPORTS",
      requireApiKey: true,
      workspaceId: "executive",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();
    if (!runtimeState.databaseConfigured) {
      return databaseUnavailable(runtimeState.dataMode);
    }

    const result = await syncOneCExpenses();
    broadcastSSE("expenses_synced", {
      source: "one-c",
      trigger: "cron",
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      checkedAt: result.checkedAt,
    });

    return NextResponse.json({
      success: true,
      source: "one-c",
      trigger: "cron",
      ...result,
    });
  } catch (error) {
    return serverError(error, "Failed to run scheduled 1C expense sync.");
  }
}
