import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { prisma } from '../prisma';

import { parseJsonArray, serializeJsonArray } from "./mapper";
import type {
  CreateWorkReportInput,
  UpdateWorkReportInput,
  WorkReportMemberOption,
  WorkReportProjectOption,
  WorkReportQuery,
  WorkReportStatus,
  WorkReportView,
} from "./types";

const workReportSelect = {
  id: true,
  reportNumber: true,
  projectId: true,
  authorId: true,
  reviewerId: true,
  section: true,
  reportDate: true,
  workDescription: true,
  volumesJson: true,
  personnelCount: true,
  personnelDetails: true,
  equipment: true,
  weather: true,
  issues: true,
  nextDayPlan: true,
  attachmentsJson: true,
  status: true,
  reviewComment: true,
  source: true,
  externalReporterTelegramId: true,
  externalReporterName: true,
  submittedAt: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type WorkReportRow = Prisma.WorkReportGetPayload<{
  select: typeof workReportSelect;
}>;

type WorkReportRelationMaps = {
  projects: Map<string, WorkReportProjectOption>;
  authors: Map<string, WorkReportMemberOption>;
  reviewers: Map<string, WorkReportMemberOption>;
};

export async function listWorkReports(query: WorkReportQuery = {}) {
  const rows = await prisma.workReport.findMany({
    where: {
      ...(query.projectId && { projectId: query.projectId }),
      ...(query.authorId && { authorId: query.authorId }),
      ...(query.status && { status: query.status }),
      ...(query.reportDate && {
        reportDate: {
          gte: startOfDay(query.reportDate),
          lt: endOfDay(query.reportDate),
        },
      }),
    },
    select: workReportSelect,
    orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
    take: query.limit ?? 50,
  });

  return hydrateWorkReportRows(rows);
}

export async function getWorkReportById(id: string) {
  const record = await prisma.workReport.findUnique({
    where: { id },
    select: workReportSelect,
  });

  return record ? hydrateWorkReportRow(record) : null;
}

export async function createWorkReport(input: CreateWorkReportInput) {
  await ensureProjectExists(input.projectId);
  await ensureMemberExists(input.authorId, "Author");

  const reportNumber =
    input.reportNumber?.trim() || (await generateNextWorkReportNumber(input.reportDate));

  const created = await prisma.workReport.create({
    data: {
      id: randomUUID(),
      reportNumber,
      projectId: input.projectId,
      authorId: input.authorId,
      section: input.section,
      reportDate: new Date(input.reportDate),
      workDescription: input.workDescription,
      volumesJson: serializeJsonArray(input.volumes),
      personnelCount: input.personnelCount,
      personnelDetails: input.personnelDetails,
      equipment: input.equipment,
      weather: input.weather,
      issues: input.issues,
      nextDayPlan: input.nextDayPlan,
      attachmentsJson: serializeJsonArray(input.attachments),
      status: input.status ?? "submitted",
      source: input.source ?? "manual",
      externalReporterTelegramId: input.externalReporterTelegramId,
      externalReporterName: input.externalReporterName,
      updatedAt: new Date(),
    },
  });

  const hydrated = await getWorkReportById(created.id);
  if (!hydrated) {
    throw new Error("Failed to load created work report");
  }

  return hydrated;
}

export async function updateWorkReport(id: string, input: UpdateWorkReportInput) {
  const existing = await prisma.workReport.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      volumesJson: true,
      attachmentsJson: true,
    },
  });

  if (!existing) {
    throw new Error("Work report not found");
  }

  await prisma.workReport.update({
    where: { id },
    data: {
      ...(input.section !== undefined && { section: input.section }),
      ...(input.reportDate !== undefined && { reportDate: new Date(input.reportDate) }),
      ...(input.workDescription !== undefined && { workDescription: input.workDescription }),
      ...(input.volumes !== undefined && { volumesJson: serializeJsonArray(input.volumes) }),
      ...(input.personnelCount !== undefined && { personnelCount: input.personnelCount }),
      ...(input.personnelDetails !== undefined && { personnelDetails: normalizeNullable(input.personnelDetails) }),
      ...(input.equipment !== undefined && { equipment: normalizeNullable(input.equipment) }),
      ...(input.weather !== undefined && { weather: normalizeNullable(input.weather) }),
      ...(input.issues !== undefined && { issues: normalizeNullable(input.issues) }),
      ...(input.nextDayPlan !== undefined && { nextDayPlan: normalizeNullable(input.nextDayPlan) }),
      ...(input.attachments !== undefined && {
        attachmentsJson: serializeJsonArray(input.attachments),
      }),
      ...(existing.status !== "submitted"
        ? {
            status: "submitted",
            reviewerId: null,
            reviewComment: null,
            reviewedAt: null,
          }
        : {}),
    },
  });

  const hydrated = await getWorkReportById(id);
  if (!hydrated) {
    throw new Error("Failed to load updated work report");
  }

  return hydrated;
}

