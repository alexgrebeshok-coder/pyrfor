import { randomUUID } from "node:crypto";

import { prisma } from '../prisma';
import type {
  GpsTelemetrySample,
  GpsTelemetrySampleSnapshot,
} from '../connectors/gps-client';
import { getGpsTelemetrySampleSnapshot } from '../connectors/gps-client';
import {
  getDerivedSyncCheckpoint,
  markDerivedSyncError,
  markDerivedSyncStarted,
  markDerivedSyncSuccess,
  type DerivedSyncStore,
} from '../sync-state';
import { listWorkReports } from '../work-reports/service';
import type { WorkReportView } from '../work-reports/types';

import type {
  EvidenceListResult,
  EvidenceMetadata,
  EvidenceQuery,
  EvidenceRecordView,
  EvidenceSummary,
  EvidenceUpsertInput,
  EvidenceVerificationStatus,
} from "./types";

interface StoredEvidenceRecord {
  id: string;
  sourceType: string;
  sourceRef: string | null;
  entityType: string;
  entityRef: string;
  projectId: string | null;
  title: string;
  summary: string | null;
  observedAt: Date;
  reportedAt: Date | null;
  confidence: number;
  verificationStatus: string;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EvidenceStore {
  upsert(args: {
    where: {
      sourceType_entityType_entityRef: {
        entityRef: string;
        entityType: string;
        sourceType: string;
      };
    };
    create: { id: string } & EvidenceWriteShape;
    update: EvidenceWriteShape;
  }): Promise<StoredEvidenceRecord>;
  findMany(args: {
    orderBy: { observedAt: "desc" };
    take: number;
    where?: {
      entityRef?: string;
      entityType?: string;
      projectId?: string;
      verificationStatus?: string;
    };
  }): Promise<StoredEvidenceRecord[]>;
  findUnique(args: { where: { id: string } }): Promise<StoredEvidenceRecord | null>;
  deleteMany(args: {
    where: {
      entityRef?: string;
      entityType?: string;
      sourceType?: string;
    };
  }): Promise<{ count: number }>;
}

interface EvidenceServiceDeps {
  evidenceStore?: EvidenceStore;
  gpsSnapshot?: GpsTelemetrySampleSnapshot;
  listReports?: (input?: { limit?: number }) => Promise<WorkReportView[]>;
  now?: () => Date;
  syncStore?: DerivedSyncStore;
}

interface SyncEvidenceOptions {
  includeGpsSample?: boolean;
  includeWorkReports?: boolean;
}

type EvidenceWriteShape = {
  confidence: number;
  entityRef: string;
  entityType: string;
  metadataJson: string | null;
  observedAt: Date;
  projectId: string | null;
  reportedAt: Date | null;
  sourceRef: string | null;
  sourceType: string;
  summary: string | null;
  title: string;
  verificationStatus: string;
  updatedAt: Date;
};

const defaultEvidenceStore: EvidenceStore = {
  upsert(args) {
    return prisma.evidenceRecord.upsert(args);
  },
  findMany(args) {
    return prisma.evidenceRecord.findMany(args);
  },
  findUnique(args) {
    return prisma.evidenceRecord.findUnique(args);
  },
  deleteMany(args) {
    return prisma.evidenceRecord.deleteMany(args);
  },
};

export const EVIDENCE_LEDGER_SYNC_KEY = "evidence_ledger";

export async function getEvidenceLedgerOverview(
  query: EvidenceQuery = {},
  deps: EvidenceServiceDeps = {}
): Promise<EvidenceListResult> {
  const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
  const sync = await getDerivedSyncCheckpoint(EVIDENCE_LEDGER_SYNC_KEY, {
    syncStore: deps.syncStore,
  });

  const records = await evidenceStore.findMany({
    where: {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityRef ? { entityRef: query.entityRef } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.verificationStatus ? { verificationStatus: query.verificationStatus } : {}),
    },
    orderBy: { observedAt: "desc" },
    take: sanitizeLimit(query.limit),
  });

  const views = records.map(serializeEvidenceRecord);

  return {
    syncedAt: sync?.lastCompletedAt ?? sync?.lastSuccessAt ?? null,
    summary: summarizeEvidenceRecords(views),
    records: views,
    sync,
  };
}

