import type { AIRunInput, AIRunRecord } from '../ai/types';
import type { Locale } from '../utils/translations';

export type WorkReportStatus = "submitted" | "approved" | "rejected";

export type WorkReportSource = "manual" | "telegram_bot" | "import";

export interface WorkReportVolume {
  description: string;
  value?: number;
  unit?: string;
  note?: string;
}

export interface WorkReportAttachment {
  id?: string;
  name?: string;
  url?: string;
  mimeType?: string;
  size?: number;
  type?: string;
}

export interface CreateWorkReportInput {
  projectId: string;
  authorId: string;
  section: string;
  reportDate: string;
  workDescription: string;
  volumes?: WorkReportVolume[];
  personnelCount?: number;
  personnelDetails?: string;
  equipment?: string;
  weather?: string;
  issues?: string;
  nextDayPlan?: string;
  attachments?: WorkReportAttachment[];
  reportNumber?: string;
  status?: WorkReportStatus;
  source?: WorkReportSource;
  externalReporterTelegramId?: string;
  externalReporterName?: string;
}

export interface UpdateWorkReportInput {
  section?: string;
  reportDate?: string;
  workDescription?: string;
  volumes?: WorkReportVolume[];
  personnelCount?: number | null;
  personnelDetails?: string | null;
  equipment?: string | null;
  weather?: string | null;
  issues?: string | null;
  nextDayPlan?: string | null;
  attachments?: WorkReportAttachment[];
}

export interface ReviewWorkReportInput {
  reviewerId: string;
  reviewComment?: string | null;
}

export interface AIPMOBotWorkReport {
  report_id?: string;
  project_name: string;
  section: string;
  report_date: string;
  work_description: string;
  reporter_telegram_id: number | string;
  reporter_name?: string | null;
  volumes?: WorkReportVolume[];
  personnel_count?: number | null;
  personnel_details?: string | null;
  equipment?: string | null;
  weather?: string | null;
  issues?: string | null;
  next_day_plan?: string | null;
  attachments?: WorkReportAttachment[];
  status?: WorkReportStatus;
}

export interface WorkReportQuery {
  projectId?: string;
  authorId?: string;
  status?: WorkReportStatus;
  reportDate?: string;
  limit?: number;
}

export interface WorkReportProjectOption {
  id: string;
  name: string;
}

export interface WorkReportMemberOption {
  id: string;
  name: string;
  role?: string | null;
  initials?: string | null;
}

export interface WorkReportView {
  id: string;
  reportNumber: string;
  projectId: string;
  project: WorkReportProjectOption;
  authorId: string;
  author: WorkReportMemberOption;
  reviewerId: string | null;
  reviewer: WorkReportMemberOption | null;
  section: string;
  reportDate: string;
  workDescription: string;
  volumes: WorkReportVolume[];
  personnelCount: number | null;
  personnelDetails: string | null;
  equipment: string | null;
  weather: string | null;
  issues: string | null;
  nextDayPlan: string | null;
  attachments: WorkReportAttachment[];
  status: WorkReportStatus;
  reviewComment: string | null;
  source: WorkReportSource | string;
  externalReporterTelegramId: string | null;
  externalReporterName: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkReportActionPurpose = "tasks" | "risks" | "status";

export interface WorkReportSignalAlert {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  category: string;
  summary: string;
}

export interface WorkReportSignalSnapshot {
  headline: string;
  summary: string;
  reportId: string;
  reportNumber: string;
  reportStatus: WorkReportStatus;
  reportDate: string;
  section: string;
  projectId: string;
  projectName: string;
  planFact: {
    status: "on_track" | "watch" | "critical";
    plannedProgress: number;
    actualProgress: number;
    progressVariance: number;
    cpi: number | null;
    spi: number | null;
    budgetVarianceRatio: number;
    pendingWorkReports: number;
    daysSinceLastApprovedReport: number | null;
  };
  topAlerts: WorkReportSignalAlert[];
}

export interface WorkReportSignalPacketRequest {
  locale?: Locale;
  interfaceLocale?: Locale;
}

export type WorkReportSignalPacketExportFormat = "markdown" | "json";

export interface WorkReportSignalPacketPortableRun {
  purpose: WorkReportActionPurpose;
  label: string;
  pollPath: string;
  run: {
    id?: string;
    status: string;
    result?: {
      summary?: string;
      proposal?: {
        id?: string;
        title: string;
        summary: string;
        state: string;
      } | null;
    } | null;
  };
}

export interface WorkReportSignalRunBlueprint {
  purpose: WorkReportActionPurpose;
  label: string;
  input: AIRunInput;
}

export interface WorkReportSignalPacketRun {
  purpose: WorkReportActionPurpose;
  label: string;
  pollPath: string;
  run: AIRunRecord;
}

export interface WorkReportSignalPacket {
  packetId: string;
  createdAt: string;
  reportId: string;
  reportNumber: string;
  reportStatus: WorkReportStatus;
  projectId: string;
  projectName: string;
  signal: WorkReportSignalSnapshot;
  runs: WorkReportSignalPacketRun[];
}

export interface WorkReportSignalPacketPortable {
  packetId: string;
  createdAt: string;
  reportId: string;
  reportNumber: string;
  reportStatus: WorkReportStatus;
  projectId: string;
  projectName: string;
  signal: WorkReportSignalSnapshot;
  runs: WorkReportSignalPacketPortableRun[];
}
