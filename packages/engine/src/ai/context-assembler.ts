import { buildAlertFeed } from "@/lib/alerts/scoring";
import {
  resolveBriefLocale,
  type BriefLocale,
} from "@/lib/briefs/locale";
import {
  buildMockExecutiveSnapshot,
  loadExecutiveSnapshot,
} from "@/lib/briefs/snapshot";
import type {
  AlertFeed,
  ExecutiveProject,
  ExecutiveSnapshot,
  ExecutiveWorkReport,
} from "@/lib/briefs/types";
import {
  summarizeEvidenceRecords,
} from "@/lib/evidence/service";
import type {
  EvidenceListResult,
  EvidenceQuery,
  EvidenceRecordView,
} from "@/lib/evidence/types";
import { logger } from "@/lib/logger";
import {
  prismaMemoryManager,
  type MemoryEntry as PrismaMemoryEntry,
} from "@/lib/memory/prisma-memory-manager";
import {
  buildPortfolioPlanFactSummary,
  buildProjectPlanFactSummary,
} from "@/lib/plan-fact/service";
import type {
  PortfolioPlanFactSummary,
  ProjectPlanFactSummary,
} from "@/lib/plan-fact/types";
import type { Locale } from "@/lib/translations";

export interface ContextAssemblerInput {
  projectId?: string;
  locale?: string;
  interfaceLocale?: string;
  includeEvidence?: boolean;
  includeMemory?: boolean;
}

export interface ContextAssemblerDeps {
  loadSnapshot?: (filter?: {
    generatedAt?: string | Date;
    projectId?: string;
  }) => Promise<ExecutiveSnapshot>;
  loadMockSnapshot?: (filter?: {
    generatedAt?: string | Date;
    projectId?: string;
  }) => Promise<ExecutiveSnapshot>;
  loadEvidence?: (query?: EvidenceQuery) => Promise<EvidenceListResult>;
  loadMemory?: (projectId: string | null) => Promise<PrismaMemoryEntry[]>;
}

export interface ContextAssemblerIssue {
  source: "memory";
  message: string;
}

export interface ContextAssemblerResult {
  source: "live" | "mock";
  scope: "portfolio" | "project";
  generatedAt: string;
  locale: BriefLocale;
  interfaceLocale: Locale;
  projectId: string | null;
  project: ExecutiveProject | null;
  snapshot: ExecutiveSnapshot;
  alertFeed: AlertFeed;
  planFact: PortfolioPlanFactSummary | ProjectPlanFactSummary;
  evidence: EvidenceListResult | null;
  memory: PrismaMemoryEntry[];
  issues: ContextAssemblerIssue[];
}

export async function assembleContext(
  input: ContextAssemblerInput,
  deps: ContextAssemblerDeps = {}
): Promise<ContextAssemblerResult> {
  const locale = resolveBriefLocale(input.locale);
  const interfaceLocale = resolveInterfaceLocale(input.interfaceLocale ?? input.locale);
  const snapshotResult = await loadSnapshotWithFallback(input.projectId, deps);
  const project = resolveProject(snapshotResult.snapshot, input.projectId);
  const projectId = project?.id ?? null;
  const scope = projectId ? "project" : "portfolio";
  const alertFeed = buildAlertFeed(snapshotResult.snapshot, {
    locale,
    limit: scope === "project" ? 4 : 5,
    projectId: projectId ?? undefined,
    referenceDate: snapshotResult.snapshot.generatedAt,
  });
  const planFact = projectId
    ? buildProjectPlanFactSummary(snapshotResult.snapshot, projectId)
    : buildPortfolioPlanFactSummary(snapshotResult.snapshot);
  const [evidence, memoryResult] = await Promise.all([
    input.includeEvidence
      ? loadEvidenceWithFallback(snapshotResult.snapshot, projectId, deps)
      : Promise.resolve<EvidenceListResult | null>(null),
    input.includeMemory
      ? loadMemoryWithIssues(projectId, deps.loadMemory)
      : Promise.resolve<{ memory: PrismaMemoryEntry[]; issues: ContextAssemblerIssue[] }>({
          memory: [],
          issues: [],
        }),
  ]);

  return {
    source: snapshotResult.source,
    scope,
    generatedAt: snapshotResult.snapshot.generatedAt,
    locale,
    interfaceLocale,
    projectId,
    project,
    snapshot: snapshotResult.snapshot,
    alertFeed,
    planFact,
    evidence,
    memory: memoryResult.memory,
    issues: memoryResult.issues,
  };
}