export async function syncEvidenceLedger(
  deps: EvidenceServiceDeps = {},
  options: SyncEvidenceOptions = {}
): Promise<void> {
  const includeGpsSample = options.includeGpsSample ?? true;
  const includeWorkReports = options.includeWorkReports ?? true;
  const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
  const listReports =
    deps.listReports ?? ((input?: { limit?: number }) => listWorkReports({ limit: input?.limit ?? 100 }));

  await markDerivedSyncStarted(EVIDENCE_LEDGER_SYNC_KEY, {
    now: deps.now,
    syncStore: deps.syncStore,
  });

  try {
    const [gpsSnapshot, workReports] = await Promise.all([
      includeGpsSample ? deps.gpsSnapshot ?? getGpsTelemetrySampleSnapshot() : Promise.resolve(null),
      includeWorkReports ? listReports({ limit: 100 }) : Promise.resolve([]),
    ]);

    const upsertInputs = [
      ...workReports
        .map(mapWorkReportToEvidenceInput)
        .filter((item): item is EvidenceUpsertInput => item !== null),
      ...(gpsSnapshot ? mapGpsSnapshotToEvidenceInputs(gpsSnapshot) : []),
    ];

    await Promise.all(
      upsertInputs.map((input) => upsertEvidenceInput(input, evidenceStore))
    );

    await markDerivedSyncSuccess(
      EVIDENCE_LEDGER_SYNC_KEY,
      {
        metadata: {
          gpsIncluded: includeGpsSample,
          gpsStatus: gpsSnapshot?.status ?? null,
          gpsSampleCount: gpsSnapshot?.status === "ok" ? gpsSnapshot.samples.length : 0,
          workReportCount: workReports.length,
        },
        resultCount: upsertInputs.length,
      },
      {
        now: deps.now,
        syncStore: deps.syncStore,
      }
    );
  } catch (error) {
    await markDerivedSyncError(
      EVIDENCE_LEDGER_SYNC_KEY,
      error,
      {
        metadata: {
          gpsIncluded: includeGpsSample,
          workReportsIncluded: includeWorkReports,
        },
      },
      {
        now: deps.now,
        syncStore: deps.syncStore,
      }
    );
    throw error;
  }
}

export async function syncWorkReportEvidenceRecord(
  report: WorkReportView,
  deps: Pick<EvidenceServiceDeps, "evidenceStore" | "now" | "syncStore"> = {}
): Promise<void> {
  const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
  const input = mapWorkReportToEvidenceInput(report);

  if (!input) {
    await removeEvidenceRecordForEntity("work_report", report.id, deps);
    return;
  }

  await upsertEvidenceInput(input, evidenceStore);
  await markDerivedSyncSuccess(
    EVIDENCE_LEDGER_SYNC_KEY,
    {
      metadata: {
        lastEntityRef: report.id,
        lastSourceType: input.sourceType,
        lastWrite: "work_report_upsert",
      },
      resultCount: 1,
    },
    {
      now: deps.now,
      syncStore: deps.syncStore,
    }
  );
}

export async function removeEvidenceRecordForEntity(
  entityType: string,
  entityRef: string,
  deps: Pick<EvidenceServiceDeps, "evidenceStore" | "now" | "syncStore"> = {}
): Promise<number> {
  const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
  const result = await evidenceStore.deleteMany({
    where: {
      entityType,
      entityRef,
    },
  });

  await markDerivedSyncSuccess(
    EVIDENCE_LEDGER_SYNC_KEY,
    {
      metadata: {
        lastEntityRef: entityRef,
        lastEntityType: entityType,
        lastWrite: "evidence_delete",
      },
      resultCount: result.count,
    },
    {
      now: deps.now,
      syncStore: deps.syncStore,
    }
  );

  return result.count;
}

export async function getEvidenceRecordById(
  id: string,
  deps: Pick<EvidenceServiceDeps, "evidenceStore"> = {}
): Promise<EvidenceRecordView | null> {
  const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
  const record = await evidenceStore.findUnique({
    where: { id },
  });

  return record ? serializeEvidenceRecord(record) : null;
}

export function mapWorkReportToEvidenceInput(
  report: WorkReportView
): EvidenceUpsertInput | null {
  if (report.status === "rejected") {
    return null;
  }

  const verificationStatus: EvidenceVerificationStatus =
    report.status === "approved" ? "verified" : "reported";

  return {
    sourceType: `work_report:${report.source}`,
    sourceRef: report.reportNumber,
    entityType: "work_report",
    entityRef: report.id,
    projectId: report.projectId,
    title: `${report.reportNumber} · ${report.section}`,
    summary: truncate(report.workDescription, 160),
    observedAt: report.reviewedAt ?? report.submittedAt,
    reportedAt: report.submittedAt,
    confidence: verificationStatus === "verified" ? 0.82 : 0.58,
    verificationStatus,
    metadata: {
      equipment: report.equipment,
      projectName: report.project.name,
      reportDate: report.reportDate,
      reportNumber: report.reportNumber,
      reportStatus: report.status,
      section: report.section,
      source: report.source,
      workDescription: truncate(report.workDescription, 200),
    },
  };
}

export function mapGpsSnapshotToEvidenceInputs(
  snapshot: GpsTelemetrySampleSnapshot
): EvidenceUpsertInput[] {
  if (snapshot.status !== "ok") {
    return [];
  }

  return snapshot.samples.map((sample, index) =>
    mapGpsSampleToEvidenceInput(sample, snapshot, index)
  );
}

