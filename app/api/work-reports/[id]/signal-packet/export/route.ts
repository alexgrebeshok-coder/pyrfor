import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { exportWorkReportSignalPacket } from "@/lib/work-reports/packet-export";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  badRequest,
  liveOperatorDataUnavailable,
  serverError,
} from "@/lib/server/api-utils";
import {
  getLiveOperatorDataBlockReason,
  getServerRuntimeState,
} from "@/lib/server/runtime-mode";
import { workReportSignalPacketExportSchema } from "@/lib/validators/work-report-signal-packet";

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

    const parsed = await validateBody(request, workReportSignalPacketExportSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const { id } = await context.params;
    if (parsed.packet.reportId !== id) {
      return badRequest("Packet reportId does not match the requested work report.", "PACKET_REPORT_MISMATCH");
    }

    const artifact = exportWorkReportSignalPacket(parsed.packet, parsed.format);

    return new NextResponse(artifact.content, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
        "Content-Type": artifact.contentType,
      },
    });
  } catch (error) {
    return serverError(
      error,
      "Failed to export work report signal packet.",
      "WORK_REPORT_SIGNAL_PACKET_EXPORT_FAILED"
    );
  }
}
