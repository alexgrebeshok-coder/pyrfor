import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import type {
  GpsTelemetryTruthSnapshot,
} from "@/lib/connectors/gps-client";
import { getGpsTelemetryTruthSnapshot } from "@/lib/connectors/gps-client";
import type {
  OneCFinanceTruthSnapshot,
  OneCProjectFinanceTruth,
} from "@/lib/connectors/one-c-client";
import { getOneCFinanceTruthSnapshot } from "@/lib/connectors/one-c-client";
import type {
  EvidenceFusionFactView,
  EvidenceFusionOverview,
  EvidenceListResult,
  EvidenceRecordView,
  EvidenceVerificationStatus,
} from "@/lib/evidence";
import { getEvidenceFusionOverview, getEvidenceLedgerOverview } from "@/lib/evidence";
import {
  getDerivedSyncCheckpoint,
  markDerivedSyncError,
  markDerivedSyncStarted,
  markDerivedSyncSuccess,
  type DerivedSyncStore,
} from "@/lib/sync-state";

import type {
  ReconciliationCaseFieldView,
  ReconciliationCaseFinanceView,
  ReconciliationCaseResolutionStatus,
  ReconciliationCaseTelemetryView,
  ReconciliationCaseTruthStatus,
  ReconciliationCaseType,
  ReconciliationCasefileListResult,
  ReconciliationCasefileQuery,
  ReconciliationCasefileSummary,
  ReconciliationCasefileView,
} from "./types";

