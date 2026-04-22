import type {
  GpsTelemetrySample,
  GpsTelemetrySampleSnapshot,
} from "@/lib/connectors/gps-client";
import { getGpsTelemetrySampleSnapshot } from "@/lib/connectors/gps-client";
import type {
  OneCFinanceSampleSnapshot,
  OneCProjectFinanceSample,
} from "@/lib/connectors/one-c-client";
import { getOneCFinanceSampleSnapshot } from "@/lib/connectors/one-c-client";
import type {
  EvidenceFusionOverview,
  EvidenceListResult,
  EvidenceRecordView,
  EvidenceVerificationStatus,
} from "@/lib/evidence";
import {
  getEvidenceFusionOverview,
  getEvidenceLedgerOverview,
} from "@/lib/evidence";

import type {
  EnterpriseTruthOverview,
  EnterpriseTruthProjectStatus,
  EnterpriseTruthProjectView,
  EnterpriseTruthQuery,
  EnterpriseTruthTelemetryGapView,
} from "./types";

interface EnterpriseTruthDeps {
  evidence?: EvidenceListResult;
  fusion?: EvidenceFusionOverview;
  gpsSample?: GpsTelemetrySampleSnapshot;
  oneCSample?: OneCFinanceSampleSnapshot;
  getEvidence?: (query: { limit?: number; projectId?: string }) => Promise<EvidenceListResult>;
  getFusion?: (query: { limit?: number; projectId?: string }) => Promise<EvidenceFusionOverview>;
  getGpsSample?: () => Promise<GpsTelemetrySampleSnapshot>;
  getOneCSample?: () => Promise<OneCFinanceSampleSnapshot>;
  now?: () => Date;
}

interface ProjectAccumulator {
  key: string;
  projectName: string;
  projectId: string | null;
  financeProjectId: string | null;
  financeSample: OneCProjectFinanceSample | null;
  fieldRecords: EvidenceRecordView[];
  fusionFacts: EvidenceFusionOverview["facts"];
}

export async function getEnterpriseTruthOverview(
  query: EnterpriseTruthQuery = {},
  deps: EnterpriseTruthDeps = {}
): Promise<EnterpriseTruthOverview> {
  const now = deps.now ?? (() => new Date());
  const getEvidence =
    deps.getEvidence ??
    ((input: { limit?: number; projectId?: string }) => getEvidenceLedgerOverview(input));
  const getFusion =
    deps.getFusion ??
    ((input: { limit?: number; projectId?: string }) => getEvidenceFusionOverview(input));
  const getGpsSample = deps.getGpsSample ?? (() => getGpsTelemetrySampleSnapshot());
  const getOneCSample = deps.getOneCSample ?? (() => getOneCFinanceSampleSnapshot());

  const safeLimit = sanitizeLimit(query.limit, 6, 12);
  const safeTelemetryLimit = sanitizeLimit(query.telemetryLimit, 4, 12);
  const evidenceLimit = Math.max(safeLimit * 6, 24);

  const [evidence, fusion, gpsSample, oneCSample] = await Promise.all([
    deps.evidence ??
      getEvidence({
        limit: evidenceLimit,
        ...(query.projectId ? { projectId: query.projectId } : {}),
      }),
    deps.fusion ??
      getFusion({
        limit: evidenceLimit,
        ...(query.projectId ? { projectId: query.projectId } : {}),
      }),
    deps.gpsSample ?? getGpsSample(),
    deps.oneCSample ?? getOneCSample(),
  ]);

  const projectViews = buildEnterpriseTruthProjects({
    evidence,
    fusion,
    oneCSample,
    projectId: query.projectId,
  }).slice(0, safeLimit);
  const telemetryGaps = buildEnterpriseTelemetryGaps({
    evidence,
    fusion,
    gpsSample,
  }).slice(0, safeTelemetryLimit);

  return {
    syncedAt: resolveSyncedAt(now(), evidence.syncedAt, fusion.syncedAt, gpsSample.checkedAt, oneCSample.checkedAt),
    summary: {
      totalProjects: projectViews.length,
      corroborated: projectViews.filter((item) => item.status === "corroborated").length,
      fieldOnly: projectViews.filter((item) => item.status === "field_only").length,
      financeOnly: projectViews.filter((item) => item.status === "finance_only").length,
      telemetryGaps: telemetryGaps.length,
      largestVarianceProject: projectViews.reduce<string | null>((selected, item) => {
        const current = Math.abs(item.finance.variancePercent ?? 0);
        const previous = projectViews.find((candidate) => candidate.projectName === selected);
        const previousValue = Math.abs(previous?.finance.variancePercent ?? 0);
        return current > previousValue ? item.projectName : selected;
      }, null),
    },
    projects: projectViews,
    telemetryGaps,
  };
}

