import { z } from "zod";

import { workReportStatusSchema } from "@/lib/validators/work-report";

const workReportSignalPlanFactSchema = z.object({
  status: z.enum(["on_track", "watch", "critical"]),
  plannedProgress: z.number(),
  actualProgress: z.number(),
  progressVariance: z.number(),
  cpi: z.number().nullable(),
  spi: z.number().nullable(),
  budgetVarianceRatio: z.number(),
  pendingWorkReports: z.number(),
  daysSinceLastApprovedReport: z.number().nullable(),
});

const workReportSignalAlertSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  category: z.string().trim().min(1),
  summary: z.string().trim().min(1),
});

const workReportSignalSnapshotSchema = z.object({
  headline: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  reportId: z.string().trim().min(1),
  reportNumber: z.string().trim().min(1),
  reportStatus: workReportStatusSchema,
  reportDate: z.string().trim().min(1),
  section: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  projectName: z.string().trim().min(1),
  planFact: workReportSignalPlanFactSchema,
  topAlerts: z.array(workReportSignalAlertSchema),
});

const workReportSignalProposalSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    state: z.string().trim().min(1),
  })
  .passthrough();

const workReportSignalRunSchema = z.object({
  purpose: z.enum(["tasks", "risks", "status"]),
  label: z.string().trim().min(1),
  pollPath: z.string().trim().min(1),
  run: z
    .object({
      id: z.string().trim().min(1).optional(),
      status: z.string().trim().min(1),
      result: z
        .object({
          summary: z.string().trim().optional(),
          proposal: workReportSignalProposalSchema.nullable().optional(),
        })
        .passthrough()
        .nullable()
        .optional(),
    })
    .passthrough(),
});

export const workReportSignalPacketPortableSchema = z.object({
  packetId: z.string().trim().min(1),
  createdAt: z.string().trim().min(1),
  reportId: z.string().trim().min(1),
  reportNumber: z.string().trim().min(1),
  reportStatus: workReportStatusSchema,
  projectId: z.string().trim().min(1),
  projectName: z.string().trim().min(1),
  signal: workReportSignalSnapshotSchema,
  runs: z.array(workReportSignalRunSchema),
});

export const workReportSignalPacketSchema = z.object({
  locale: z.enum(["ru", "en"]).optional(),
  interfaceLocale: z.enum(["ru", "en"]).optional(),
});

export const workReportSignalPacketExportSchema = z.object({
  format: z.enum(["markdown", "json"]),
  packet: workReportSignalPacketPortableSchema,
});

export const workReportSignalPacketTelegramDeliverySchema = z.object({
  locale: z.enum(["ru", "en"]).optional(),
  chatId: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).optional(),
  dryRun: z.boolean().optional(),
  packet: workReportSignalPacketPortableSchema,
});