export async function approveWorkReport(
  id: string,
  input: { reviewerId: string; reviewComment?: string | null }
) {
  await ensureMemberExists(input.reviewerId, "Reviewer");

  await prisma.workReport.update({
    where: { id },
    data: {
      status: "approved",
      reviewerId: input.reviewerId,
      reviewComment: normalizeNullable(input.reviewComment),
      reviewedAt: new Date(),
    },
  });

  const hydrated = await getWorkReportById(id);
  if (!hydrated) {
    throw new Error("Failed to load approved work report");
  }

  return hydrated;
}

export async function rejectWorkReport(
  id: string,
  input: { reviewerId: string; reviewComment: string }
) {
  await ensureMemberExists(input.reviewerId, "Reviewer");

  await prisma.workReport.update({
    where: { id },
    data: {
      status: "rejected",
      reviewerId: input.reviewerId,
      reviewComment: input.reviewComment.trim(),
      reviewedAt: new Date(),
    },
  });

  const hydrated = await getWorkReportById(id);
  if (!hydrated) {
    throw new Error("Failed to load rejected work report");
  }

  return hydrated;
}

export async function deleteWorkReport(id: string) {
  await prisma.workReport.delete({
    where: { id },
  });
}

export async function generateNextWorkReportNumber(reportDate: string): Promise<string> {
  const date = new Date(reportDate);
  const prefix = `#${date.toISOString().slice(0, 10).replaceAll("-", "")}`;
  const count = await prisma.workReport.count({
    where: {
      reportNumber: {
        startsWith: prefix,
      },
    },
  });

  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

export function normalizeWorkReportStatus(value: unknown): WorkReportStatus | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  switch (value.trim()) {
    case "submitted":
    case "approved":
    case "rejected":
      return value.trim() as WorkReportStatus;
    default:
      return undefined;
  }
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function hydrateWorkReportRows(rows: WorkReportRow[]): Promise<WorkReportView[]> {
  if (rows.length === 0) {
    return [];
  }

  const projectIds = [...new Set(rows.map((row) => row.projectId))];
  const authorIds = [...new Set(rows.map((row) => row.authorId))];
  const reviewerIds = [...new Set(rows.map((row) => row.reviewerId).filter((id): id is string => Boolean(id)))];

  const [projects, authors, reviewers] = await Promise.all([
    projectIds.length
      ? prisma.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    authorIds.length
      ? prisma.teamMember.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true, initials: true, role: true },
        })
      : Promise.resolve([]),
    reviewerIds.length
      ? prisma.teamMember.findMany({
          where: { id: { in: reviewerIds } },
          select: { id: true, name: true, initials: true, role: true },
        })
      : Promise.resolve([]),
  ]);

  const relationMaps: WorkReportRelationMaps = {
    projects: new Map(projects.map((project) => [project.id, project])),
    authors: new Map(authors.map((author) => [author.id, author])),
    reviewers: new Map(reviewers.map((reviewer) => [reviewer.id, reviewer])),
  };

  return rows.map((row) => hydrateWorkReportRow(row, relationMaps));
}

function hydrateWorkReportRow(
  record: WorkReportRow,
  relations?: WorkReportRelationMaps
): WorkReportView {
  const fallbackProject: WorkReportProjectOption = {
    id: record.projectId,
    name: "Проект не найден",
  };
  const fallbackAuthor: WorkReportMemberOption = {
    id: record.authorId,
    name: "Участник не найден",
    initials: null,
    role: null,
  };

  const project = relations?.projects.get(record.projectId) ?? fallbackProject;
  const author = relations?.authors.get(record.authorId) ?? fallbackAuthor;
  const reviewer = record.reviewerId
    ? relations?.reviewers.get(record.reviewerId) ?? {
        id: record.reviewerId,
        name: "Проверяющий не найден",
        initials: null,
        role: null,
      }
    : null;

  return {
    id: record.id,
    reportNumber: record.reportNumber,
    projectId: record.projectId,
    project,
    authorId: record.authorId,
    author,
    reviewerId: record.reviewerId,
    reviewer,
    section: record.section,
    reportDate: record.reportDate.toISOString(),
    workDescription: record.workDescription,
    volumes: parseJsonArray(record.volumesJson),
    personnelCount: record.personnelCount,
    personnelDetails: record.personnelDetails,
    equipment: record.equipment,
    weather: record.weather,
    issues: record.issues,
    nextDayPlan: record.nextDayPlan,
    attachments: parseJsonArray(record.attachmentsJson),
    status: normalizeWorkReportStatus(record.status) ?? "submitted",
    reviewComment: record.reviewComment,
    source: record.source,
    externalReporterTelegramId: record.externalReporterTelegramId,
    externalReporterName: record.externalReporterName,
    submittedAt: record.submittedAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function startOfDay(value: string): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: string): Date {
  const date = startOfDay(value);
  date.setDate(date.getDate() + 1);
  return date;
}

async function ensureProjectExists(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });

  if (!project) {
    throw new Error("Project not found for work report.");
  }
}

async function ensureMemberExists(memberId: string, role: string) {
  const member = await prisma.teamMember.findUnique({
    where: { id: memberId },
    select: { id: true },
  });

  if (!member) {
    throw new Error(`Team member not found for ${role.toLowerCase()} work report.`);
  }
}
