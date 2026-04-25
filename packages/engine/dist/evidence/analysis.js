var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getEvidenceFusionOverview } from './fusion.js';
import { getEvidenceRecordById } from './service.js';
const MAX_FUSION_SCAN = 100;
export function analyzeEvidenceRecord(recordId_1) {
    return __awaiter(this, arguments, void 0, function* (recordId, deps = {}) {
        var _a, _b, _c;
        const loadRecord = (_a = deps.loadRecord) !== null && _a !== void 0 ? _a : getEvidenceRecordById;
        const record = yield loadRecord(recordId);
        if (!record) {
            return null;
        }
        const fusedFact = yield loadRelevantFusionFact(record, deps);
        const relatedSources = fusedFact
            ? fusedFact.sources.filter((source) => source.recordId !== record.id)
            : [];
        const finalConfidence = round((_b = fusedFact === null || fusedFact === void 0 ? void 0 : fusedFact.confidence) !== null && _b !== void 0 ? _b : record.confidence);
        const confidenceDelta = round(Math.max(finalConfidence - record.confidence, 0));
        const verificationStatus = (_c = fusedFact === null || fusedFact === void 0 ? void 0 : fusedFact.verificationStatus) !== null && _c !== void 0 ? _c : record.verificationStatus;
        return {
            record,
            baseConfidence: round(record.confidence),
            finalConfidence,
            confidenceDelta,
            verificationStatus,
            justifications: buildJustifications(record, confidenceDelta, fusedFact, relatedSources),
            gaps: buildGaps(record, relatedSources),
            anomalies: buildAnomalies(record, relatedSources),
            relatedSources,
            fusedFact: fusedFact ? toAnalysisMatch(fusedFact) : null,
        };
    });
}
function loadRelevantFusionFact(record, deps) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (record.entityType !== "work_report" && record.entityType !== "video_fact") {
            return null;
        }
        const loadFusion = (_a = deps.loadFusion) !== null && _a !== void 0 ? _a : getEvidenceFusionOverview;
        const fusion = yield loadFusion(Object.assign({ limit: MAX_FUSION_SCAN }, (record.projectId ? { projectId: record.projectId } : {})));
        const reportId = record.entityType === "work_report" ? record.entityRef : readMetadataString(record, "reportId");
        if (!reportId) {
            return null;
        }
        return (_b = fusion.facts.find((fact) => fact.reportId === reportId)) !== null && _b !== void 0 ? _b : null;
    });
}
function buildJustifications(record, confidenceDelta, fusedFact, relatedSources) {
    const justifications = [
        {
            code: `status_${record.verificationStatus}`,
            message: describeVerificationStatus(record),
        },
    ];
    if (record.reportedAt) {
        justifications.push({
            code: "reported_timestamp",
            message: `The record has a reported timestamp (${formatIsoDate(record.reportedAt)}).`,
        });
    }
    if (record.sourceRef) {
        justifications.push({
            code: "source_reference",
            message: `The source reference is present (${record.sourceRef}).`,
        });
    }
    if (record.entityType === "work_report") {
        const reportNumber = readMetadataString(record, "reportNumber");
        const section = readMetadataString(record, "section");
        if (reportNumber || section) {
            justifications.push({
                code: "work_report_context",
                message: `The work report includes contextual metadata${reportNumber ? ` (${reportNumber})` : ""}${section ? ` for ${section}` : ""}.`,
            });
        }
    }
    if (record.entityType === "video_fact") {
        const reportId = readMetadataString(record, "reportId");
        if (reportId) {
            justifications.push({
                code: "linked_report",
                message: `The video fact is linked to work report ${reportId}.`,
            });
        }
    }
    if (record.entityType === "gps_session") {
        const geofence = readMetadataString(record, "geofenceName");
        const equipment = readMetadataString(record, "equipmentId");
        if (geofence || equipment) {
            justifications.push({
                code: "gps_context",
                message: `The GPS session identifies${equipment ? ` equipment ${equipment}` : " the equipment"}${geofence ? ` in ${geofence}` : ""}.`,
            });
        }
    }
    if (fusedFact && confidenceDelta > 0) {
        justifications.push({
            code: "cross_source_fusion",
            message: `Cross-source fusion raised confidence from ${formatConfidence(record.confidence)} to ${formatConfidence(fusedFact.confidence)}.`,
        });
    }
    const videoSupport = relatedSources.filter((source) => source.entityType === "video_fact");
    if (videoSupport.length > 0) {
        justifications.push({
            code: "video_support",
            message: `${videoSupport.length} linked video fact${videoSupport.length === 1 ? "" : "s"} add visual corroboration.`,
        });
    }
    const gpsSupport = relatedSources.filter((source) => source.entityType === "gps_session");
    if (gpsSupport.length > 0) {
        justifications.push({
            code: "gps_support",
            message: `${gpsSupport.length} GPS session${gpsSupport.length === 1 ? "" : "s"} corroborate timing, location, or equipment overlap.`,
        });
    }
    if (fusedFact === null || fusedFact === void 0 ? void 0 : fusedFact.explanation) {
        justifications.push({
            code: "fusion_explanation",
            message: fusedFact.explanation,
        });
    }
    return dedupeItems(justifications);
}
function buildGaps(record, relatedSources) {
    const gaps = [];
    if (!record.summary) {
        gaps.push({
            code: "missing_summary",
            message: "The record does not include a human-readable summary yet.",
        });
    }
    if (!record.sourceRef) {
        gaps.push({
            code: "missing_source_ref",
            message: "The record is missing a stable source reference for drill-down.",
        });
    }
    if (record.entityType === "work_report") {
        if (!relatedSources.some((source) => source.entityType === "video_fact")) {
            gaps.push({
                code: "missing_video_support",
                message: "No linked video fact corroborates this work report yet.",
            });
        }
        if (!relatedSources.some((source) => source.entityType === "gps_session")) {
            gaps.push({
                code: "missing_gps_support",
                message: "No GPS session corroborates this work report yet.",
            });
        }
        if (readMetadataString(record, "reportStatus") !== "approved") {
            gaps.push({
                code: "pending_approval",
                message: "Reviewer approval is still missing, so the record remains weaker than an approved report.",
            });
        }
    }
    if (record.entityType === "video_fact" && !readMetadataString(record, "reportId")) {
        gaps.push({
            code: "missing_linked_report",
            message: "The video fact is not linked to a work report.",
        });
    }
    if (record.entityType === "gps_session") {
        if (!readMetadataString(record, "geofenceName")) {
            gaps.push({
                code: "missing_geofence",
                message: "The GPS session is missing a geofence name.",
            });
        }
        if (!readMetadataString(record, "equipmentId")) {
            gaps.push({
                code: "missing_equipment",
                message: "The GPS session is missing an equipment identifier.",
            });
        }
    }
    return dedupeItems(gaps);
}
function buildAnomalies(record, relatedSources) {
    const anomalies = [];
    if (record.entityType === "work_report") {
        if (record.verificationStatus === "verified" && relatedSources.length === 0) {
            anomalies.push({
                code: "verified_without_secondary_support",
                message: "The work report is marked verified without any secondary evidence sources.",
            });
        }
        if (relatedSources.length > 0 &&
            relatedSources.every((source) => source.verificationStatus === "reported")) {
            anomalies.push({
                code: "weak_support_only",
                message: "All supporting sources are still only reported and have not advanced to observed or verified.",
            });
        }
    }
    return dedupeItems(anomalies);
}
function describeVerificationStatus(record) {
    switch (record.verificationStatus) {
        case "verified":
            return "The record is already marked verified.";
        case "observed":
            return "The record is grounded in observed evidence but is not fully verified yet.";
        case "reported":
        default:
            return "The record is currently only reported and needs corroboration.";
    }
}
function toAnalysisMatch(fact) {
    return {
        id: fact.id,
        reportId: fact.reportId,
        confidence: round(fact.confidence),
        explanation: fact.explanation,
        sourceCount: fact.sourceCount,
        verificationStatus: fact.verificationStatus,
    };
}
function readMetadataString(record, key) {
    const value = record.metadata[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function round(value) {
    return Math.round(value * 100) / 100;
}
function formatConfidence(value) {
    return `${Math.round(value * 100)}%`;
}
function formatIsoDate(value) {
    return new Intl.DateTimeFormat("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(new Date(value));
}
function dedupeItems(items) {
    const seen = new Set();
    return items.filter((item) => {
        const key = `${item.code}:${item.message}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}
