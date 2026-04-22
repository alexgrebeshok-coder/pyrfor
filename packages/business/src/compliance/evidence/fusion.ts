import { getEvidenceLedgerOverview } from "@/lib/evidence/service";

import type {
  EvidenceFusionFactView,
  EvidenceFusionOverview,
  EvidenceFusionQuery,
  EvidenceFusionSourceView,
  EvidenceListResult,
  EvidenceMetadata,
  EvidenceQuery,
  EvidenceRecordView,
  EvidenceVerificationStatus,
} from "./types";

interface EvidenceFusionDeps {
  evidence?: EvidenceListResult;
  getEvidence?: (query: EvidenceQuery) => Promise<EvidenceListResult>;
  now?: () => Date;
}

interface SupportMatch {
  matchReasons: string[];
  record: EvidenceRecordView;
  weight: number;
}

const GPS_MATCH_STOP_WORDS = new Set([
  "zone",
  "work",
  "report",
  "manual",
  "shift",
  "site",
  "area",
  "the",
  "and",
  "для",
  "зона",
  "работ",
  "работы",
  "смена",
]);

export async function getEvidenceFusionOverview(
  query: EvidenceFusionQuery = {},
  deps: EvidenceFusionDeps = {}
): Promise<EvidenceFusionOverview> {
  const now = deps.now ?? (() => new Date());
  const getEvidence = deps.getEvidence ?? getEvidenceLedgerOverview;
  const evidence =
    deps.evidence ??
    (await getEvidence({
      limit: deriveLedgerLimit(query.limit),
      ...(query.projectId ? { projectId: query.projectId } : {}),
    }));

  const facts = buildEvidenceFusionFacts(evidence.records)
    .filter((fact) => {
      if (query.projectId && fact.projectId !== query.projectId) {
        return false;
      }
      if (query.verificationStatus && fact.verificationStatus !== query.verificationStatus) {
        return false;
      }
      return true;
    })
    .slice(0, sanitizeLimit(query.limit));

  return {
    syncedAt: evidence.syncedAt ?? now().toISOString(),
    summary: summarizeFusionFacts(facts),
    facts,
  };
}

export function buildEvidenceFusionFacts(
  records: EvidenceRecordView[]
): EvidenceFusionFactView[] {
  const workReports = records.filter((record) => record.entityType === "work_report");
  const videoFacts = records.filter((record) => record.entityType === "video_fact");
  const gpsSessions = records.filter((record) => record.entityType === "gps_session");

  return workReports
    .map((report) => buildFusionFact(report, videoFacts, gpsSessions))
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      return Date.parse(right.observedAt) - Date.parse(left.observedAt);
    });
}

function buildFusionFact(
  report: EvidenceRecordView,
  videoFacts: EvidenceRecordView[],
  gpsSessions: EvidenceRecordView[]
): EvidenceFusionFactView {
  const reportMetadata = report.metadata;
  const projectName = readMetadataString(reportMetadata, "projectName");
  const section = readMetadataString(reportMetadata, "section");
  const reportDate = readMetadataString(reportMetadata, "reportDate");
  const reportNumber =
    readMetadataString(reportMetadata, "reportNumber") ?? report.sourceRef ?? report.entityRef;
  const videoMatches = videoFacts
    .map((record) => matchVideoFactToReport(report, record))
    .filter((match): match is SupportMatch => match !== null);
  const gpsMatches = gpsSessions
    .map((record) => matchGpsSessionToReport(report, record))
    .filter((match): match is SupportMatch => match !== null);
  const supportMatches = [...videoMatches, ...gpsMatches];
  const confidence = mergeConfidence(report, supportMatches);
  const verificationStatus = deriveFusionStatus(report, supportMatches);
  const sources = [
    toFusionSource(report, ["anchor_work_report"]),
    ...supportMatches.map((match) => toFusionSource(match.record, match.matchReasons)),
  ];
  const observedAt = sources.reduce(
    (latest, source) => (Date.parse(source.observedAt) > Date.parse(latest) ? source.observedAt : latest),
    report.observedAt
  );

  return {
    id: `fusion:${report.entityRef}`,
    projectId: report.projectId,
    projectName,
    title: report.title,
    reportId: report.entityRef,
    reportNumber,
    reportDate,
    section,
    observedAt,
    confidence,
    verificationStatus,
    explanation: buildExplanation(report, supportMatches, verificationStatus, confidence),
    sourceCount: sources.length,
    sources,
  };
}

function matchVideoFactToReport(
  report: EvidenceRecordView,
  record: EvidenceRecordView
): SupportMatch | null {
  const videoReportId = readMetadataString(record.metadata, "reportId");

  if (!videoReportId || videoReportId !== report.entityRef) {
    return null;
  }

  const matchReasons = ["linked_report"];
  const reportDate = readMetadataString(report.metadata, "reportDate");
  const videoDate = readMetadataString(record.metadata, "reportDate") ?? record.observedAt;

  if (isSameUtcDay(reportDate ?? report.observedAt, videoDate)) {
    matchReasons.push("same_report_day");
  }

  const reportSection = readMetadataString(report.metadata, "section");
  const videoSection = readMetadataString(record.metadata, "section");

  if (reportSection && videoSection && reportSection === videoSection) {
    matchReasons.push("same_section");
  }

  return {
    record,
    matchReasons,
    weight: record.verificationStatus === "verified" ? 0.65 : 0.55,
  };
}

