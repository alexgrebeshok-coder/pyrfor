"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVIDENCE_LEDGER_SYNC_KEY = void 0;
exports.getEvidenceLedgerOverview = getEvidenceLedgerOverview;
exports.syncEvidenceLedger = syncEvidenceLedger;
exports.syncWorkReportEvidenceRecord = syncWorkReportEvidenceRecord;
exports.removeEvidenceRecordForEntity = removeEvidenceRecordForEntity;
exports.getEvidenceRecordById = getEvidenceRecordById;
exports.mapWorkReportToEvidenceInput = mapWorkReportToEvidenceInput;
exports.mapGpsSnapshotToEvidenceInputs = mapGpsSnapshotToEvidenceInputs;
exports.summarizeEvidenceRecords = summarizeEvidenceRecords;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../prisma");
const gps_client_1 = require("../connectors/gps-client");
const sync_state_1 = require("../sync-state");
const service_1 = require("../work-reports/service");
const defaultEvidenceStore = {
    upsert(args) {
        return prisma_1.prisma.evidenceRecord.upsert(args);
    },
    findMany(args) {
        return prisma_1.prisma.evidenceRecord.findMany(args);
    },
    findUnique(args) {
        return prisma_1.prisma.evidenceRecord.findUnique(args);
    },
    deleteMany(args) {
        return prisma_1.prisma.evidenceRecord.deleteMany(args);
    },
};
exports.EVIDENCE_LEDGER_SYNC_KEY = "evidence_ledger";
async function getEvidenceLedgerOverview(query = {}, deps = {}) {
    const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
    const sync = await (0, sync_state_1.getDerivedSyncCheckpoint)(exports.EVIDENCE_LEDGER_SYNC_KEY, {
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
async function syncEvidenceLedger(deps = {}, options = {}) {
    const includeGpsSample = options.includeGpsSample ?? true;
    const includeWorkReports = options.includeWorkReports ?? true;
    const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
    const listReports = deps.listReports ?? ((input) => (0, service_1.listWorkReports)({ limit: input?.limit ?? 100 }));
    await (0, sync_state_1.markDerivedSyncStarted)(exports.EVIDENCE_LEDGER_SYNC_KEY, {
        now: deps.now,
        syncStore: deps.syncStore,
    });
    try {
        const [gpsSnapshot, workReports] = await Promise.all([
            includeGpsSample ? deps.gpsSnapshot ?? (0, gps_client_1.getGpsTelemetrySampleSnapshot)() : Promise.resolve(null),
            includeWorkReports ? listReports({ limit: 100 }) : Promise.resolve([]),
        ]);
        const upsertInputs = [
            ...workReports
                .map(mapWorkReportToEvidenceInput)
                .filter((item) => item !== null),
            ...(gpsSnapshot ? mapGpsSnapshotToEvidenceInputs(gpsSnapshot) : []),
        ];
        await Promise.all(upsertInputs.map((input) => upsertEvidenceInput(input, evidenceStore)));
        await (0, sync_state_1.markDerivedSyncSuccess)(exports.EVIDENCE_LEDGER_SYNC_KEY, {
            metadata: {
                gpsIncluded: includeGpsSample,
                gpsStatus: gpsSnapshot?.status ?? null,
                gpsSampleCount: gpsSnapshot?.status === "ok" ? gpsSnapshot.samples.length : 0,
                workReportCount: workReports.length,
            },
            resultCount: upsertInputs.length,
        }, {
            now: deps.now,
            syncStore: deps.syncStore,
        });
    }
    catch (error) {
        await (0, sync_state_1.markDerivedSyncError)(exports.EVIDENCE_LEDGER_SYNC_KEY, error, {
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
}
async function syncWorkReportEvidenceRecord(report, deps = {}) {
    const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
    const input = mapWorkReportToEvidenceInput(report);
    if (!input) {
        await removeEvidenceRecordForEntity("work_report", report.id, deps);
        return;
    }
    await upsertEvidenceInput(input, evidenceStore);
    await (0, sync_state_1.markDerivedSyncSuccess)(exports.EVIDENCE_LEDGER_SYNC_KEY, {
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
}
async function removeEvidenceRecordForEntity(entityType, entityRef, deps = {}) {
    const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
    const result = await evidenceStore.deleteMany({
        where: {
            entityType,
            entityRef,
        },
    });
    await (0, sync_state_1.markDerivedSyncSuccess)(exports.EVIDENCE_LEDGER_SYNC_KEY, {
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
}
async function getEvidenceRecordById(id, deps = {}) {
    const evidenceStore = deps.evidenceStore ?? defaultEvidenceStore;
    const record = await evidenceStore.findUnique({
        where: { id },
    });
    return record ? serializeEvidenceRecord(record) : null;
}
function mapWorkReportToEvidenceInput(report) {
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
function mapGpsSnapshotToEvidenceInputs(snapshot) {
    if (snapshot.status !== "ok") {
        return [];
    }
    return snapshot.samples.map((sample, index) => mapGpsSampleToEvidenceInput(sample, snapshot, index));
}
function summarizeEvidenceRecords(records) {
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
    const entityRef = sample.sessionId ??
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
async function upsertEvidenceInput(input, evidenceStore) {
    return evidenceStore.upsert({
        where: {
            sourceType_entityType_entityRef: {
                sourceType: input.sourceType,
                entityType: input.entityType,
                entityRef: input.entityRef,
            },
        },
        create: {
            id: (0, node_crypto_1.randomUUID)(),
            ...toEvidenceWriteShape(input),
        },
        update: toEvidenceWriteShape(input),
    });
}
function serializeEvidenceRecord(record) {
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
function toEvidenceWriteShape(input) {
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
function buildGpsSampleSummary(sample) {
    const parts = [
        sample.status,
        sample.geofenceName ?? sample.geofenceId,
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
    catch {
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
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
}
