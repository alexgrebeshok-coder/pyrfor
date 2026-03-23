import { buildAIChatContextBundle, type AIChatContextBundle, type AIChatContextInput } from "@/lib/ai/context-builder";
import { buildMockExecutiveSnapshot, loadExecutiveSnapshot } from "@/lib/briefs/snapshot";
import type { ExecutiveSnapshot } from "@/lib/briefs/types";
import { summarizeEvidenceRecords } from "@/lib/evidence/service";
import type { EvidenceListResult, EvidenceQuery, EvidenceRecordView } from "@/lib/evidence/types";
import { logger } from "@/lib/logger";

export type DemoSnapshotSource = "live" | "mock";

export interface DemoSnapshotResult {
  source: DemoSnapshotSource;
  snapshot: ExecutiveSnapshot;
}

export async function loadDemoSnapshot(
  filter: { generatedAt?: string | Date; projectId?: string } = {}
): Promise<DemoSnapshotResult> {
  try {
    const snapshot = await loadExecutiveSnapshot(filter);

    if (snapshot.projects.length > 0) {
      return {
        snapshot,
        source: "live",
      };
    }

    const mockSnapshot = await buildMockExecutiveSnapshot(filter);
    if (mockSnapshot.projects.length > 0) {
      logger.warn("[Demo] Live snapshot was empty; using mock snapshot fallback.");
      return {
        snapshot: mockSnapshot,
        source: "mock",
      };
    }

    return {
      snapshot,
      source: "live",
    };
  } catch (error) {
    const mockSnapshot = await buildMockExecutiveSnapshot(filter);

    if (mockSnapshot.projects.length > 0) {
      logger.warn("[Demo] Snapshot load failed; using mock snapshot fallback.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        snapshot: mockSnapshot,
        source: "mock",
      };
    }

    throw error;
  }
}

export async function buildDemoChatContext(
  input: AIChatContextInput
): Promise<AIChatContextBundle & { source: DemoSnapshotSource }> {
  const snapshotResult = await loadDemoSnapshot({ projectId: input.projectId });

  const bundle = await buildAIChatContextBundle(input, {
    loadSnapshot: async () => snapshotResult.snapshot,
    loadEvidence: async (query) => buildDemoEvidenceOverview(snapshotResult.snapshot, query),
  });

  return {
    ...bundle,
    source: snapshotResult.source,
  };
}

async function buildDemoEvidenceOverview(
  snapshot: ExecutiveSnapshot,
  query: EvidenceQuery = {}
): Promise<EvidenceListResult> {
  const projectLookup = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const selectedWorkReports = snapshot.workReports.filter((report) =>
    query.projectId ? report.projectId === query.projectId : true
  );

  const records = selectedWorkReports
    .filter((report) => report.status !== "rejected")
    .map<EvidenceRecordView>((report) => ({
      id: report.id,
      sourceType: `work_report:${report.source}`,
      sourceRef: report.reportNumber,
      entityType: "work_report",
      entityRef: report.id,
      projectId: report.projectId,
      title: `${report.reportNumber} · ${report.status}`,
      summary: buildEvidenceSummary(report, projectLookup.get(report.projectId) ?? null),
      observedAt: report.reviewedAt ?? report.submittedAt,
      reportedAt: report.submittedAt,
      confidence: report.status === "approved" ? 0.82 : 0.58,
      verificationStatus: report.status === "approved" ? "verified" : "reported",
      metadata: {
        projectName: projectLookup.get(report.projectId) ?? null,
        reportDate: report.reportDate,
        reportNumber: report.reportNumber,
        reportStatus: report.status,
        source: report.source,
        section: null,
      },
      createdAt: report.submittedAt,
      updatedAt: report.reviewedAt ?? report.submittedAt,
    }))
    .slice(0, sanitizeLimit(query.limit));

  return {
    syncedAt: snapshot.generatedAt,
    summary: summarizeEvidenceRecords(records),
    records,
    sync: null,
  };
}

function buildEvidenceSummary(report: ExecutiveSnapshot["workReports"][number], projectName: string | null) {
  const parts = [
    report.reportNumber,
    projectName ? `project ${projectName}` : null,
    report.status,
    report.source,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" · ");
}

function sanitizeLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return 5;
  }

  return Math.min(Math.max(Math.trunc(limit), 1), 12);
}
