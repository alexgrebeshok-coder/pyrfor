import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { updatePilotFeedback } from "@/lib/pilot-feedback";
import {
  isValidationError,
  requiredJsonBodyOptions,
  validateBody,
} from "@/lib/server/api-validation";
import {
  badRequest,
  liveOperatorDataUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import {
  getLiveOperatorDataBlockReason,
  getServerRuntimeState,
} from "@/lib/server/runtime-mode";
import { pilotFeedbackUpdateSchema } from "@/lib/validators/pilot-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_CONNECTORS",
    workspaceId: "executive",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtimeState = getServerRuntimeState();
  if (getLiveOperatorDataBlockReason(runtimeState)) {
    return liveOperatorDataUnavailable(runtimeState);
  }

  const { id } = await params;
  if (!id) {
    return badRequest("Pilot feedback id is required.", "PILOT_FEEDBACK_ID_REQUIRED");
  }

  try {
    const parsed = await validateBody(
      request,
      pilotFeedbackUpdateSchema,
      requiredJsonBodyOptions
    );
    if (isValidationError(parsed)) {
      return parsed;
    }

    const updated = await updatePilotFeedback(id, parsed);
    if (!updated) {
      return notFound(`Pilot feedback ${id} was not found.`, "PILOT_FEEDBACK_NOT_FOUND");
    }

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof Error && /owner .* was not found/i.test(error.message)) {
      return badRequest(error.message, "PILOT_FEEDBACK_OWNER_NOT_FOUND");
    }

    return serverError(error, "Failed to update pilot feedback.", "PILOT_FEEDBACK_UPDATE_FAILED");
  }
}
