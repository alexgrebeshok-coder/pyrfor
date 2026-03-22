import type {
  AIPMOBotWorkReport,
  CreateWorkReportInput,
  WorkReportAttachment,
  WorkReportMemberOption,
  WorkReportProjectOption,
  WorkReportStatus,
  WorkReportView,
  WorkReportVolume,
} from "./types";

type WorkReportRecord = {
  id: string;
  reportNumber: string;
  projectId: string;
  project: WorkReportProjectOption;
  authorId: string;
  author: WorkReportMemberOption;
  reviewerId: string | null;
  reviewer: WorkReportMemberOption | null;
  section: string;
  reportDate: Date;
  workDescription: string;
  volumesJson: string;
  personnelCount: number | null;
  personnelDetails: string | null;
  equipment: string | null;
  weather: string | null;
  issues: string | null;
  nextDayPlan: string | null;
  attachmentsJson: string;
  status: string;
  reviewComment: string | null;
  source: string;
  externalReporterTelegramId: string | null;
  externalReporterName: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function mapAIPMOBotWorkReportToCreateInput(
  report: AIPMOBotWorkReport,
  options: {
    projectId: string;
    authorId: string;
  }
): CreateWorkReportInput {
  return {
    projectId: options.projectId,
    authorId: options.authorId,
    section: report.section,
    reportDate: report.report_date,
    workDescription: report.work_description,
    volumes: report.volumes ?? [],
    personnelCount: report.personnel_count ?? undefined,
    personnelDetails: report.personnel_details ?? undefined,
    equipment: report.equipment ?? undefined,
    weather: report.weather ?? undefined,
    issues: report.issues ?? undefined,
    nextDayPlan: report.next_day_plan ?? undefined,
    attachments: report.attachments ?? [],
    reportNumber: report.report_id,
    status: report.status ?? "submitted",
    source: "telegram_bot",
    externalReporterTelegramId: String(report.reporter_telegram_id),
    externalReporterName: report.reporter_name ?? undefined,
  };
}

export function serializeWorkReportRecord(record: WorkReportRecord): WorkReportView {
  return {
    id: record.id,
    reportNumber: record.reportNumber,
    projectId: record.projectId,
    project: record.project,
    authorId: record.authorId,
    author: record.author,
    reviewerId: record.reviewerId,
    reviewer: record.reviewer,
    section: record.section,
    reportDate: record.reportDate.toISOString(),
    workDescription: record.workDescription,
    volumes: parseJsonArray<WorkReportVolume>(record.volumesJson),
    personnelCount: record.personnelCount,
    personnelDetails: record.personnelDetails,
    equipment: record.equipment,
    weather: record.weather,
    issues: record.issues,
    nextDayPlan: record.nextDayPlan,
    attachments: parseJsonArray<WorkReportAttachment>(record.attachmentsJson),
    status: normalizeStatus(record.status),
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

function normalizeStatus(value: string): WorkReportStatus {
  switch (value) {
    case "approved":
    case "rejected":
    case "submitted":
      return value;
    default:
      return "submitted";
  }
}

export function serializeJsonArray(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value : [], null, 0);
}

export function parseJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