function buildEnterpriseTruthProjects(input: {
  evidence: EvidenceListResult;
  fusion: EvidenceFusionOverview;
  oneCSample: OneCFinanceSampleSnapshot;
  projectId?: string;
}): EnterpriseTruthProjectView[] {
  const fieldRecords = input.evidence.records.filter((record) => record.entityType === "work_report");
  const fusionFacts = input.fusion.facts;
  const financeSamples = input.oneCSample.status === "ok" ? input.oneCSample.samples : [];
  const groups = new Map<string, ProjectAccumulator>();

  for (const sample of financeSamples) {
    const key = resolveProjectKey({
      projectId: null,
      projectName: sample.projectName,
      fallbackId: sample.projectId,
    });
    if (!key) continue;
    const group = groups.get(key) ?? createProjectAccumulator(key, sample.projectName ?? sample.projectId ?? "Unknown project");
    if (!group.financeSample || compareDates(sample.reportDate, group.financeSample.reportDate) >= 0) {
      group.financeSample = sample;
      group.financeProjectId = sample.projectId;
      group.projectName = sample.projectName ?? group.projectName;
    }
    groups.set(key, group);
  }

  for (const record of fieldRecords) {
    const projectName = readProjectNameFromEvidence(record);
    const key = resolveProjectKey({
      projectId: record.projectId,
      projectName,
      fallbackId: record.entityRef,
    });
    if (!key) continue;
    const group = groups.get(key) ?? createProjectAccumulator(key, projectName ?? record.projectId ?? "Unknown project");
    group.projectId = record.projectId ?? group.projectId;
    group.projectName = projectName ?? group.projectName;
    group.fieldRecords.push(record);
    groups.set(key, group);
  }

  for (const fact of fusionFacts) {
    const key = resolveProjectKey({
      projectId: fact.projectId,
      projectName: fact.projectName,
      fallbackId: fact.reportId,
    });
    if (!key) continue;
    const group = groups.get(key) ?? createProjectAccumulator(key, fact.projectName ?? fact.reportNumber ?? "Unknown project");
    group.projectId = fact.projectId ?? group.projectId;
    group.projectName = fact.projectName ?? group.projectName;
    group.fusionFacts.push(fact);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .filter((group) => !input.projectId || group.projectId === input.projectId)
    .map((group) => toEnterpriseProjectView(group))
    .sort(compareEnterpriseProjects);
}

function buildEnterpriseTelemetryGaps(input: {
  evidence: EvidenceListResult;
  fusion: EvidenceFusionOverview;
  gpsSample: GpsTelemetrySampleSnapshot;
}): EnterpriseTruthTelemetryGapView[] {
  const matchedGpsEntityRefs = new Set(
    input.fusion.facts.flatMap((fact) =>
      fact.sources
        .filter((source) => source.entityType === "gps_session")
        .map((source) => source.entityRef)
    )
  );
  const gpsEvidenceRecords = input.evidence.records.filter((record) => record.entityType === "gps_session");
  const telemetryRecords =
    gpsEvidenceRecords.length > 0
      ? gpsEvidenceRecords
          .filter((record) => !matchedGpsEntityRefs.has(record.entityRef))
          .map((record) => ({
            id: `telemetry-gap:${record.entityRef}`,
            equipmentId: readMetadataString(record.metadata, "equipmentId"),
            geofenceName: readMetadataString(record.metadata, "geofenceName"),
            observedAt: record.observedAt,
            confidence: record.confidence,
            explanation: buildTelemetryGapExplanation({
              equipmentId: readMetadataString(record.metadata, "equipmentId"),
              geofenceName: readMetadataString(record.metadata, "geofenceName"),
              observedAt: record.observedAt,
            }),
          }))
      : input.gpsSample.status === "ok"
        ? input.gpsSample.samples.map((sample, index) =>
            buildTelemetryGapFromSample(sample, input.gpsSample.checkedAt, index)
          )
        : [];

  return Array.from(
    telemetryRecords.reduce((groups, record) => {
      const key = [
        record.equipmentId ?? "equipment",
        normalizeProjectName(record.geofenceName) ?? "geofence",
        record.observedAt.slice(0, 10),
      ].join("|");
      const current = groups.get(key);

      if (!current || Date.parse(record.observedAt) > Date.parse(current.observedAt)) {
        groups.set(key, record);
      }

      return groups;
    }, new Map<string, EnterpriseTruthTelemetryGapView>())
  )
    .map(([, record]) => record)
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt));
}

