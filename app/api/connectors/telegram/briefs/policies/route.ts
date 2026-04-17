import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  createTelegramBriefDeliveryPolicy,
  listTelegramBriefDeliveryPolicies,
} from "@/lib/briefs/telegram-delivery-policies";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  badRequest,
  databaseUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { telegramBriefDeliveryPolicyCreateSchema } from "@/lib/validators/telegram-brief-delivery-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "SEND_TELEGRAM_DIGESTS",
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

    const policies = await listTelegramBriefDeliveryPolicies();
    return NextResponse.json({ policies });
  } catch (error) {
    return serverError(error, "Failed to load Telegram brief delivery policies.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request, {
    permission: "SEND_TELEGRAM_DIGESTS",
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

    const parsed = await validateBody(request, telegramBriefDeliveryPolicyCreateSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const policy = await createTelegramBriefDeliveryPolicy({
      ...parsed,
      createdByUserId: authResult.accessProfile.userId,
    });

    return NextResponse.json(policy, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /project delivery policies/i.test(error.message)) {
      return badRequest(error.message, "PROJECT_ID_REQUIRED");
    }

    if (error instanceof Error && /Project not found/i.test(error.message)) {
      return notFound(error.message, "PROJECT_NOT_FOUND");
    }

    return serverError(error, "Failed to create Telegram brief delivery policy.");
  }
}
