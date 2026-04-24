var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { buildAlertFeed } from '../alerts/scoring';
import { resolveBriefLocale, } from '../briefs/locale';
import { buildMockExecutiveSnapshot, loadExecutiveSnapshot, } from '../briefs/snapshot';
import { summarizeEvidenceRecords, } from '../evidence/service';
import { logger } from '../observability/logger';
import { prismaMemoryManager, } from '../memory/prisma-memory-manager';
import { buildPortfolioPlanFactSummary, buildProjectPlanFactSummary, } from '../plan-fact/service';
export function assembleContext(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, deps = {}) {
        var _a, _b;
        const locale = resolveBriefLocale(input.locale);
        const interfaceLocale = resolveInterfaceLocale((_a = input.interfaceLocale) !== null && _a !== void 0 ? _a : input.locale);
        const snapshotResult = yield loadSnapshotWithFallback(input.projectId, deps);
        const project = resolveProject(snapshotResult.snapshot, input.projectId);
        const projectId = (_b = project === null || project === void 0 ? void 0 : project.id) !== null && _b !== void 0 ? _b : null;
        const scope = projectId ? "project" : "portfolio";
        const alertFeed = buildAlertFeed(snapshotResult.snapshot, {
            locale,
            limit: scope === "project" ? 4 : 5,
            projectId: projectId !== null && projectId !== void 0 ? projectId : undefined,
            referenceDate: snapshotResult.snapshot.generatedAt,
        });
        const planFact = projectId
            ? buildProjectPlanFactSummary(snapshotResult.snapshot, projectId)
            : buildPortfolioPlanFactSummary(snapshotResult.snapshot);
        const [evidence, memoryResult] = yield Promise.all([
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
    });
}
function resolveInterfaceLocale(value) {
    if (value === "en" || value === "zh") {
        return value;
    }
    return "ru";
}
function resolveProject(snapshot, projectId) {
    var _a;
    if (!projectId) {
        return null;
    }
    const project = (_a = snapshot.projects.find((candidate) => candidate.id === projectId)) !== null && _a !== void 0 ? _a : null;
    if (!project) {
        throw new Error(`Project "${projectId}" was not found.`);
    }
    return project;
}
function loadSnapshotWithFallback(projectId, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const filter = projectId ? { projectId } : undefined;
        const loadSnapshot = (_a = deps.loadSnapshot) !== null && _a !== void 0 ? _a : loadExecutiveSnapshot;
        const loadMockSnapshot = (_b = deps.loadMockSnapshot) !== null && _b !== void 0 ? _b : buildMockExecutiveSnapshot;
        try {
            const snapshot = yield loadSnapshot(filter);
            if (process.env.NODE_ENV !== "production" && snapshot.projects.length === 0) {
                logger.warn("[ContextAssembler] Live snapshot was empty; using mock snapshot fallback.");
                const mockSnapshot = yield loadMockSnapshot(filter);
                if (mockSnapshot.projects.length > 0) {
                    return { snapshot: mockSnapshot, source: "mock" };
                }
            }
            return { snapshot, source: "live" };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`[ContextAssembler] Falling back to mock snapshot: ${message}`);
            if (process.env.NODE_ENV === "production") {
                throw error;
            }
            const snapshot = yield loadMockSnapshot(filter);
            return { snapshot, source: "mock" };
        }
    });
}
function loadEvidenceWithFallback(snapshot, projectId, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const loadEvidence = (_a = deps.loadEvidence) !== null && _a !== void 0 ? _a : getEvidenceLedgerOverview;
        const query = Object.assign({ limit: 5 }, (projectId ? { projectId } : {}));
        try {
            const evidence = yield loadEvidence(query);
            if (process.env.NODE_ENV !== "production" &&
                evidence.summary.total === 0 &&
                snapshot.workReports.length > 0) {
                logger.warn("[ContextAssembler] Live evidence ledger was empty; using snapshot-derived evidence.");
                return buildSnapshotEvidenceOverview(snapshot, projectId);
            }
            return evidence;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`[ContextAssembler] Falling back to snapshot-derived evidence: ${message}`);
            if (process.env.NODE_ENV === "production") {
                throw error;
            }
            return buildSnapshotEvidenceOverview(snapshot, projectId);
        }
    });
}
function loadMemoryWithIssues(projectId, loadMemory) {
    return __awaiter(this, void 0, void 0, function* () {
        const loader = loadMemory !== null && loadMemory !== void 0 ? loadMemory : defaultLoadMemory;
        try {
            return {
                memory: yield loader(projectId),
                issues: [],
            };
        }
        catch (error) {
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
    });
}
function defaultLoadMemory(projectId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (projectId) {
            const memory = yield prismaMemoryManager.search(projectId);
            return memory.slice(0, 10);
        }
        return prismaMemoryManager.getAll({ limit: 10 });
    });
}
function getEvidenceLedgerOverview(query) {
    return __awaiter(this, void 0, void 0, function* () {
        const { getEvidenceLedgerOverview: loadEvidence } = yield import('../evidence/service');
        return loadEvidence(query);
    });
}
function buildSnapshotEvidenceOverview(snapshot, projectId) {
    const projectLookup = new Map(snapshot.projects.map((project) => [project.id, project.name]));
    const selectedWorkReports = snapshot.workReports.filter((report) => projectId ? report.projectId === projectId : true);
    const records = selectedWorkReports
        .filter((report) => report.status !== "rejected")
        .map((report) => {
        var _a, _b, _c, _d;
        return ({
            id: report.id,
            sourceType: `work_report:${report.source}`,
            sourceRef: report.reportNumber,
            entityType: "work_report",
            entityRef: report.id,
            projectId: report.projectId,
            title: `${report.reportNumber} · ${report.status}`,
            summary: buildFallbackEvidenceSummary(report, (_a = projectLookup.get(report.projectId)) !== null && _a !== void 0 ? _a : null),
            observedAt: (_b = report.reviewedAt) !== null && _b !== void 0 ? _b : report.submittedAt,
            reportedAt: report.submittedAt,
            confidence: report.status === "approved" ? 0.82 : 0.58,
            verificationStatus: report.status === "approved" ? "verified" : "reported",
            metadata: {
                projectName: (_c = projectLookup.get(report.projectId)) !== null && _c !== void 0 ? _c : null,
                reportDate: report.reportDate,
                reportNumber: report.reportNumber,
                reportStatus: report.status,
                source: report.source,
                section: null,
            },
            createdAt: report.submittedAt,
            updatedAt: (_d = report.reviewedAt) !== null && _d !== void 0 ? _d : report.submittedAt,
        });
    });
    return {
        syncedAt: snapshot.generatedAt,
        summary: summarizeEvidenceRecords(records),
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
