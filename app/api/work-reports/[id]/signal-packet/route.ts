import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { isAIUnavailableError } from "@/lib/ai/server-runs";
import { syncEscalationQueue } from "@/lib/escalations";
import { createWorkReportSignalPacket } from "@/lib/work-reports/signal-packet";
import {
  badRequest,
  liveOperatorDataUnavailable,
  notFound,
  serverError,
  serviceUnavailable,
  validationError,
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
    const rawBody = await request.text();
    let body: unknown = {};

    if (rawBody) {
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        return badRequest("Request body must be valid JSON.", "INVALID_JSON");
      }
    }

    const parsed = workReportSignalPacketSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const packet = await createWorkReportSignalPacket(id, parsed.data);
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

    if (error instanceof Error && /rejected work reports/i.test(error.message)) {
      return badRequest(error.message, "WORK_REPORT_REJECTED");
    }

    return serverError(
      error,
      "Failed to create work report signal packet.",
      "WORK_REPORT_SIGNAL_PACKET_FAILED"
    );
  }
}
