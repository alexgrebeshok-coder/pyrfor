import { randomUUID } from "node:crypto";

import type { Approval } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { WorkReportView } from "@/lib/work-reports/types";

export const WORK_REPORT_APPROVAL_TYPE = "work_report_review";
export const WORK_REPORT_APPROVAL_ENTITY_TYPE = "work_report";

export interface WorkReportApprovalMetadata {
  actionSurface: "work_report_review_workspace";
  authorName: string;
  canonicalPath: string;
  projectId: string;
  projectName: string;
  reportDate: string;
  reportNumber: string;
  reportStatus: WorkReportView["status"];
  reviewComment: string | null;
  reviewedAt: string | null;
  reviewerId: string | null;
  reviewerName: string | null;
  section: string;
}

export interface WorkReportApprovalWriteInput {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  title: string;
  description: string | null;
  status: string;
  requestedById: string | null;
  reviewedById: string | null;
  comment: string | null;
  metadata: string;
  reviewedAt: Date | null;
  expiresAt: Date | null;
}

interface SyncWorkReportApprovalInput {
  requestedByName?: string | null;
  requestedByUserId?: string | null;
  reviewedByName?: string | null;
  reviewedByUserId?: string | null;
}

interface ApprovalActorDeps {
  now?: () => Date;
  upsertUser?: (input: { id: string; name: string | null }) => Promise<void>;
}

