import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { runDueWelcomeSequenceEmails } from "@/lib/retention";
import { jsonError, serverError, serviceUnavailable } from "@/lib/server/api-utils";
import { evaluatePilotWorkflowAccess } from "@/lib/server/pilot-controls";
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
      permission: "RUN_SCHEDULED_DIGESTS",
      requireApiKey: true,
      workspaceId: "executive",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();
    if (!runtimeState.databaseConfigured) {
      return serviceUnavailable(
        "DATABASE_URL is not configured for live mode.",
        "DATABASE_UNAVAILABLE",
        { dataMode: runtimeState.dataMode }
      );
    }

    const pilotAccess = evaluatePilotWorkflowAccess({
      accessProfile: authResult.accessProfile,
      runtime: runtimeState,
      workflow: "scheduled_delivery",
    });
    if (!pilotAccess.allowed) {
      return jsonError(
        403,
        pilotAccess.code ?? "PILOT_STAGE_BLOCKED",
        pilotAccess.message ?? "Scheduled digest execution is blocked by pilot controls."
      );
    }

    const result = await runDueWelcomeSequenceEmails({ now: new Date() });
    return NextResponse.json(result);
  } catch (error) {
    return serverError(error, "Failed to run the welcome email sequence.");
  }
}