export function summarizeEvidenceRecords(
  records: EvidenceRecordView[]
): EvidenceSummary {
  if (records.length === 0) {
    return {
      total: 0,
      reported: 0,
      observed: 0,
      verified: 0,
      averageConfidence: null,
      lastObservedAt: null,
    };
  }

  const summary = records.reduce(
    (accumulator, record) => {
      accumulator.total += 1;
      accumulator[record.verificationStatus] += 1;
      accumulator.confidenceTotal += record.confidence;

      if (!accumulator.lastObservedAt || accumulator.lastObservedAt < record.observedAt) {
        accumulator.lastObservedAt = record.observedAt;
      }

      return accumulator;
    },
    {
      total: 0,
      reported: 0,
      observed: 0,
      verified: 0,
      confidenceTotal: 0,
      lastObservedAt: null as string | null,
    }
  );

  return {
    total: summary.total,
    reported: summary.reported,
    observed: summary.observed,
    verified: summary.verified,
    averageConfidence: round(summary.confidenceTotal / summary.total, 2),
    lastObservedAt: summary.lastObservedAt,
  };
}

function mapGpsSampleToEvidenceInput(
  sample: GpsTelemetrySample,
  snapshot: GpsTelemetrySampleSnapshot,
  index: number
): EvidenceUpsertInput {
  const entityRef =
    sample.sessionId ??
    [sample.equipmentId ?? "equipment", sample.startedAt ?? "start", sample.endedAt ?? "end", index].join(":");

  return {
    sourceType: "gps_api:session_sample",
    sourceRef: snapshot.sampleUrl ?? "gps-sample",
    entityType: "gps_session",
    entityRef,
    projectId: null,
    title: `${sample.equipmentId ?? "Unknown equipment"} · ${sample.status}`,
    summary: buildGpsSampleSummary(sample),
    observedAt: sample.endedAt ?? sample.startedAt ?? snapshot.checkedAt,
    reportedAt: null,
    confidence: calculateGpsSampleConfidence(sample),
    verificationStatus: "observed",
    metadata: {
      equipmentId: sample.equipmentId,
      equipmentType: sample.equipmentType,
      geofenceId: sample.geofenceId,
      geofenceName: sample.geofenceName,
      sessionStatus: sample.status,
    },
  };
}

async function upsertEvidenceInput(
  input: EvidenceUpsertInput,
  evidenceStore: EvidenceStore
) {
  return evidenceStore.upsert({
    where: {
      sourceType_entityType_entityRef: {
        sourceType: input.sourceType,
        entityType: input.entityType,
        entityRef: input.entityRef,
      },
    },
    create: {
      id: randomUUID(),
      ...toEvidenceWriteShape(input),
    },
    update: toEvidenceWriteShape(input),
  });
}

function serializeEvidenceRecord(record: StoredEvidenceRecord): EvidenceRecordView {
  return {
    id: record.id,
    sourceType: record.sourceType,
    sourceRef: record.sourceRef,
    entityType: record.entityType,
    entityRef: record.entityRef,
    projectId: record.projectId,
    title: record.title,
    summary: record.summary,
    observedAt: record.observedAt.toISOString(),
    reportedAt: record.reportedAt?.toISOString() ?? null,
    confidence: round(record.confidence, 2),
    verificationStatus: normalizeVerificationStatus(record.verificationStatus),
    metadata: parseMetadata(record.metadataJson),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toEvidenceWriteShape(input: EvidenceUpsertInput): EvidenceWriteShape {
  return {
    sourceType: input.sourceType,
    sourceRef: input.sourceRef ?? null,
    entityType: input.entityType,
    entityRef: input.entityRef,
    projectId: input.projectId ?? null,
    title: input.title,
    summary: input.summary ?? null,
    observedAt: new Date(input.observedAt),
    reportedAt: input.reportedAt ? new Date(input.reportedAt) : null,
    confidence: input.confidence,
    verificationStatus: input.verificationStatus,
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    updatedAt: new Date(),
  };
}

function buildGpsSampleSummary(sample: GpsTelemetrySample) {
  const parts = [
    sample.status,
    sample.geofenceName ?? sample.geofenceId,
    sample.durationSeconds !== null ? `${Math.round(sample.durationSeconds / 60)} min` : null,
  ].filter((item): item is string => Boolean(item));

  return parts.join(" · ") || "Observed GPS session sample";
}

function calculateGpsSampleConfidence(sample: GpsTelemetrySample) {
  let confidence = 0.45;

  if (sample.sessionId) confidence += 0.15;
  if (sample.equipmentId) confidence += 0.15;
  if (sample.startedAt && sample.endedAt) confidence += 0.15;
  if (sample.durationSeconds !== null) confidence += 0.05;
  if (sample.geofenceId || sample.geofenceName) confidence += 0.05;

  return round(Math.min(confidence, 0.95), 2);
}

function parseMetadata(value: string | null): EvidenceMetadata {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as EvidenceMetadata;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeVerificationStatus(value: string): EvidenceVerificationStatus {
  switch (value) {
    case "verified":
    case "observed":
    case "reported":
      return value;
    default:
      return "reported";
  }
}

function sanitizeLimit(value: number | undefined) {
  if (!value || !Number.isFinite(value)) {
    return 8;
  }

  return Math.max(1, Math.min(Math.round(value), 50));
}

function truncate(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