function toEnterpriseProjectView(group: ProjectAccumulator): EnterpriseTruthProjectView {
  const strongestFieldStatus = deriveFieldVerificationStatus(group.fieldRecords, group.fusionFacts);
  const latestObservedAt = [group.fieldRecords.map((record) => record.observedAt), group.fusionFacts.map((fact) => fact.observedAt)]
    .flat()
    .filter(Boolean)
    .sort(compareTimestampsDesc)[0] ?? null;
  const status = deriveProjectStatus(group);
  const variance = group.financeSample?.variance ?? null;
  const variancePercent = normalizeVariancePercent(group.financeSample?.variancePercent ?? null);

  return {
    id: `enterprise-truth:${group.key}`,
    projectId: group.projectId,
    projectName: group.projectName,
    financeProjectId: group.financeProjectId,
    status,
    finance: {
      sample: group.financeSample,
      variance,
      variancePercent,
      reportDate: group.financeSample?.reportDate ?? null,
    },
    field: {
      reportCount: group.fieldRecords.length,
      fusedFactCount: group.fusionFacts.length,
      strongestVerificationStatus: strongestFieldStatus,
      latestObservedAt,
    },
    explanation: buildProjectExplanation(group, status, strongestFieldStatus),
  };
}

function deriveProjectStatus(group: ProjectAccumulator): EnterpriseTruthProjectStatus {
  const hasFinance = Boolean(group.financeSample);
  const hasField = group.fieldRecords.length > 0 || group.fusionFacts.length > 0;

  if (hasFinance && hasField) {
    return "corroborated";
  }
  if (hasFinance) {
    return "finance_only";
  }
  return "field_only";
}

