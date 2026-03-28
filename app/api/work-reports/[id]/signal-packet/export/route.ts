import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { exportWorkReportSignalPacket } from "@/lib/work-reports/packet-export";
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

    const body = await request.json();
    const parsed = workReportSignalPacketExportSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { id } = await context.params;
    if (parsed.data.packet.reportId !== id) {
      return badRequest("Packet reportId does not match the requested work report.", "PACKET_REPORT_MISMATCH");
    }

    const artifact = exportWorkReportSignalPacket(parsed.data.packet, parsed.data.format);

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
