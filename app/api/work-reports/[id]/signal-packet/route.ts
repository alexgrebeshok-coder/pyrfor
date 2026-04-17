import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { isAIUnavailableError } from "@/lib/ai/server-runs";
import { syncEscalationQueue } from "@/lib/escalations";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import { createWorkReportSignalPacket } from "@/lib/work-reports/signal-packet";
import {
  badRequest,
  liveOperatorDataUnavailable,
  notFound,
  serverError,
  serviceUnavailable,
} from "@/lib/server/api-utils";
import {
  getLiveOperatorDataBlockReason,
  getServerRuntimeState,
} from "@/lib/server/runtime-mode";
import { workReportSignalPacketSchema } from "@/lib/validators/work-report-signal-packet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const authResult = await authorizeRequest(request, {
    permission: "REVIEW_WORK_REPORTS",
    workspaceId: "delivery",
  });

  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtimeState = getServerRuntimeState();
  if (getLiveOperatorDataBlockReason(runtimeState)) {
    return liveOperatorDataUnavailable(runtimeState);
  }

  const { id } = await context.params;
  if (!id) {
    return badRequest("Work report id is required.", "WORK_REPORT_ID_REQUIRED");
  }

  try {
    const parsed = await validateBody(request, workReportSignalPacketSchema, {
      emptyValue: {},
      invalidJsonCode: "INVALID_JSON",
      invalidJsonMessage: "Request body must be valid JSON.",
    });
    if (isValidationError(parsed)) {
      return parsed;
    }

    const packet = await createWorkReportSignalPacket(id, parsed);
    void syncEscalationQueue().catch((error) => {
      console.error("Failed to sync escalation queue after signal packet creation.", error);
    });
    return NextResponse.json(packet, { status: 201 });
  } catch (error) {
    if (isAIUnavailableError(error)) {
      return serviceUnavailable(error.message, "AI_UNAVAILABLE");
    }

    if (error instanceof Error && /not found/i.test(error.message)) {
      return notFound(error.message, "WORK_REPORT_NOT_FOUND");
    }

    if (error instanceof Error && /approved work reports/i.test(error.message)) {
      return badRequest(error.message, "WORK_REPORT_REVIEW_REQUIRED");
    }

    return serverError(
      error,
      "Failed to create work report signal packet.",
      "WORK_REPORT_SIGNAL_PACKET_FAILED"
    );
  }
}
