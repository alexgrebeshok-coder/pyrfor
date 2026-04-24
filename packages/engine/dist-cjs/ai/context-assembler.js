"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.assembleContext = assembleContext;
const scoring_1 = require("../alerts/scoring");
const locale_1 = require("../briefs/locale");
const snapshot_1 = require("../briefs/snapshot");
const service_1 = require("../evidence/service");
const logger_1 = require("../observability/logger");
const prisma_memory_manager_1 = require("../memory/prisma-memory-manager");
const service_2 = require("../plan-fact/service");
async function assembleContext(input, deps = {}) {
    const locale = (0, locale_1.resolveBriefLocale)(input.locale);
    const interfaceLocale = resolveInterfaceLocale(input.interfaceLocale ?? input.locale);
    const snapshotResult = await loadSnapshotWithFallback(input.projectId, deps);
    const project = resolveProject(snapshotResult.snapshot, input.projectId);
    const projectId = project?.id ?? null;
    const scope = projectId ? "project" : "portfolio";
    const alertFeed = (0, scoring_1.buildAlertFeed)(snapshotResult.snapshot, {
        locale,
        limit: scope === "project" ? 4 : 5,
        projectId: projectId ?? undefined,
        referenceDate: snapshotResult.snapshot.generatedAt,
    });
    const planFact = projectId
        ? (0, service_2.buildProjectPlanFactSummary)(snapshotResult.snapshot, projectId)
        : (0, service_2.buildPortfolioPlanFactSummary)(snapshotResult.snapshot);
    const [evidence, memoryResult] = await Promise.all([
        input.includeEvidence
            ? loadEvidenceWithFallback(snapshotResult.snapshot, projectId, deps)
            : Promise.resolve(null),
        input.includeMemory
            ? loadMemoryWithIssues(projectId, deps.loadMemory)
            : Promise.resolve({
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
function resolveInterfaceLocale(value) {
    if (value === "en" || value === "zh") {
        return value;
    }
    return "ru";
}
function resolveProject(snapshot, projectId) {
    if (!projectId) {
        return null;
    }
    const project = snapshot.projects.find((candidate) => candidate.id === projectId) ?? null;
    if (!project) {
        throw new Error(`Project "${projectId}" was not found.`);
    }
    return project;
}
async function loadSnapshotWithFallback(projectId, deps) {
    const filter = projectId ? { projectId } : undefined;
    const loadSnapshot = deps.loadSnapshot ?? snapshot_1.loadExecutiveSnapshot;
    const loadMockSnapshot = deps.loadMockSnapshot ?? snapshot_1.buildMockExecutiveSnapshot;
    try {
        const snapshot = await loadSnapshot(filter);
        if (process.env.NODE_ENV !== "production" && snapshot.projects.length === 0) {
            logger_1.logger.warn("[ContextAssembler] Live snapshot was empty; using mock snapshot fallback.");
            const mockSnapshot = await loadMockSnapshot(filter);
            if (mockSnapshot.projects.length > 0) {
                return { snapshot: mockSnapshot, source: "mock" };
            }
        }
        return { snapshot, source: "live" };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.warn(`[ContextAssembler] Falling back to mock snapshot: ${message}`);
        if (process.env.NODE_ENV === "production") {
            throw error;
        }
        const snapshot = await loadMockSnapshot(filter);
        return { snapshot, source: "mock" };
    }
}
async function loadEvidenceWithFallback(snapshot, projectId, deps) {
    const loadEvidence = deps.loadEvidence ?? getEvidenceLedgerOverview;
    const query = {
        limit: 5,
        ...(projectId ? { projectId } : {}),
    };
    try {
        const evidence = await loadEvidence(query);
        if (process.env.NODE_ENV !== "production" &&
            evidence.summary.total === 0 &&
            snapshot.workReports.length > 0) {
            logger_1.logger.warn("[ContextAssembler] Live evidence ledger was empty; using snapshot-derived evidence.");
            return buildSnapshotEvidenceOverview(snapshot, projectId);
        }
        return evidence;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.warn(`[ContextAssembler] Falling back to snapshot-derived evidence: ${message}`);
        if (process.env.NODE_ENV === "production") {
            throw error;
        }
        return buildSnapshotEvidenceOverview(snapshot, projectId);
    }
}
async function loadMemoryWithIssues(projectId, loadMemory) {
    const loader = loadMemory ?? defaultLoadMemory;
    try {
        return {
            memory: await loader(projectId),
            issues: [],
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.warn(`[ContextAssembler] Memory sidecar unavailable: ${message}`);
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
async function defaultLoadMemory(projectId) {
    if (projectId) {
        const memory = await prisma_memory_manager_1.prismaMemoryManager.search(projectId);
        return memory.slice(0, 10);
    }
    return prisma_memory_manager_1.prismaMemoryManager.getAll({ limit: 10 });
}
async function getEvidenceLedgerOverview(query) {
    const { getEvidenceLedgerOverview: loadEvidence } = await Promise.resolve().then(() => __importStar(require('../evidence/service')));
    return loadEvidence(query);
}
function buildSnapshotEvidenceOverview(snapshot, projectId) {
    const projectLookup = new Map(snapshot.projects.map((project) => [project.id, project.name]));
    const selectedWorkReports = snapshot.workReports.filter((report) => projectId ? report.projectId === projectId : true);
    const records = selectedWorkReports
        .filter((report) => report.status !== "rejected")
        .map((report) => ({
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
        summary: (0, service_1.summarizeEvidenceRecords)(records),
        records,
        sync: null,
    };
}
function buildFallbackEvidenceSummary(report, projectName) {
    return [
        report.reportNumber,
        projectName ? `project ${projectName}` : null,
        report.status,
        report.source,
    ]
        .filter((value) => Boolean(value))
        .join(" · ");
}
