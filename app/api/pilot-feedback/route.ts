import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { createPilotFeedback, listPilotFeedback } from "@/lib/pilot-feedback";
import {
  isValidationError,
  requiredJsonBodyOptions,
  validateBody,
} from "@/lib/server/api-validation";
import {
  badRequest,
  liveOperatorDataUnavailable,
  parseOptionalInteger,
  serverError,
} from "@/lib/server/api-utils";
import {
  getLiveOperatorDataBlockReason,
  getServerRuntimeState,
} from "@/lib/server/runtime-mode";
import {
  pilotFeedbackCreateSchema,
  pilotFeedbackStatusSchema,
  pilotFeedbackTargetTypeSchema,
} from "@/lib/validators/pilot-feedback";

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
  if (getLiveOperatorDataBlockReason(runtimeState)) {
    return liveOperatorDataUnavailable(runtimeState);
  }

  const limit = parseOptionalInteger(request.nextUrl.searchParams.get("limit")) ?? 24;
  const includeResolved = request.nextUrl.searchParams.get("includeResolved") === "true";
  const statusParam = request.nextUrl.searchParams.get("status");
  const targetTypeParam = request.nextUrl.searchParams.get("targetType");

  if (statusParam) {
    const parsedStatus = pilotFeedbackStatusSchema.safeParse(statusParam);
    if (!parsedStatus.success) {
      return badRequest("Invalid pilot feedback status filter.", "PILOT_FEEDBACK_STATUS_INVALID");
    }
  }

  if (targetTypeParam) {
    const parsedTargetType = pilotFeedbackTargetTypeSchema.safeParse(targetTypeParam);
    if (!parsedTargetType.success) {
      return badRequest(
        "Invalid pilot feedback target type filter.",
        "PILOT_FEEDBACK_TARGET_INVALID"
      );
    }
  }

  try {
    const result = await listPilotFeedback({
      includeResolved,
      limit,
      projectId: request.nextUrl.searchParams.get("projectId") ?? undefined,
      status: statusParam ? pilotFeedbackStatusSchema.parse(statusParam) : undefined,
      targetId: request.nextUrl.searchParams.get("targetId") ?? undefined,
      targetType: targetTypeParam
        ? pilotFeedbackTargetTypeSchema.parse(targetTypeParam)
        : undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    return serverError(error, "Failed to load pilot feedback.", "PILOT_FEEDBACK_LIST_FAILED");
  }
}

export async function POST(request: NextRequest) {
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

  try {
    const parsed = await validateBody(
      request,
      pilotFeedbackCreateSchema,
      requiredJsonBodyOptions
    );
    if (isValidationError(parsed)) {
      return parsed;
    }

    const created = await createPilotFeedback(parsed);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /owner .* was not found/i.test(error.message)) {
      return badRequest(error.message, "PILOT_FEEDBACK_OWNER_NOT_FOUND");
    }

    return serverError(error, "Failed to create pilot feedback.", "PILOT_FEEDBACK_CREATE_FAILED");
  }
}