function matchGpsSessionToReport(
  report: EvidenceRecordView,
  record: EvidenceRecordView
): SupportMatch | null {
  const reportDate = readMetadataString(report.metadata, "reportDate");

  if (!isSameUtcDay(reportDate ?? report.observedAt, record.observedAt)) {
    return null;
  }

  const matchReasons = ["same_report_day"];
  const reportTokens = buildTokenSet([
    report.title,
    report.summary,
    readMetadataString(report.metadata, "projectName"),
    readMetadataString(report.metadata, "section"),
    readMetadataString(report.metadata, "equipment"),
    readMetadataString(report.metadata, "workDescription"),
  ]);
  const gpsLocationTokens = buildTokenSet([
    record.title,
    record.summary,
    readMetadataString(record.metadata, "geofenceName"),
    readMetadataString(record.metadata, "geofenceId"),
  ]);
  const gpsEquipmentTokens = buildTokenSet([
    readMetadataString(record.metadata, "equipmentId"),
    readMetadataString(record.metadata, "equipmentType"),
  ]);
  const reportEquipmentTokens = buildTokenSet([
    readMetadataString(report.metadata, "equipment"),
  ]);

  if (hasTokenOverlap(reportTokens, gpsLocationTokens)) {
    matchReasons.push("location_overlap");
  }

  if (hasTokenOverlap(reportEquipmentTokens, gpsEquipmentTokens)) {
    matchReasons.push("equipment_overlap");
  }

  if (matchReasons.length === 1) {
    return null;
  }

  return {
    record,
    matchReasons,
    weight: matchReasons.length >= 3 ? 0.55 : 0.45,
  };
}

function deriveFusionStatus(
  report: EvidenceRecordView,
  supports: SupportMatch[]
): EvidenceVerificationStatus {
  if (report.verificationStatus === "verified") {
    return "verified";
  }

  const supportingTypes = new Set(supports.map((support) => support.record.entityType));

  if (supportingTypes.has("video_fact") && supportingTypes.has("gps_session")) {
    return "verified";
  }

  if (supportingTypes.size > 0) {
    return "observed";
  }

  return report.verificationStatus;
}

function mergeConfidence(
  report: EvidenceRecordView,
  supports: SupportMatch[]
): number {
  let confidence = report.confidence;

  for (const support of supports) {
    confidence =
      confidence +
      (1 - confidence) * Math.min(support.record.confidence * support.weight, 0.7);
  }

  return round(Math.min(confidence, 0.98), 2);
}

function toFusionSource(
  record: EvidenceRecordView,
  matchReasons: string[]
): EvidenceFusionSourceView {
  return {
    recordId: record.id,
    sourceType: record.sourceType,
    entityType: record.entityType,
    entityRef: record.entityRef,
    title: record.title,
    confidence: record.confidence,
    verificationStatus: record.verificationStatus,
    observedAt: record.observedAt,
    matchReasons,
  };
}

function buildExplanation(
  report: EvidenceRecordView,
  supports: SupportMatch[],
  verificationStatus: EvidenceVerificationStatus,
  confidence: number
) {
  const reportNumber =
    readMetadataString(report.metadata, "reportNumber") ?? report.sourceRef ?? report.entityRef;

  if (supports.length === 0) {
    return `${reportNumber} currently relies on the work report alone, so the rollup stays ${verificationStatus} at ${formatPercent(confidence)} confidence.`;
  }

  const sourceLabels = Array.from(
    new Set(
      supports.map((support) =>
        support.record.entityType === "video_fact" ? "visual evidence" : "GPS telemetry"
      )
    )
  );

  return `${reportNumber} is ${verificationStatus} because ${sourceLabels.join(" and ")} corroborate the work-report claim on the same operating window. Rollup confidence is ${formatPercent(confidence)}.`;
}

function summarizeFusionFacts(facts: EvidenceFusionFactView[]) {
  if (facts.length === 0) {
    return {
      total: 0,
      reported: 0,
      observed: 0,
      verified: 0,
      averageConfidence: null,
      strongestFactTitle: null,
    };
  }

  const summary = facts.reduce(
    (accumulator, fact) => {
      accumulator.total += 1;
      accumulator[fact.verificationStatus] += 1;
      accumulator.confidenceTotal += fact.confidence;
      if (!accumulator.strongestFact || fact.confidence > accumulator.strongestFact.confidence) {
        accumulator.strongestFact = fact;
      }
      return accumulator;
    },
    {
      total: 0,
      reported: 0,
      observed: 0,
      verified: 0,
      confidenceTotal: 0,
      strongestFact: null as EvidenceFusionFactView | null,
    }
  );

  return {
    total: summary.total,
    reported: summary.reported,
    observed: summary.observed,
    verified: summary.verified,
    averageConfidence: round(summary.confidenceTotal / summary.total, 2),
    strongestFactTitle: summary.strongestFact?.title ?? null,
  };
}

function deriveLedgerLimit(limit: number | undefined) {
  const safeLimit = sanitizeLimit(limit);
  return Math.max(safeLimit * 4, 24);
}

function sanitizeLimit(limit: number | undefined) {
  if (!Number.isFinite(limit)) {
    return 6;
  }

  return Math.min(Math.max(Math.trunc(limit ?? 6), 1), 12);
}

function readMetadataString(metadata: EvidenceMetadata, key: string) {
  const value = metadata[key];
  if (value === null || value === undefined) {
    return null;
  }
  return String(value);
}

function buildTokenSet(values: Array<string | null>) {
  return new Set(
    values
      .flatMap((value) => tokenize(value))
      .filter((token) => !GPS_MATCH_STOP_WORDS.has(token))
  );
}

function tokenize(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3);
}

function hasTokenOverlap(left: Set<string>, right: Set<string>) {
  for (const token of left) {
    if (right.has(token)) {
      return true;
    }
  }
  return false;
}

function isSameUtcDay(left: string, right: string) {
  return left.slice(0, 10) === right.slice(0, 10);
}

function round(value: number, precision: number) {
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
