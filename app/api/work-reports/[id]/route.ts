import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  expirePendingWorkReportApprovals,
  syncWorkReportApprovalRecord,
} from "@/lib/approvals/work-report-approval";
import {
  removeEvidenceRecordForEntity,
  syncWorkReportEvidenceRecord,
} from "@/lib/evidence";
import {
  deleteWorkReport,
  getWorkReportById,
  updateWorkReport,
} from "@/lib/work-reports/service";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  liveOperatorDataUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import {
  getLiveOperatorDataBlockReason,
  getServerRuntimeState,
} from "@/lib/server/runtime-mode";
import { updateWorkReportSchema } from "@/lib/validators/work-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    const authResult = await authorizeRequest(request, {
      permission: "VIEW_WORK_REPORTS",
      workspaceId: "delivery",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();

    if (getLiveOperatorDataBlockReason(runtimeState)) {
      return liveOperatorDataUnavailable(runtimeState);
    }

    const { id } = await params;
    const report = await getWorkReportById(id);

    if (!report) {
      return notFound("Work report not found");
    }

    return NextResponse.json(report);
  } catch (error) {
    return serverError(error, "Failed to fetch work report.");
  }
}

export async function PUT(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    const authResult = await authorizeRequest(request, {
      permission: "CREATE_WORK_REPORTS",
      workspaceId: "delivery",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();

    if (getLiveOperatorDataBlockReason(runtimeState)) {
      return liveOperatorDataUnavailable(runtimeState);
    }

    const parsed = await validateBody(request, updateWorkReportSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const { id } = await params;
    const report = await updateWorkReport(id, parsed);
    await syncWorkReportApprovalRecord(report, {
      requestedByName: authResult.accessProfile.name,
      requestedByUserId: authResult.accessProfile.userId,
    });
    void syncWorkReportEvidenceRecord(report).catch((error) => {
      console.error("Failed to sync work-report evidence after update.", error);
    });
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof Error && /Work report not found/u.test(error.message)) {
      return notFound("Work report not found");
    }

    return serverError(error, "Failed to update work report.");
  }
}

export async function DELETE(
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

    const { id } = await params;
    await deleteWorkReport(id);
    await expirePendingWorkReportApprovals(id, {
      reviewedByName: authResult.accessProfile.name,
      reviewedByUserId: authResult.accessProfile.userId,
    });
    void removeEvidenceRecordForEntity("work_report", id).catch((error) => {
      console.error("Failed to remove work-report evidence after delete.", error);
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof Error && /Record to delete does not exist/u.test(error.message)) {
      return notFound("Work report not found");
    }

    return serverError(error, "Failed to delete work report.");
  }
}
