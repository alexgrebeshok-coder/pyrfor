import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { syncWorkReportApprovalRecord } from "@/lib/approvals/work-report-approval";
import { removeEvidenceRecordForEntity } from "@/lib/evidence";
import { rejectWorkReport } from "@/lib/work-reports/service";
import {
  badRequest,
  liveOperatorDataUnavailable,
  notFound,
  serverError,
  validationError,
} from "@/lib/server/api-utils";
import {
  getLiveOperatorDataBlockReason,
  getServerRuntimeState,
} from "@/lib/server/runtime-mode";
import { rejectWorkReportSchema } from "@/lib/validators/work-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
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
    const parsed = rejectWorkReportSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { id } = await params;
    const report = await rejectWorkReport(id, {
      reviewerId: parsed.data.reviewerId,
      reviewComment: parsed.data.reviewComment!.trim(),
    });
    await syncWorkReportApprovalRecord(report, {
      requestedByName: authResult.accessProfile.name,
      requestedByUserId: authResult.accessProfile.userId,
      reviewedByName: authResult.accessProfile.name,
      reviewedByUserId: authResult.accessProfile.userId,
    });
    void removeEvidenceRecordForEntity("work_report", report.id).catch((error) => {
      console.error("Failed to remove work-report evidence after rejection.", error);
    });
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof Error && /Reviewer not found/u.test(error.message)) {
      return badRequest(error.message, "RELATION_NOT_FOUND");
    }

    if (error instanceof Error && /Record to update not found/u.test(error.message)) {
      return notFound("Work report not found");
    }

    return serverError(error, "Failed to reject work report.");
  }
}
