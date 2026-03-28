import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { listBriefDeliveryLedger } from "@/lib/briefs/delivery-ledger";
import {
  badRequest,
  liveOperatorDataUnavailable,
  serverError,
  validationError,
} from "@/lib/server/api-utils";
import {
  getLiveOperatorDataBlockReason,
  getServerRuntimeState,
} from "@/lib/server/runtime-mode";
import { workReportSignalPacketDeliveryHistorySchema } from "@/lib/validators/work-report-signal-packet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
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

    const body = await request.json();
    const parsed = workReportSignalPacketDeliveryHistorySchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { id } = await context.params;
    if (parsed.data.packet.reportId !== id) {
      return badRequest(
        "Packet reportId does not match the requested work report.",
        "PACKET_REPORT_MISMATCH"
      );
    }

    const history = await listBriefDeliveryLedger({
      limit: parsed.data.limit ?? 6,
      projectId: parsed.data.packet.projectId,
      scope: "work_report",
    });

    return NextResponse.json({ history });
  } catch (error) {
    return serverError(
      error,
      "Failed to load work report delivery history.",
      "WORK_REPORT_SIGNAL_PACKET_DELIVERY_HISTORY_FAILED"
    );
  }
}
