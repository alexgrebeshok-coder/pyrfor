import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  createPilotReviewDeliveryPolicy,
  listPilotReviewDeliveryHistory,
  listPilotReviewDeliveryPolicies,
} from "@/lib/pilot-review";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { pilotReviewDeliveryPolicyCreateSchema } from "@/lib/validators/pilot-review-delivery-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
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

    const [policies, history] = await Promise.all([
      listPilotReviewDeliveryPolicies(),
      listPilotReviewDeliveryHistory(),
    ]);

    return NextResponse.json({ history, policies });
  } catch (error) {
    return serverError(error, "Failed to load pilot review delivery policies.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

    const parsed = await validateBody(request, pilotReviewDeliveryPolicyCreateSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const policy = await createPilotReviewDeliveryPolicy({
      ...parsed,
      createdByUserId: authResult.accessProfile.userId,
    });

    return NextResponse.json(policy, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to create pilot review delivery policy.");
  }
}
