import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { checkDueDates } from "@/lib/notify";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

/**
 * POST /api/notifications/check-due-dates
 * Check for upcoming due dates and send notifications
 * 
 * This should be called by a cron job (e.g., every hour)
 * 
 * Example cron configuration:
 * 0 * * * * curl -X POST http://localhost:3000/api/notifications/check-due-dates
 */
export async function POST(request: NextRequest) {
  try {
    // P1-1: Fail closed for cron endpoints in production
    const cronSecret = process.env.CRON_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (isProduction && !cronSecret) {
      console.error("[CRON] CRON_SECRET is required in production but not configured");
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
      permission: "RUN_DUE_DATE_SCAN",
      requireApiKey: true, // Always require API key for cron endpoints
      workspaceId: "executive",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtime = getServerRuntimeState();

        if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const result = await checkDueDates();

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Check Due Dates API] Error:", error);
    return serverError(error, "Failed to check due dates");
  }
}
