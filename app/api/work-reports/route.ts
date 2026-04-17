import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { syncWorkReportApprovalRecord } from "@/lib/approvals/work-report-approval";
import { mapAIPMOBotWorkReportToCreateInput } from "@/lib/work-reports/mapper";
import { syncWorkReportEvidenceRecord } from "@/lib/evidence";
import { readJsonBody } from "@/lib/server/api-validation";
import {
  createWorkReport,
  listWorkReports,
  normalizeWorkReportStatus,
} from "@/lib/work-reports/service";
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
import {
  createWorkReportSchema,
  legacyAIPMOBotWorkReportSchema,
} from "@/lib/validators/work-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
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

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : undefined;

    if (limitParam && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
      return badRequest('Query parameter "limit" must be a positive number.');
    }

    const reports = await listWorkReports({
      projectId: searchParams.get("projectId") || undefined,
      authorId: searchParams.get("authorId") || undefined,
      status: normalizeWorkReportStatus(searchParams.get("status")),
      reportDate: searchParams.get("reportDate") || undefined,
      limit,
    });

    return NextResponse.json(reports);
  } catch (error) {
    return serverError(error, "Failed to fetch work reports.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

    const body = await readJsonBody(request);
    if (body instanceof NextResponse) {
      return body;
    }

    const payload =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    if ("project_name" in payload) {
      const authorId =
        typeof payload.authorId === "string" && payload.authorId.trim() ? payload.authorId.trim() : "";
      const projectId =
        typeof payload.projectId === "string" && payload.projectId.trim() ? payload.projectId.trim() : "";

      if (!authorId || !projectId) {
        return badRequest(
          "Legacy AI-PMO bot payloads require projectId and authorId to map into CEOClaw."
        );
      }

      const parsedLegacy = legacyAIPMOBotWorkReportSchema.safeParse(payload);
      if (!parsedLegacy.success) {
        return validationError(parsedLegacy.error);
      }

      const report = await createWorkReport(
        mapAIPMOBotWorkReportToCreateInput(parsedLegacy.data, {
          projectId,
          authorId,
        })
      );
      await syncWorkReportApprovalRecord(report, {
        requestedByName: authResult.accessProfile.name,
        requestedByUserId: authResult.accessProfile.userId,
      });
      void syncWorkReportEvidenceRecord(report).catch((error) => {
        console.error("Failed to sync work-report evidence after legacy create.", error);
      });

      return NextResponse.json(report, { status: 201 });
    }

    const parsed = createWorkReportSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const report = await createWorkReport(parsed.data);
    await syncWorkReportApprovalRecord(report, {
      requestedByName: authResult.accessProfile.name,
      requestedByUserId: authResult.accessProfile.userId,
    });
    void syncWorkReportEvidenceRecord(report).catch((error) => {
      console.error("Failed to sync work-report evidence after create.", error);
    });
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /not found/u.test(error.message)) {
      return badRequest(error.message, "RELATION_NOT_FOUND");
    }

    return serverError(error, "Failed to create work report.");
  }
}
