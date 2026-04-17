import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { runDuePilotReviewDeliveryPolicies } from "@/lib/pilot-review";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  jsonError,
  serverError,
} from "@/lib/server/api-utils";
import { evaluatePilotWorkflowAccess } from "@/lib/server/pilot-controls";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { pilotReviewDeliveryRunSchema } from "@/lib/validators/pilot-review-delivery-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
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
      permission: "RUN_SCHEDULED_DIGESTS",
      requireApiKey: true, // Always require API key for cron endpoints
      workspaceId: "executive",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();
    if (!runtimeState.databaseConfigured) {
      return databaseUnavailable(runtimeState.dataMode);
    }

    const parsed = await validateBody(request, pilotReviewDeliveryRunSchema, {
      emptyValue: {},
      invalidJsonCode: "INVALID_JSON",
      invalidJsonMessage: "Request body must be valid JSON.",
    });
    if (isValidationError(parsed)) {
      return parsed;
    }

    const pilotAccess = evaluatePilotWorkflowAccess({
      accessProfile: authResult.accessProfile,
      dryRun: parsed.dryRun,
      runtime: runtimeState,
      workflow: "scheduled_delivery",
    });
    if (!pilotAccess.allowed) {
      return jsonError(
        403,
        pilotAccess.code ?? "PILOT_STAGE_BLOCKED",
        pilotAccess.message ?? "Scheduled governance review delivery is blocked by pilot controls."
      );
    }

    const result = await runDuePilotReviewDeliveryPolicies({
      accessProfile: authResult.accessProfile,
      dryRun: parsed.dryRun,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && /SMTP is not configured/i.test(error.message)) {
      return jsonError(503, "EMAIL_NOT_CONFIGURED", error.message);
    }

    if (error instanceof Error && /Email recipient is required/i.test(error.message)) {
      return jsonError(400, "EMAIL_RECIPIENT_REQUIRED", error.message);
    }

    if (error instanceof Error && /SMTP delivery failed/i.test(error.message)) {
      return jsonError(502, "EMAIL_DELIVERY_FAILED", error.message);
    }

    return serverError(error, "Failed to run cron pilot review deliveries.");
  }
}