function deriveFieldVerificationStatus(
  fieldRecords: EvidenceRecordView[],
  fusionFacts: EvidenceFusionOverview["facts"]
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

function buildProjectExplanation(
  group: ProjectAccumulator,
  status: EnterpriseTruthProjectStatus,
  fieldStatus: EvidenceVerificationStatus | "none"
) {
  const finance = group.financeSample;
  const variancePart =
    finance?.variancePercent !== null && finance?.variancePercent !== undefined
      ? ` Finance variance is ${formatSignedPercent(finance.variancePercent)}.`
      : "";

  if (status === "corroborated") {
    const corroboration =
      group.fusionFacts.length > 0
        ? `${group.fusionFacts.length} fused field fact${group.fusionFacts.length === 1 ? "" : "s"} already corroborate the project.`
        : `${group.fieldRecords.length} work report evidence record${group.fieldRecords.length === 1 ? "" : "s"} support the project context.`;
    return `1C finance and field evidence are both present for this project. ${corroboration}${variancePart}`;
  }

  if (status === "finance_only") {
    return `1C finance is present, but no field evidence matched this project in the current ledger window.${variancePart}`;
  }

  return `Field evidence is present with ${fieldStatus} confidence, but no 1C finance sample matched the project name in the current read window.`;
}

function buildTelemetryGapFromSample(
  sample: GpsTelemetrySample,
  fallbackObservedAt: string,
  index: number
): EnterpriseTruthTelemetryGapView {
  return {
    id: `telemetry-gap:${sample.sessionId ?? index}`,
    equipmentId: sample.equipmentId,
    geofenceName: sample.geofenceName,
    observedAt: sample.endedAt ?? sample.startedAt ?? fallbackObservedAt,
    confidence: null,
    explanation: buildTelemetryGapExplanation({
      equipmentId: sample.equipmentId,
      geofenceName: sample.geofenceName,
      observedAt: sample.endedAt ?? sample.startedAt ?? fallbackObservedAt,
    }),
  };
}

function buildTelemetryGapExplanation(input: {
  equipmentId: string | null;
  geofenceName: string | null;
  observedAt: string;
}) {
  const equipment = input.equipmentId ?? "Unknown equipment";
  const geofence = input.geofenceName ?? "unknown geofence";
  return `${equipment} reported activity in ${geofence} at ${formatTimestamp(input.observedAt)}, but no corroborating work report or fused field fact matched it yet.`;
}

function createProjectAccumulator(key: string, projectName: string): ProjectAccumulator {
  return {
    key,
    projectName,
    projectId: null,
    financeProjectId: null,
    financeSample: null,
    fieldRecords: [],
    fusionFacts: [],
  };
}

function resolveProjectKey(input: {
  projectId: string | null;
  projectName: string | null;
  fallbackId?: string | null;
}) {
  const normalizedName = normalizeProjectName(input.projectName);
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

function readProjectNameFromEvidence(record: EvidenceRecordView) {
  return readMetadataString(record.metadata, "projectName");
}

function normalizeProjectName(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || null;
}

function readMetadataString(
  metadata: EvidenceRecordView["metadata"],
  key: string
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compareEnterpriseProjects(left: EnterpriseTruthProjectView, right: EnterpriseTruthProjectView) {
  const statusDiff = projectStatusPriority(left.status) - projectStatusPriority(right.status);
  if (statusDiff !== 0) {
    return statusDiff;
  }

  const varianceDiff = Math.abs(right.finance.variancePercent ?? 0) - Math.abs(left.finance.variancePercent ?? 0);
  if (varianceDiff !== 0) {
    return varianceDiff;
  }

  return compareTimestampsDesc(left.field.latestObservedAt, right.field.latestObservedAt);
}

function projectStatusPriority(status: EnterpriseTruthProjectStatus) {
  switch (status) {
    case "finance_only":
      return 0;
    case "field_only":
      return 1;
    case "corroborated":
    default:
      return 2;
  }
}

function compareDates(left: string | null, right: string | null) {
  return Date.parse(left ?? "") - Date.parse(right ?? "");
}

function compareTimestampsDesc(left: string | null, right: string | null) {
  return Date.parse(right ?? "") - Date.parse(left ?? "");
}

function resolveSyncedAt(now: Date, ...values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort(compareTimestampsDesc)[0] ?? now.toISOString();
}

function sanitizeLimit(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), max);
}

function formatSignedPercent(value: number) {
  const rounded = Math.round(normalizeVariancePercent(value) ?? 0);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

function normalizeVariancePercent(value: number | null) {
  if (value === null) {
    return null;
  }

  return Math.abs(value) <= 1 ? value * 100 : value;
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