interface WorkReportApprovalDeps extends ApprovalActorDeps {
  createApproval?: (data: WorkReportApprovalWriteInput) => Promise<Approval>;
  createId?: () => string;
  ensureActorUser?: (
    userId: string | null | undefined,
    name?: string | null
  ) => Promise<string | null>;
  findLatestPendingApproval?: (reportId: string) => Promise<Approval | null>;
  updateApproval?: (id: string, data: Partial<WorkReportApprovalWriteInput>) => Promise<Approval>;
  updateManyPendingApprovals?: (
    reportId: string,
    data: Partial<WorkReportApprovalWriteInput>
  ) => Promise<number>;
}

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function truncateText(value: string, limit: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

export function buildWorkReportApprovalPath(reportId: string) {
  return `/work-reports?reportId=${encodeURIComponent(reportId)}#review-workspace`;
}

export async function ensureApprovalActorUser(
  userId: string | null | undefined,
  name?: string | null,
  deps: ApprovalActorDeps = {}
) {
  const normalizedUserId = normalizeOptionalString(userId);
  if (!normalizedUserId) {
    return null;
  }

  const normalizedName = normalizeOptionalString(name);
  const upsertUser =
    deps.upsertUser ??
    (async (input: { id: string; name: string | null }) => {
      await prisma.user.upsert({
        where: { id: input.id },
        update: input.name ? { name: input.name } : {},
        create: {
          id: input.id,
          ...(input.name ? { name: input.name } : {}),
          updatedAt: deps.now ? deps.now() : new Date(),
        },
      });
    });

  await upsertUser({
    id: normalizedUserId,
    name: normalizedName,
  });

  return normalizedUserId;
}

function buildWorkReportApprovalMetadata(report: WorkReportView): WorkReportApprovalMetadata {
  return {
    actionSurface: "work_report_review_workspace",
    authorName: report.author.name,
    canonicalPath: buildWorkReportApprovalPath(report.id),
    projectId: report.projectId,
    projectName: report.project.name,
    reportDate: report.reportDate,
    reportNumber: report.reportNumber,
    reportStatus: report.status,
    reviewComment: report.reviewComment,
    reviewedAt: report.reviewedAt,
    reviewerId: report.reviewerId,
    reviewerName: report.reviewer?.name ?? null,
    section: report.section,
  };
}

function buildWorkReportApprovalTitle(report: WorkReportView) {
  return `${report.reportNumber} · ${report.project.name} · ${report.section}`;
}

function buildWorkReportApprovalDescription(report: WorkReportView) {
  const description = truncateText(report.workDescription, 220);
  const blockers = truncateText(report.issues ?? "", 140);

  if (!description && !blockers) {
    return null;
  }

  if (description && blockers) {
    return `${description} · Блокеры: ${blockers}`;
  }

  return description ?? `Блокеры: ${blockers}`;
}

function buildBaseWriteInput(report: WorkReportView) {
  return {
    description: buildWorkReportApprovalDescription(report),
    entityId: report.id,
    entityType: WORK_REPORT_APPROVAL_ENTITY_TYPE,
    metadata: JSON.stringify(buildWorkReportApprovalMetadata(report)),
    title: buildWorkReportApprovalTitle(report),
    type: WORK_REPORT_APPROVAL_TYPE,
  };
}

export async function syncWorkReportApprovalRecord(
  report: WorkReportView,
  input: SyncWorkReportApprovalInput = {},
  deps: WorkReportApprovalDeps = {}
) {
  const ensureActorUser =
    deps.ensureActorUser ??
    ((userId: string | null | undefined, name?: string | null) =>
      ensureApprovalActorUser(userId, name, deps));
  const findLatestPendingApproval =
    deps.findLatestPendingApproval ??
    ((reportId: string) =>
      prisma.approval.findFirst({
        where: {
          entityId: reportId,
          entityType: WORK_REPORT_APPROVAL_ENTITY_TYPE,
          status: "pending",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }));
  const createApproval =
    deps.createApproval ??
    ((data: WorkReportApprovalWriteInput) =>
      prisma.approval.create({
        data,
      }));
  const updateApproval =
    deps.updateApproval ??
    ((id: string, data: Partial<WorkReportApprovalWriteInput>) =>
      prisma.approval.update({
        where: { id },
        data,
      }));
  const now = deps.now ?? (() => new Date());
  const createId = deps.createId ?? (() => randomUUID());

  const requestedById = await ensureActorUser(input.requestedByUserId, input.requestedByName);
  const reviewedById = await ensureActorUser(input.reviewedByUserId, input.reviewedByName);
  const pending = await findLatestPendingApproval(report.id);
  const base = buildBaseWriteInput(report);

  if (report.status === "submitted") {
    if (pending) {
      return updateApproval(pending.id, {
        ...base,
        comment: null,
        expiresAt: null,
        requestedById: requestedById ?? pending.requestedById ?? null,
        reviewedAt: null,
        reviewedById: null,
        status: "pending",
      });
    }

    return createApproval({
      id: createId(),
      ...base,
      comment: null,
      expiresAt: null,
      requestedById,
      reviewedAt: null,
      reviewedById: null,
      status: "pending",
    });
  }

  if (report.status === "approved" || report.status === "rejected") {
    const reviewedAt = report.reviewedAt ? new Date(report.reviewedAt) : now();
    const decisionData = {
      ...base,
      comment: normalizeOptionalString(report.reviewComment),
      expiresAt: null,
      reviewedAt,
      reviewedById,
      status: report.status,
    } satisfies Partial<WorkReportApprovalWriteInput>;

    if (pending) {
      return updateApproval(pending.id, {
        ...decisionData,
        requestedById: pending.requestedById ?? requestedById ?? null,
      });
    }

    return createApproval({
      id: createId(),
      ...base,
      comment: normalizeOptionalString(report.reviewComment),
      expiresAt: null,
      requestedById,
      reviewedAt,
      reviewedById,
      status: report.status,
    });
  }

  return null;
}

export async function expirePendingWorkReportApprovals(
  reportId: string,
  input: {
    comment?: string | null;
    reviewedByName?: string | null;
    reviewedByUserId?: string | null;
  } = {},
  deps: WorkReportApprovalDeps = {}
) {
  const ensureActorUser =
    deps.ensureActorUser ??
    ((userId: string | null | undefined, name?: string | null) =>
      ensureApprovalActorUser(userId, name, deps));
  const updateManyPendingApprovals =
    deps.updateManyPendingApprovals ??
    ((targetReportId: string, data: Partial<WorkReportApprovalWriteInput>) =>
      prisma.approval
        .updateMany({
          where: {
            entityId: targetReportId,
            entityType: WORK_REPORT_APPROVAL_ENTITY_TYPE,
            status: "pending",
          },
          data,
        })
        .then((result) => result.count));

  const reviewedById = await ensureActorUser(input.reviewedByUserId, input.reviewedByName);
  const comment =
    normalizeOptionalString(input.comment) ?? "Work report was deleted before the review finished.";
  const reviewedAt = deps.now ? deps.now() : new Date();

  return updateManyPendingApprovals(reportId, {
    comment,
    expiresAt: reviewedAt,
    reviewedAt,
    reviewedById,
    status: "expired",
  });
}
