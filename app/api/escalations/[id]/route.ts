import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  getEscalationItemById,
  updateEscalationItem,
} from "@/lib/escalations";
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
import { escalationUpdateSchema } from "@/lib/validators/escalations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_WORK_REPORTS",
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
    return badRequest("Escalation id is required.", "ESCALATION_ID_REQUIRED");
  }

  try {
    const item = await getEscalationItemById(id);
    if (!item) {
      return notFound(`Escalation ${id} was not found.`, "ESCALATION_NOT_FOUND");
    }

    return NextResponse.json(item);
  } catch (error) {
    return serverError(error, "Failed to load escalation item.", "ESCALATION_ITEM_FAILED");
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "REVIEW_WORK_REPORTS",
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
    return badRequest("Escalation id is required.", "ESCALATION_ID_REQUIRED");
  }

  try {
    const parsed = await validateBody(
      request,
      escalationUpdateSchema,
      requiredJsonBodyOptions
    );
    if (isValidationError(parsed)) {
      return parsed;
    }

    const item = await updateEscalationItem(id, parsed);
    if (!item) {
      return notFound(`Escalation ${id} was not found.`, "ESCALATION_NOT_FOUND");
    }

    return NextResponse.json(item);
  } catch (error) {
    if (error instanceof Error && /owner .* was not found/i.test(error.message)) {
      return badRequest(error.message, "ESCALATION_OWNER_NOT_FOUND");
    }

    if (error instanceof Error && /cannot be reopened manually/i.test(error.message)) {
      return badRequest(error.message, "ESCALATION_REOPEN_FORBIDDEN");
    }

    return serverError(error, "Failed to update escalation item.", "ESCALATION_UPDATE_FAILED");
  }
}
