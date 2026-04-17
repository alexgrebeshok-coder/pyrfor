import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { updatePilotReviewDeliveryPolicy } from "@/lib/pilot-review";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { pilotReviewDeliveryPolicyUpdateSchema } from "@/lib/validators/pilot-review-delivery-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "SEND_EMAIL_DIGESTS",
    workspaceId: "executive",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtimeState = getServerRuntimeState();
    if (!runtimeState.databaseConfigured) {
      return databaseUnavailable(runtimeState.dataMode);
    }

    const parsed = await validateBody(request, pilotReviewDeliveryPolicyUpdateSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const { id } = await context.params;
    const policy = await updatePilotReviewDeliveryPolicy(id, {
      ...parsed,
      updatedByUserId: authResult.accessProfile.userId,
    });

    return NextResponse.json(policy);
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) {
      return notFound(error.message, "PILOT_REVIEW_POLICY_NOT_FOUND");
    }

    return serverError(error, "Failed to update pilot review delivery policy.");
  }
}
