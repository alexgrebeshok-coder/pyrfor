import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  createCutoverDecision,
  listCutoverDecisionRegister,
} from "@/lib/cutover-decisions";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  badRequest,
  databaseUnavailable,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { createCutoverDecisionSchema } from "@/lib/validators/cutover-decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_CONNECTORS",
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

    const register = await listCutoverDecisionRegister();
    return NextResponse.json(register);
  } catch (error) {
    return serverError(error, "Failed to load cutover decision register.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_CONNECTORS",
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

    const parsed = await validateBody(request, createCutoverDecisionSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const decision = await createCutoverDecision(parsed, {
      accessProfile: authResult.accessProfile,
    });

    return NextResponse.json(decision, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      (/warningLabel is required/i.test(error.message) ||
        /Cutover approval is blocked/i.test(error.message))
    ) {
      return badRequest(error.message, "CUTOVER_DECISION_REJECTED");
    }

    return serverError(error, "Failed to create cutover decision.");
  }
}
