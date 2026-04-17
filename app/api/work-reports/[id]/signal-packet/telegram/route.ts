import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  badRequest,
  jsonError,
  liveOperatorDataUnavailable,
  serverError,
} from "@/lib/server/api-utils";
import { evaluatePilotWorkflowAccess } from "@/lib/server/pilot-controls";
import {
  getLiveOperatorDataBlockReason,
  getServerRuntimeState,
} from "@/lib/server/runtime-mode";
import { workReportSignalPacketTelegramDeliverySchema } from "@/lib/validators/work-report-signal-packet";
import { deliverWorkReportSignalPacketToTelegram } from "@/lib/work-reports/signal-packet-telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authorizeRequest(request, {
      permission: "SEND_TELEGRAM_DIGESTS",
      workspaceId: "delivery",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();
    if (getLiveOperatorDataBlockReason(runtimeState)) {
      return liveOperatorDataUnavailable(runtimeState);
    }

    const parsed = await validateBody(request, workReportSignalPacketTelegramDeliverySchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const pilotAccess = evaluatePilotWorkflowAccess({
      accessProfile: authResult.accessProfile,
      dryRun: parsed.dryRun,
      runtime: runtimeState,
      workflow: "work_report_delivery",
    });
    if (!pilotAccess.allowed) {
      return jsonError(
        403,
        pilotAccess.code ?? "PILOT_STAGE_BLOCKED",
        pilotAccess.message ?? "Work report delivery is blocked by pilot controls."
      );
    }

    const { id } = await context.params;
    if (parsed.packet.reportId !== id) {
      return badRequest(
        "Packet reportId does not match the requested work report.",
        "PACKET_REPORT_MISMATCH"
      );
    }

    const result = await deliverWorkReportSignalPacketToTelegram(parsed);
    return NextResponse.json(result, { status: parsed.dryRun ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && /chat id is required/i.test(error.message)) {
      return badRequest(error.message, "TELEGRAM_CHAT_ID_REQUIRED");
    }

    if (error instanceof Error && /TELEGRAM_BOT_TOKEN/i.test(error.message)) {
      return jsonError(503, "TELEGRAM_NOT_CONFIGURED", error.message);
    }

    if (error instanceof Error && /(sendMessage|Telegram API rejected)/i.test(error.message)) {
      return jsonError(502, "TELEGRAM_DELIVERY_FAILED", error.message);
    }

    return serverError(
      error,
      "Failed to deliver work report signal packet to Telegram.",
      "WORK_REPORT_SIGNAL_PACKET_TELEGRAM_FAILED"
    );
  }
}
