"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapAIPMOBotWorkReportToCreateInput = mapAIPMOBotWorkReportToCreateInput;
exports.serializeWorkReportRecord = serializeWorkReportRecord;
exports.serializeJsonArray = serializeJsonArray;
exports.parseJsonArray = parseJsonArray;
function mapAIPMOBotWorkReportToCreateInput(report, options) {
    return {
        projectId: options.projectId,
        authorId: options.authorId,
        section: report.section,
        reportDate: report.report_date,
        workDescription: report.work_description,
        volumes: report.volumes ?? [],
        personnelCount: report.personnel_count ?? undefined,
        personnelDetails: report.personnel_details ?? undefined,
        equipment: report.equipment ?? undefined,
        weather: report.weather ?? undefined,
        issues: report.issues ?? undefined,
        nextDayPlan: report.next_day_plan ?? undefined,
        attachments: report.attachments ?? [],
        reportNumber: report.report_id,
        status: report.status ?? "submitted",
        source: "telegram_bot",
        externalReporterTelegramId: String(report.reporter_telegram_id),
        externalReporterName: report.reporter_name ?? undefined,
    };
}
function serializeWorkReportRecord(record) {
    return {
        id: record.id,
        reportNumber: record.reportNumber,
        projectId: record.projectId,
        project: record.project,
        authorId: record.authorId,
        author: record.author,
        reviewerId: record.reviewerId,
        reviewer: record.reviewer,
        section: record.section,
        reportDate: record.reportDate.toISOString(),
        workDescription: record.workDescription,
        volumes: parseJsonArray(record.volumesJson),
        personnelCount: record.personnelCount,
        personnelDetails: record.personnelDetails,
        equipment: record.equipment,
        weather: record.weather,
        issues: record.issues,
        nextDayPlan: record.nextDayPlan,
        attachments: parseJsonArray(record.attachmentsJson),
        status: normalizeStatus(record.status),
        reviewComment: record.reviewComment,
        source: record.source,
        externalReporterTelegramId: record.externalReporterTelegramId,
        externalReporterName: record.externalReporterName,
        submittedAt: record.submittedAt.toISOString(),
        reviewedAt: record.reviewedAt?.toISOString() ?? null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}
function normalizeStatus(value) {
    switch (value) {
        case "approved":
        case "rejected":
        case "submitted":
            return value;
        default:
            return "submitted";
    }
}
function serializeJsonArray(value) {
    return JSON.stringify(Array.isArray(value) ? value : [], null, 0);
}
function parseJsonArray(value) {
    if (!value) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
