/**
 * Approval Detail API — Get, Review (approve/reject)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  WORK_REPORT_APPROVAL_ENTITY_TYPE,
  ensureApprovalActorUser,
} from "@/lib/approvals/work-report-approval";
import { advanceWorkflowRun } from "@/lib/orchestration/workflow-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await context.params;

  const approval = await prisma.approval.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { id: true, name: true, email: true, image: true } },
      reviewedBy: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  if (!approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  return NextResponse.json({
    approval: {
      ...approval,
      metadata: approval.metadata ? JSON.parse(approval.metadata) : null,
    },
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "RUN_AI_ACTIONS" });
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await context.params;
  const body = await request.json();
  const { action, comment } = body;

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  const existing = await prisma.approval.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  if (existing.entityType === WORK_REPORT_APPROVAL_ENTITY_TYPE) {
    let canonicalPath = existing.entityId ? `/work-reports?reportId=${existing.entityId}#review-workspace` : "/work-reports";

    try {
      const parsedMetadata = existing.metadata ? JSON.parse(existing.metadata) : null;
      if (parsedMetadata && typeof parsedMetadata.canonicalPath === "string") {
        canonicalPath = parsedMetadata.canonicalPath;
      }
    } catch {
      // Keep the stable fallback path.
    }

    return NextResponse.json(
      {
        error: {
          canonicalPath,
          message:
            "Work report approvals are reviewed in the dedicated work-report review workspace.",
        },
      },
      { status: 409 }
    );
  }

  if (existing.status !== "pending") {
    return NextResponse.json(
      { error: `Approval already ${existing.status}` },
      { status: 409 },
    );
  }

  const reviewedById = await ensureApprovalActorUser(
    authResult.accessProfile.userId,
    authResult.accessProfile.name
  );

  const approval = await prisma.approval.update({
    where: { id },
    data: {
      status: action === "approve" ? "approved" : "rejected",
      reviewedById,
      comment: comment ?? null,
      reviewedAt: new Date(),
    },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
  });

  if (approval.entityType === "orchestration_workflow_run" && approval.metadata) {
    try {
      const metadata = JSON.parse(approval.metadata) as { workflowRunId?: string };
      if (typeof metadata.workflowRunId === "string" && metadata.workflowRunId) {
        await advanceWorkflowRun(metadata.workflowRunId);
      }
    } catch {
      // Keep approval review successful even if metadata parsing fails.
    }
  }

  return NextResponse.json({
    approval: {
      ...approval,
      metadata: approval.metadata ? JSON.parse(approval.metadata) : null,
    },
  });
}
