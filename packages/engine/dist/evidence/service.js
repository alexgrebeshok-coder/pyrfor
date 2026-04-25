var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from "node:crypto";
import { prisma } from '../prisma.js';
import { getGpsTelemetrySampleSnapshot } from '../connectors/gps-client.js';
import { getDerivedSyncCheckpoint, markDerivedSyncError, markDerivedSyncStarted, markDerivedSyncSuccess, } from '../sync-state/index.js';
import { listWorkReports } from '../work-reports/service.js';
const defaultEvidenceStore = {
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
export function getEvidenceLedgerOverview() {
    return __awaiter(this, arguments, void 0, function* (query = {}, deps = {}) {
        var _a, _b, _c;
        const evidenceStore = (_a = deps.evidenceStore) !== null && _a !== void 0 ? _a : defaultEvidenceStore;
        const sync = yield getDerivedSyncCheckpoint(EVIDENCE_LEDGER_SYNC_KEY, {
            syncStore: deps.syncStore,
        });
        const records = yield evidenceStore.findMany({
            where: Object.assign(Object.assign(Object.assign(Object.assign({}, (query.entityType ? { entityType: query.entityType } : {})), (query.entityRef ? { entityRef: query.entityRef } : {})), (query.projectId ? { projectId: query.projectId } : {})), (query.verificationStatus ? { verificationStatus: query.verificationStatus } : {})),
            orderBy: { observedAt: "desc" },
            take: sanitizeLimit(query.limit),
        });
        const views = records.map(serializeEvidenceRecord);
        return {
            syncedAt: (_c = (_b = sync === null || sync === void 0 ? void 0 : sync.lastCompletedAt) !== null && _b !== void 0 ? _b : sync === null || sync === void 0 ? void 0 : sync.lastSuccessAt) !== null && _c !== void 0 ? _c : null,
            summary: summarizeEvidenceRecords(views),
            records: views,
            sync,
        };
    });
}
export function syncEvidenceLedger() {
    return __awaiter(this, arguments, void 0, function* (deps = {}, options = {}) {
        var _a, _b, _c, _d, _e, _f;
        const includeGpsSample = (_a = options.includeGpsSample) !== null && _a !== void 0 ? _a : true;
        const includeWorkReports = (_b = options.includeWorkReports) !== null && _b !== void 0 ? _b : true;
        const evidenceStore = (_c = deps.evidenceStore) !== null && _c !== void 0 ? _c : defaultEvidenceStore;
        const listReports = (_d = deps.listReports) !== null && _d !== void 0 ? _d : ((input) => { var _a; return listWorkReports({ limit: (_a = input === null || input === void 0 ? void 0 : input.limit) !== null && _a !== void 0 ? _a : 100 }); });
        yield markDerivedSyncStarted(EVIDENCE_LEDGER_SYNC_KEY, {
            now: deps.now,
            syncStore: deps.syncStore,
        });
        try {
            const [gpsSnapshot, workReports] = yield Promise.all([
                includeGpsSample ? (_e = deps.gpsSnapshot) !== null && _e !== void 0 ? _e : getGpsTelemetrySampleSnapshot() : Promise.resolve(null),
                includeWorkReports ? listReports({ limit: 100 }) : Promise.resolve([]),
            ]);
            const upsertInputs = [
                ...workReports
                    .map(mapWorkReportToEvidenceInput)
                    .filter((item) => item !== null),
                ...(gpsSnapshot ? mapGpsSnapshotToEvidenceInputs(gpsSnapshot) : []),
            ];
            yield Promise.all(upsertInputs.map((input) => upsertEvidenceInput(input, evidenceStore)));
            yield markDerivedSyncSuccess(EVIDENCE_LEDGER_SYNC_KEY, {
                metadata: {
                    gpsIncluded: includeGpsSample,
                    gpsStatus: (_f = gpsSnapshot === null || gpsSnapshot === void 0 ? void 0 : gpsSnapshot.status) !== null && _f !== void 0 ? _f : null,
                    gpsSampleCount: (gpsSnapshot === null || gpsSnapshot === void 0 ? void 0 : gpsSnapshot.status) === "ok" ? gpsSnapshot.samples.length : 0,
                    workReportCount: workReports.length,
                },
                resultCount: upsertInputs.length,
            }, {
                now: deps.now,
                syncStore: deps.syncStore,
            });
        }
        catch (error) {
            yield markDerivedSyncError(EVIDENCE_LEDGER_SYNC_KEY, error, {
                metadata: {
                    gpsIncluded: includeGpsSample,
                    workReportsIncluded: includeWorkReports,
                },
            }, {
                now: deps.now,
                syncStore: deps.syncStore,
            });
            throw error;
        }
    });
}
export function syncWorkReportEvidenceRecord(report_1) {
    return __awaiter(this, arguments, void 0, function* (report, deps = {}) {
        var _a;
        const evidenceStore = (_a = deps.evidenceStore) !== null && _a !== void 0 ? _a : defaultEvidenceStore;
        const input = mapWorkReportToEvidenceInput(report);
        if (!input) {
            yield removeEvidenceRecordForEntity("work_report", report.id, deps);
            return;
        }
        yield upsertEvidenceInput(input, evidenceStore);
        yield markDerivedSyncSuccess(EVIDENCE_LEDGER_SYNC_KEY, {
            metadata: {
                lastEntityRef: report.id,
                lastSourceType: input.sourceType,
                lastWrite: "work_report_upsert",
            },
            resultCount: 1,
        }, {
            now: deps.now,
            syncStore: deps.syncStore,
        });
    });
}
export function removeEvidenceRecordForEntity(entityType_1, entityRef_1) {
    return __awaiter(this, arguments, void 0, function* (entityType, entityRef, deps = {}) {
        var _a;
        const evidenceStore = (_a = deps.evidenceStore) !== null && _a !== void 0 ? _a : defaultEvidenceStore;
        const result = yield evidenceStore.deleteMany({
            where: {
                entityType,
                entityRef,
            },
        });
        yield markDerivedSyncSuccess(EVIDENCE_LEDGER_SYNC_KEY, {
            metadata: {
                lastEntityRef: entityRef,
                lastEntityType: entityType,
                lastWrite: "evidence_delete",
            },
            resultCount: result.count,
        }, {
            now: deps.now,
            syncStore: deps.syncStore,
        });
        return result.count;
    });
}
export function getEvidenceRecordById(id_1) {
    return __awaiter(this, arguments, void 0, function* (id, deps = {}) {
        var _a;
        const evidenceStore = (_a = deps.evidenceStore) !== null && _a !== void 0 ? _a : defaultEvidenceStore;
        const record = yield evidenceStore.findUnique({
            where: { id },
        });
        return record ? serializeEvidenceRecord(record) : null;
    });
}
export function mapWorkReportToEvidenceInput(report) {
    var _a;
    if (report.status === "rejected") {
        return null;
    }
    const verificationStatus = report.status === "approved" ? "verified" : "reported";
    return {
        sourceType: `work_report:${report.source}`,
        sourceRef: report.reportNumber,
        entityType: "work_report",
        entityRef: report.id,
        projectId: report.projectId,
        title: `${report.reportNumber} · ${report.section}`,
        summary: truncate(report.workDescription, 160),
        observedAt: (_a = report.reviewedAt) !== null && _a !== void 0 ? _a : report.submittedAt,
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
export function mapGpsSnapshotToEvidenceInputs(snapshot) {
    if (snapshot.status !== "ok") {
        return [];
    }
    return snapshot.samples.map((sample, index) => mapGpsSampleToEvidenceInput(sample, snapshot, index));
}
export function summarizeEvidenceRecords(records) {
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
    const summary = records.reduce((accumulator, record) => {
        accumulator.total += 1;
        accumulator[record.verificationStatus] += 1;
        accumulator.confidenceTotal += record.confidence;
        if (!accumulator.lastObservedAt || accumulator.lastObservedAt < record.observedAt) {
            accumulator.lastObservedAt = record.observedAt;
        }
        return accumulator;
    }, {
        total: 0,
        reported: 0,
        observed: 0,
        verified: 0,
        confidenceTotal: 0,
        lastObservedAt: null,
    });
    return {
        total: summary.total,
        reported: summary.reported,
        observed: summary.observed,
        verified: summary.verified,
        averageConfidence: round(summary.confidenceTotal / summary.total, 2),
        lastObservedAt: summary.lastObservedAt,
    };
}
function mapGpsSampleToEvidenceInput(sample, snapshot, index) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const entityRef = (_a = sample.sessionId) !== null && _a !== void 0 ? _a : [(_b = sample.equipmentId) !== null && _b !== void 0 ? _b : "equipment", (_c = sample.startedAt) !== null && _c !== void 0 ? _c : "start", (_d = sample.endedAt) !== null && _d !== void 0 ? _d : "end", index].join(":");
    return {
        sourceType: "gps_api:session_sample",
        sourceRef: (_e = snapshot.sampleUrl) !== null && _e !== void 0 ? _e : "gps-sample",
        entityType: "gps_session",
        entityRef,
        projectId: null,
        title: `${(_f = sample.equipmentId) !== null && _f !== void 0 ? _f : "Unknown equipment"} · ${sample.status}`,
        summary: buildGpsSampleSummary(sample),
        observedAt: (_h = (_g = sample.endedAt) !== null && _g !== void 0 ? _g : sample.startedAt) !== null && _h !== void 0 ? _h : snapshot.checkedAt,
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
function upsertEvidenceInput(input, evidenceStore) {
    return __awaiter(this, void 0, void 0, function* () {
        return evidenceStore.upsert({
            where: {
                sourceType_entityType_entityRef: {
                    sourceType: input.sourceType,
                    entityType: input.entityType,
                    entityRef: input.entityRef,
                },
            },
            create: Object.assign({ id: randomUUID() }, toEvidenceWriteShape(input)),
            update: toEvidenceWriteShape(input),
        });
    });
}
function serializeEvidenceRecord(record) {
    var _a, _b;
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
        reportedAt: (_b = (_a = record.reportedAt) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : null,
        confidence: round(record.confidence, 2),
        verificationStatus: normalizeVerificationStatus(record.verificationStatus),
        metadata: parseMetadata(record.metadataJson),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}
function toEvidenceWriteShape(input) {
    var _a, _b, _c;
    return {
        sourceType: input.sourceType,
        sourceRef: (_a = input.sourceRef) !== null && _a !== void 0 ? _a : null,
        entityType: input.entityType,
        entityRef: input.entityRef,
        projectId: (_b = input.projectId) !== null && _b !== void 0 ? _b : null,
        title: input.title,
        summary: (_c = input.summary) !== null && _c !== void 0 ? _c : null,
        observedAt: new Date(input.observedAt),
        reportedAt: input.reportedAt ? new Date(input.reportedAt) : null,
        confidence: input.confidence,
        verificationStatus: input.verificationStatus,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
        updatedAt: new Date(),
    };
}
function buildGpsSampleSummary(sample) {
    var _a;
    const parts = [
        sample.status,
        (_a = sample.geofenceName) !== null && _a !== void 0 ? _a : sample.geofenceId,
        sample.durationSeconds !== null ? `${Math.round(sample.durationSeconds / 60)} min` : null,
    ].filter((item) => Boolean(item));
    return parts.join(" · ") || "Observed GPS session sample";
}
function calculateGpsSampleConfidence(sample) {
    let confidence = 0.45;
    if (sample.sessionId)
        confidence += 0.15;
    if (sample.equipmentId)
        confidence += 0.15;
    if (sample.startedAt && sample.endedAt)
        confidence += 0.15;
    if (sample.durationSeconds !== null)
        confidence += 0.05;
    if (sample.geofenceId || sample.geofenceName)
        confidence += 0.05;
    return round(Math.min(confidence, 0.95), 2);
}
function parseMetadata(value) {
    if (!value) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch (_a) {
        return {};
    }
}
function normalizeVerificationStatus(value) {
    switch (value) {
        case "verified":
        case "observed":
        case "reported":
            return value;
        default:
            return "reported";
    }
}
function sanitizeLimit(value) {
    if (!value || !Number.isFinite(value)) {
        return 8;
    }
    return Math.max(1, Math.min(Math.round(value), 50));
}
function truncate(value, maxLength) {
    const trimmed = value.trim();
    if (trimmed.length <= maxLength) {
        return trimmed;
    }
    return `${trimmed.slice(0, maxLength - 1)}…`;
}
function round(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}