interface StoredReconciliationCasefile {
  id: string;
  key: string;
  caseType: string;
  truthStatus: string;
  resolutionStatus: string;
  projectId: string | null;
  projectName: string | null;
  financeProjectId: string | null;
  title: string;
  explanation: string;
  reasonCodesJson: string;
  evidenceRecordIdsJson: string;
  fusionFactIdsJson: string;
  telemetryRefsJson: string;
  financeJson: string | null;
  fieldJson: string | null;
  telemetryJson: string | null;
  lastObservedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

type CasefileWriteShape = {
  caseType: string;
  truthStatus: string;
  resolutionStatus: string;
  projectId: string | null;
  projectName: string | null;
  financeProjectId: string | null;
  title: string;
  explanation: string;
  reasonCodesJson: string;
  evidenceRecordIdsJson: string;
  fusionFactIdsJson: string;
  telemetryRefsJson: string;
  financeJson: string | null;
  fieldJson: string | null;
  telemetryJson: string | null;
  lastObservedAt: Date;
  updatedAt: Date;
};

export interface ReconciliationCasefileStore {
  deleteMany(args: {
    where?:
      | {
          key?: { notIn: string[] };
        }
      | undefined;
  }): Promise<{ count: number }>;
  findMany(args: {
    orderBy: { lastObservedAt: "desc" };
    take: number;
    where?: {
      caseType?: string;
      projectId?: string;
      resolutionStatus?: string;
      truthStatus?: string;
    };
  }): Promise<StoredReconciliationCasefile[]>;
  upsert(args: {
    where: { key: string };
    create: { key: string; id: string } & CasefileWriteShape;
    update: CasefileWriteShape;
  }): Promise<StoredReconciliationCasefile>;
}

interface ReconciliationCasefileDeps {
  casefileStore?: ReconciliationCasefileStore;
  evidence?: EvidenceListResult;
  fusion?: EvidenceFusionOverview;
  getEvidence?: (query: { limit?: number; projectId?: string }) => Promise<EvidenceListResult>;
  getFusion?: (query: { limit?: number; projectId?: string }) => Promise<EvidenceFusionOverview>;
  getGpsTruth?: () => Promise<GpsTelemetryTruthSnapshot>;
  getOneCTruth?: () => Promise<OneCFinanceTruthSnapshot>;
  gpsTruth?: GpsTelemetryTruthSnapshot;
  now?: () => Date;
  oneCTruth?: OneCFinanceTruthSnapshot;
  syncStore?: DerivedSyncStore;
}

interface ProjectCaseAccumulator {
  financeProject: OneCProjectFinanceTruth | null;
  financeProjectId: string | null;
  fieldRecords: EvidenceRecordView[];
  fusionFacts: EvidenceFusionFactView[];
  key: string;
  linkedTelemetry: LinkedTelemetryGap[];
  projectId: string | null;
  projectName: string;
}

interface LinkedTelemetryGap {
  equipmentIds: string[];
  entityRefs: string[];
  geofenceNames: string[];
  key: string;
  observedAt: string;
}

interface CasefileSeed {
  key: string;
  caseType: ReconciliationCaseType;
  truthStatus: ReconciliationCaseTruthStatus;
  resolutionStatus: ReconciliationCaseResolutionStatus;
  projectId: string | null;
  projectName: string | null;
  financeProjectId: string | null;
  title: string;
  explanation: string;
  reasonCodes: string[];
  evidenceRecordIds: string[];
  fusionFactIds: string[];
  telemetryRefs: string[];
  finance: ReconciliationCaseFinanceView | null;
  field: ReconciliationCaseFieldView | null;
  telemetry: ReconciliationCaseTelemetryView | null;
  lastObservedAt: string;
}

const defaultCasefileStore: ReconciliationCasefileStore = {
  deleteMany(args) {
    return prisma.reconciliationCasefile.deleteMany(args);
  },
  findMany(args) {
    return prisma.reconciliationCasefile.findMany(args);
  },
  upsert(args) {
    return prisma.reconciliationCasefile.upsert(args);
  },
};

export const RECONCILIATION_CASEFILE_SYNC_KEY = "reconciliation_casefiles";

export async function getReconciliationCasefiles(
  query: ReconciliationCasefileQuery = {},
  deps: Pick<ReconciliationCasefileDeps, "casefileStore" | "syncStore"> = {}
): Promise<ReconciliationCasefileListResult> {
  const casefileStore = deps.casefileStore ?? defaultCasefileStore;
  const sync = await getDerivedSyncCheckpoint(RECONCILIATION_CASEFILE_SYNC_KEY, {
    syncStore: deps.syncStore,
  });

  const rows = await casefileStore.findMany({
    where: {
      ...(query.caseType ? { caseType: query.caseType } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.resolutionStatus ? { resolutionStatus: query.resolutionStatus } : {}),
      ...(query.truthStatus ? { truthStatus: query.truthStatus } : {}),
    },
    orderBy: { lastObservedAt: "desc" },
    take: sanitizeLimit(query.limit, 12, 48),
  });

  const cases = rows.map(serializeCasefile);

  return {
    syncedAt: sync?.lastCompletedAt ?? sync?.lastSuccessAt ?? null,
    summary: summarizeCasefiles(cases),
    cases,
    sync,
  };
}

export async function syncReconciliationCasefiles(
  deps: ReconciliationCasefileDeps = {}
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const casefileStore = deps.casefileStore ?? defaultCasefileStore;
  const getEvidence =
    deps.getEvidence ??
    ((query: { limit?: number; projectId?: string }) => getEvidenceLedgerOverview(query));
  const getFusion =
    deps.getFusion ??
    ((query: { limit?: number; projectId?: string }) => getEvidenceFusionOverview(query));
  const getGpsTruth = deps.getGpsTruth ?? (() => getGpsTelemetryTruthSnapshot());
  const getOneCTruth = deps.getOneCTruth ?? (() => getOneCFinanceTruthSnapshot());

  await markDerivedSyncStarted(RECONCILIATION_CASEFILE_SYNC_KEY, {
    now,
    syncStore: deps.syncStore,
  });

  try {
    const [evidence, fusion, gpsTruth, oneCTruth] = await Promise.all([
      deps.evidence ?? getEvidence({ limit: 100 }),
      deps.fusion ?? getFusion({ limit: 100 }),
      deps.gpsTruth ?? getGpsTruth(),
      deps.oneCTruth ?? getOneCTruth(),
    ]);

    const seeds = buildCasefileSeeds({
      evidence,
      fusion,
      gpsTruth,
      oneCTruth,
    });

    await Promise.all(
      seeds.map((seed) =>
        casefileStore.upsert({
          where: { key: seed.key },
          create: {
            id: randomUUID(),
            key: seed.key,
            ...toStoredCasefile(seed),
          },
          update: toStoredCasefile(seed),
        })
      )
    );

    if (seeds.length > 0) {
      await casefileStore.deleteMany({
        where: {
          key: {
            notIn: seeds.map((seed) => seed.key),
          },
        },
      });
    } else {
      await casefileStore.deleteMany({});
    }

    await markDerivedSyncSuccess(
      RECONCILIATION_CASEFILE_SYNC_KEY,
      {
        metadata: {
          evidenceCount: evidence.records.length,
          fusionFactCount: fusion.facts.length,
          gpsStatus: gpsTruth.status,
          oneCStatus: oneCTruth.status,
        },
        resultCount: seeds.length,
      },
      {
        now,
        syncStore: deps.syncStore,
      }
    );
  } catch (error) {
    await markDerivedSyncError(
      RECONCILIATION_CASEFILE_SYNC_KEY,
      error,
      {
        metadata: {
          lastBoundary: "casefile_derivation",
        },
      },
      {
        now,
        syncStore: deps.syncStore,
      }
    );
    throw error;
  }
}

function buildCasefileSeeds(input: {
  evidence: EvidenceListResult;
  fusion: EvidenceFusionOverview;
  gpsTruth: GpsTelemetryTruthSnapshot;
  oneCTruth: OneCFinanceTruthSnapshot;
}): CasefileSeed[] {
  const groups = buildProjectGroups(input);
  const telemetryCandidates = collectTelemetryCandidates(input);
  const unlinkedTelemetry = linkTelemetryCandidates(groups, telemetryCandidates);

  const seeds = [
    ...Array.from(groups.values()).map(toProjectCasefileSeed),
    ...unlinkedTelemetry.map(toTelemetryGapCasefileSeed),
  ];

  return seeds.sort(
    (left, right) => Date.parse(right.lastObservedAt) - Date.parse(left.lastObservedAt)
  );
}

function buildProjectGroups(input: {
  evidence: EvidenceListResult;
  fusion: EvidenceFusionOverview;
  oneCTruth: OneCFinanceTruthSnapshot;
}) {
  const groups = new Map<string, ProjectCaseAccumulator>();
  const financeProjects = input.oneCTruth.status === "ok" ? input.oneCTruth.projects : [];
  const fieldRecords = input.evidence.records.filter((record) => record.entityType === "work_report");

  for (const project of financeProjects) {
    const key = resolveProjectKey({
      projectId: null,
      projectName: project.projectName,
      fallbackId: project.projectId,
    });
    if (!key) continue;

    const group =
      groups.get(key) ??
      createProjectCaseAccumulator(key, project.projectName ?? project.projectId ?? "Unknown project");
    group.financeProject = project;
    group.financeProjectId = project.projectId;
    group.projectName = project.projectName ?? group.projectName;
    groups.set(key, group);
  }

  for (const record of fieldRecords) {
    const projectName = readMetadataString(record.metadata, "projectName");
    const key = resolveProjectKey({
      projectId: record.projectId,
      projectName,
      fallbackId: record.entityRef,
    });
    if (!key) continue;

    const group =
      groups.get(key) ??
      createProjectCaseAccumulator(key, projectName ?? record.projectId ?? "Unknown project");
    group.projectId = record.projectId ?? group.projectId;
    group.projectName = projectName ?? group.projectName;
    group.fieldRecords.push(record);
    groups.set(key, group);
  }

  for (const fact of input.fusion.facts) {
    const key = resolveProjectKey({
      projectId: fact.projectId,
      projectName: fact.projectName,
      fallbackId: fact.reportId,
    });
    if (!key) continue;

    const group =
      groups.get(key) ??
      createProjectCaseAccumulator(key, fact.projectName ?? fact.reportNumber ?? "Unknown project");
    group.projectId = fact.projectId ?? group.projectId;
    group.projectName = fact.projectName ?? group.projectName;
    group.fusionFacts.push(fact);
    groups.set(key, group);
  }

  return groups;
}

function collectTelemetryCandidates(input: {
  evidence: EvidenceListResult;
  fusion: EvidenceFusionOverview;
  gpsTruth: GpsTelemetryTruthSnapshot;
}): LinkedTelemetryGap[] {
  const matchedGpsEntityRefs = new Set(
    input.fusion.facts.flatMap((fact) =>
      fact.sources
        .filter((source) => source.entityType === "gps_session")
        .map((source) => source.entityRef)
    )
  );
  const gpsEvidenceRecords = input.evidence.records.filter((record) => record.entityType === "gps_session");

  const candidates =
    gpsEvidenceRecords.length > 0
      ? gpsEvidenceRecords
          .filter((record) => !matchedGpsEntityRefs.has(record.entityRef))
          .map((record) => ({
            key: [
              readMetadataString(record.metadata, "equipmentId") ?? "equipment",
              normalizeName(readMetadataString(record.metadata, "geofenceName")) ?? "geofence",
              record.observedAt.slice(0, 10),
            ].join("|"),
            entityRefs: [record.entityRef],
            equipmentIds: compactUnique([readMetadataString(record.metadata, "equipmentId")]),
            geofenceNames: compactUnique([readMetadataString(record.metadata, "geofenceName")]),
            observedAt: record.observedAt,
          }))
      : input.gpsTruth.status === "ok"
        ? input.gpsTruth.sessions
            .filter((session) => !matchedGpsEntityRefs.has(session.sessionId ?? session.sessionKey))
            .map((session) => ({
              key: [
                session.equipmentKey ?? session.equipmentId ?? "equipment",
                normalizeName(session.geofenceName) ?? session.geofenceKey ?? "geofence",
                (session.observedAt ?? input.gpsTruth.checkedAt).slice(0, 10),
              ].join("|"),
              entityRefs: [session.sessionId ?? session.sessionKey],
              equipmentIds: compactUnique([session.equipmentId]),
              geofenceNames: compactUnique([session.geofenceName]),
              observedAt: session.observedAt ?? input.gpsTruth.checkedAt,
            }))
        : [];

  return Array.from(
    candidates.reduce((groups, candidate) => {
      const existing = groups.get(candidate.key);
      if (!existing) {
        groups.set(candidate.key, candidate);
        return groups;
      }

      existing.entityRefs = compactUnique([...existing.entityRefs, ...candidate.entityRefs]);
      existing.equipmentIds = compactUnique([...existing.equipmentIds, ...candidate.equipmentIds]);
      existing.geofenceNames = compactUnique([...existing.geofenceNames, ...candidate.geofenceNames]);
      if (Date.parse(candidate.observedAt) > Date.parse(existing.observedAt)) {
        existing.observedAt = candidate.observedAt;
      }
      groups.set(candidate.key, existing);
      return groups;
    }, new Map<string, LinkedTelemetryGap>())
  ).map(([, value]) => value);
}

function linkTelemetryCandidates(
  groups: Map<string, ProjectCaseAccumulator>,
  candidates: LinkedTelemetryGap[]
) {
  const remaining: LinkedTelemetryGap[] = [];

  for (const candidate of candidates) {
    const project = findBestMatchingProject(groups, candidate);

    if (!project) {
      remaining.push(candidate);
      continue;
    }

    project.linkedTelemetry.push(candidate);
  }

  return remaining;
}

function findBestMatchingProject(
  groups: Map<string, ProjectCaseAccumulator>,
  candidate: LinkedTelemetryGap
) {
  const telemetrySurface = normalizeName(candidate.geofenceNames[0] ?? null);
  if (!telemetrySurface) {
    return null;
  }

  let best: ProjectCaseAccumulator | null = null;
  let bestScore = 0;

  for (const group of groups.values()) {
    const projectName = normalizeName(group.projectName);
    if (!projectName) {
      continue;
    }

    const score = countTokenOverlap(projectName, telemetrySurface);
    if (score > bestScore) {
      best = group;
      bestScore = score;
    }
  }

  return bestScore > 0 ? best : null;
}

function toProjectCasefileSeed(group: ProjectCaseAccumulator): CasefileSeed {
  const hasFinance = Boolean(group.financeProject);
  const hasField = group.fieldRecords.length > 0 || group.fusionFacts.length > 0;
  const hasTelemetryGap = group.linkedTelemetry.length > 0;
  const truthStatus: ReconciliationCaseTruthStatus =
    hasFinance && hasField && hasTelemetryGap
      ? "contradictory"
      : hasFinance && hasField
        ? "corroborated"
        : "partial";

  const reasonCodes = compactUnique([
    hasFinance ? "finance_present" : "finance_missing",
    hasField ? "field_present" : "field_missing",
    hasTelemetryGap ? "telemetry_unmatched" : "telemetry_clear",
    group.financeProject?.budgetDeltaStatus === "over_plan" ? "finance_over_plan" : null,
  ]);
  const resolutionStatus: ReconciliationCaseResolutionStatus =
    truthStatus === "corroborated" ? "resolved" : "open";
  const evidenceRecordIds = group.fieldRecords.map((record) => record.id);
  const fusionFactIds = group.fusionFacts.map((fact) => fact.id);
  const telemetryRefs = group.linkedTelemetry.flatMap((item) => item.entityRefs);
  const fieldLatestObservedAt =
    [...group.fieldRecords.map((record) => record.observedAt), ...group.fusionFacts.map((fact) => fact.observedAt)]
      .filter(Boolean)
      .sort(compareTimestampDesc)[0] ?? null;
  const latestObservedAt =
    [
      group.financeProject?.observedAt ?? group.financeProject?.reportDate ?? null,
      fieldLatestObservedAt,
      ...group.linkedTelemetry.map((item) => item.observedAt),
    ]
      .filter((value): value is string => Boolean(value))
      .sort(compareTimestampDesc)[0] ?? new Date().toISOString();

    return {
    key: `project:${group.key}`,
    caseType: "project_case",
    truthStatus,
    resolutionStatus,
    projectId: group.projectId,
    projectName: group.projectName,
    financeProjectId: group.financeProjectId,
    title: group.projectName,
    explanation: buildProjectCaseExplanation(group, truthStatus),
    reasonCodes,
    evidenceRecordIds,
    fusionFactIds,
    telemetryRefs,
    finance: group.financeProject
      ? {
          projectId: group.financeProject.projectId,
          projectName: group.financeProject.projectName,
          reportDate: group.financeProject.reportDate,
          variance: group.financeProject.variance,
          variancePercent: group.financeProject.variancePercent,
          budgetDeltaStatus: group.financeProject.budgetDeltaStatus,
        }
      : null,
    field: {
      reportCount: group.fieldRecords.length,
      fusedFactCount: group.fusionFacts.length,
      strongestVerificationStatus: deriveFieldVerificationStatus(
        group.fieldRecords,
        group.fusionFacts
      ),
      latestObservedAt: fieldLatestObservedAt,
    },
    telemetry: group.linkedTelemetry.length > 0
      ? {
          entityRefs: telemetryRefs,
          equipmentIds: compactUnique(
            group.linkedTelemetry.flatMap((item) => item.equipmentIds)
          ),
          geofenceNames: compactUnique(
            group.linkedTelemetry.flatMap((item) => item.geofenceNames)
          ),
          latestObservedAt:
            group.linkedTelemetry.map((item) => item.observedAt).sort(compareTimestampDesc)[0] ??
            null,
        }
      : null,
    lastObservedAt: latestObservedAt,
  };
}

function toTelemetryGapCasefileSeed(candidate: LinkedTelemetryGap): CasefileSeed {
  const title = [
    candidate.equipmentIds[0] ?? "Unknown equipment",
    candidate.geofenceNames[0] ?? "Unknown geofence",
  ].join(" · ");

  return {
    key: `telemetry:${candidate.key}`,
    caseType: "telemetry_gap",
    truthStatus: "partial",
    resolutionStatus: "open",
    projectId: null,
    projectName: null,
    financeProjectId: null,
    title,
    explanation: buildTelemetryOnlyExplanation(candidate),
    reasonCodes: ["telemetry_present", "finance_missing", "field_missing"],
    evidenceRecordIds: [],
    fusionFactIds: [],
    telemetryRefs: candidate.entityRefs,
    finance: null,
    field: null,
    telemetry: {
      entityRefs: candidate.entityRefs,
      equipmentIds: candidate.equipmentIds,
      geofenceNames: candidate.geofenceNames,
      latestObservedAt: candidate.observedAt,
    },
    lastObservedAt: candidate.observedAt,
  };
}

function toStoredCasefile(seed: CasefileSeed): CasefileWriteShape {
  return {
    caseType: seed.caseType,
    truthStatus: seed.truthStatus,
    resolutionStatus: seed.resolutionStatus,
    projectId: seed.projectId,
    projectName: seed.projectName,
    financeProjectId: seed.financeProjectId,
    title: seed.title,
    explanation: seed.explanation,
    reasonCodesJson: JSON.stringify(seed.reasonCodes),
    evidenceRecordIdsJson: JSON.stringify(seed.evidenceRecordIds),
    fusionFactIdsJson: JSON.stringify(seed.fusionFactIds),
    telemetryRefsJson: JSON.stringify(seed.telemetryRefs),
    financeJson: seed.finance ? JSON.stringify(seed.finance) : null,
    fieldJson: seed.field ? JSON.stringify(seed.field) : null,
    telemetryJson: seed.telemetry ? JSON.stringify(seed.telemetry) : null,
    lastObservedAt: new Date(seed.lastObservedAt),
    updatedAt: new Date(seed.lastObservedAt),
  };
}

function serializeCasefile(row: StoredReconciliationCasefile): ReconciliationCasefileView {
  return {
    id: row.id,
    key: row.key,
    caseType: normalizeCaseType(row.caseType),
    truthStatus: normalizeTruthStatus(row.truthStatus),
    resolutionStatus: normalizeResolutionStatus(row.resolutionStatus),
    projectId: row.projectId,
    projectName: row.projectName,
    financeProjectId: row.financeProjectId,
    title: row.title,
    explanation: row.explanation,
    reasonCodes: parseStringArray(row.reasonCodesJson),
    evidenceRecordIds: parseStringArray(row.evidenceRecordIdsJson),
    fusionFactIds: parseStringArray(row.fusionFactIdsJson),
    telemetryRefs: parseStringArray(row.telemetryRefsJson),
    finance: parseJsonObject<ReconciliationCaseFinanceView>(row.financeJson),
    field: parseJsonObject<ReconciliationCaseFieldView>(row.fieldJson),
    telemetry: parseJsonObject<ReconciliationCaseTelemetryView>(row.telemetryJson),
    lastObservedAt: row.lastObservedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function summarizeCasefiles(cases: ReconciliationCasefileView[]): ReconciliationCasefileSummary {
  return {
    total: cases.length,
    open: cases.filter((item) => item.resolutionStatus === "open").length,
    resolved: cases.filter((item) => item.resolutionStatus === "resolved").length,
    corroborated: cases.filter((item) => item.truthStatus === "corroborated").length,
    contradictory: cases.filter((item) => item.truthStatus === "contradictory").length,
    partial: cases.filter((item) => item.truthStatus === "partial").length,
    projectCases: cases.filter((item) => item.caseType === "project_case").length,
    telemetryGaps: cases.filter((item) => item.caseType === "telemetry_gap").length,
  };
}

function createProjectCaseAccumulator(key: string, projectName: string): ProjectCaseAccumulator {
  return {
    key,
    projectName,
    projectId: null,
    financeProjectId: null,
    financeProject: null,
    fieldRecords: [],
    fusionFacts: [],
    linkedTelemetry: [],
  };
}

function deriveFieldVerificationStatus(
  fieldRecords: EvidenceRecordView[],
  fusionFacts: EvidenceFusionFactView[]
): EvidenceVerificationStatus | "none" {
  const statuses = [
    ...fieldRecords.map((record) => record.verificationStatus),
    ...fusionFacts.map((fact) => fact.verificationStatus),
  ];

  if (statuses.includes("verified")) return "verified";
  if (statuses.includes("observed")) return "observed";
  if (statuses.includes("reported")) return "reported";
  return "none";
}

function buildProjectCaseExplanation(
  group: ProjectCaseAccumulator,
  truthStatus: ReconciliationCaseTruthStatus
) {
  const variancePart =
    group.financeProject?.variancePercent !== null && group.financeProject?.variancePercent !== undefined
      ? ` Finance variance is ${formatSignedPercent(group.financeProject.variancePercent)}.`
      : "";

  if (truthStatus === "contradictory") {
    return `Finance and field evidence are both present for this project, but unresolved telemetry still points to activity on the same project surface.${variancePart}`;
  }

  if (truthStatus === "corroborated") {
    if (group.fusionFacts.length > 0) {
      return `Finance, field evidence, and fused corroboration are all present for this project.${variancePart}`;
    }

    return `Finance and field evidence are both present for this project.${variancePart}`;
  }

  if (group.financeProject) {
    return `1C finance is present, but field evidence has not linked into the same reconciliation case yet.${variancePart}`;
  }

  return `Field evidence is present, but no 1C financial truth linked into the same reconciliation case yet.`;
}

function buildTelemetryOnlyExplanation(candidate: LinkedTelemetryGap) {
  const equipment = candidate.equipmentIds[0] ?? "Unknown equipment";
  const geofence = candidate.geofenceNames[0] ?? "unknown geofence";
  return `${equipment} reported activity in ${geofence} at ${formatTimestamp(candidate.observedAt)}, but no finance or field evidence linked to the same surface yet.`;
}

function normalizeCaseType(value: string): ReconciliationCaseType {
  return value === "telemetry_gap" ? "telemetry_gap" : "project_case";
}

function normalizeTruthStatus(value: string): ReconciliationCaseTruthStatus {
  switch (value) {
    case "corroborated":
    case "contradictory":
      return value;
    case "partial":
    default:
      return "partial";
  }
}

function normalizeResolutionStatus(value: string): ReconciliationCaseResolutionStatus {
  return value === "resolved" ? "resolved" : "open";
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as T;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveProjectKey(input: {
  projectId: string | null;
  projectName: string | null;
  fallbackId?: string | null;
}) {
  const normalizedName = normalizeName(input.projectName);
  if (normalizedName) {
    return `name:${normalizedName}`;
  }
  if (input.projectId) {
    return `project:${input.projectId}`;
  }
  if (input.fallbackId) {
    return `fallback:${input.fallbackId}`;
  }
  return null;
}

function normalizeName(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

  return normalized || null;
}

function countTokenOverlap(left: string, right: string) {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length >= 4));
  const rightTokens = new Set(right.split(" ").filter((token) => token.length >= 4));
  let overlap = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function readMetadataString(metadata: EvidenceRecordView["metadata"], key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactUnique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function sanitizeLimit(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value) || value === undefined) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(value), 1), max);
}

function compareTimestampDesc(left: string, right: string) {
  return Date.parse(right) - Date.parse(left);
}

function formatSignedPercent(value: number) {
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  const rounded = Math.round(normalized);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}