function resolveInterfaceLocale(value?: string): Locale {
  if (value === "en" || value === "zh") {
    return value;
  }

  return "ru";
}

function resolveProject(
  snapshot: ExecutiveSnapshot,
  projectId: string | undefined
): ExecutiveProject | null {
  if (!projectId) {
    return null;
  }

  const project = snapshot.projects.find((candidate) => candidate.id === projectId) ?? null;
  if (!project) {
    throw new Error(`Project "${projectId}" was not found.`);
  }

  return project;
}

async function loadSnapshotWithFallback(
  projectId: string | undefined,
  deps: ContextAssemblerDeps
): Promise<{ snapshot: ExecutiveSnapshot; source: "live" | "mock" }> {
  const filter = projectId ? { projectId } : undefined;
  const loadSnapshot = deps.loadSnapshot ?? loadExecutiveSnapshot;
  const loadMockSnapshot = deps.loadMockSnapshot ?? buildMockExecutiveSnapshot;

  try {
    const snapshot = await loadSnapshot(filter);
    if (process.env.NODE_ENV !== "production" && snapshot.projects.length === 0) {
      logger.warn("[ContextAssembler] Live snapshot was empty; using mock snapshot fallback.");
      const mockSnapshot = await loadMockSnapshot(filter);
      if (mockSnapshot.projects.length > 0) {
        return { snapshot: mockSnapshot, source: "mock" };
      }
    }

    return { snapshot, source: "live" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[ContextAssembler] Falling back to mock snapshot: ${message}`);

    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    const snapshot = await loadMockSnapshot(filter);
    return { snapshot, source: "mock" };
  }
}

async function loadEvidenceWithFallback(
  snapshot: ExecutiveSnapshot,
  projectId: string | null,
  deps: ContextAssemblerDeps
): Promise<EvidenceListResult> {
  const loadEvidence = deps.loadEvidence ?? getEvidenceLedgerOverview;
  const query: EvidenceQuery = {
    limit: 5,
    ...(projectId ? { projectId } : {}),
  };

  try {
    const evidence = await loadEvidence(query);

    if (
      process.env.NODE_ENV !== "production" &&
      evidence.summary.total === 0 &&
      snapshot.workReports.length > 0
    ) {
      logger.warn("[ContextAssembler] Live evidence ledger was empty; using snapshot-derived evidence.");
      return buildSnapshotEvidenceOverview(snapshot, projectId);
    }

    return evidence;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[ContextAssembler] Falling back to snapshot-derived evidence: ${message}`);

    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    return buildSnapshotEvidenceOverview(snapshot, projectId);
  }
}

async function loadMemoryWithIssues(
  projectId: string | null,
  loadMemory: ContextAssemblerDeps["loadMemory"]
): Promise<{ memory: PrismaMemoryEntry[]; issues: ContextAssemblerIssue[] }> {
  const loader = loadMemory ?? defaultLoadMemory;

  try {
    return {
      memory: await loader(projectId),
      issues: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[ContextAssembler] Memory sidecar unavailable: ${message}`);
    return {
      memory: [],
      issues: [
        {
          source: "memory",
          message,
        },
      ],
    };
  }
}

async function defaultLoadMemory(projectId: string | null) {
  if (projectId) {
    const memory = await prismaMemoryManager.search(projectId);
    return memory.slice(0, 10);
  }

  return prismaMemoryManager.getAll({ limit: 10 });
}

async function getEvidenceLedgerOverview(query?: EvidenceQuery): Promise<EvidenceListResult> {
  const { getEvidenceLedgerOverview: loadEvidence } = await import("@/lib/evidence/service");
  return loadEvidence(query);
}

function buildSnapshotEvidenceOverview(
  snapshot: ExecutiveSnapshot,
  projectId: string | null
): EvidenceListResult {
  const projectLookup = new Map(snapshot.projects.map((project) => [project.id, project.name]));
  const selectedWorkReports = snapshot.workReports.filter((report) =>
    projectId ? report.projectId === projectId : true
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
      summary: buildFallbackEvidenceSummary(report, projectLookup.get(report.projectId) ?? null),
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
    }));

  return {
    syncedAt: snapshot.generatedAt,
    summary: summarizeEvidenceRecords(records),
    records,
    sync: null,
  };
}

function buildFallbackEvidenceSummary(
  report: ExecutiveWorkReport,
  projectName: string | null
) {
  return [
    report.reportNumber,
    projectName ? `project ${projectName}` : null,
    report.status,
    report.source,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}
