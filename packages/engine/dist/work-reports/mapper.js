export function mapAIPMOBotWorkReportToCreateInput(report, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    return {
        projectId: options.projectId,
        authorId: options.authorId,
        section: report.section,
        reportDate: report.report_date,
        workDescription: report.work_description,
        volumes: (_a = report.volumes) !== null && _a !== void 0 ? _a : [],
        personnelCount: (_b = report.personnel_count) !== null && _b !== void 0 ? _b : undefined,
        personnelDetails: (_c = report.personnel_details) !== null && _c !== void 0 ? _c : undefined,
        equipment: (_d = report.equipment) !== null && _d !== void 0 ? _d : undefined,
        weather: (_e = report.weather) !== null && _e !== void 0 ? _e : undefined,
        issues: (_f = report.issues) !== null && _f !== void 0 ? _f : undefined,
        nextDayPlan: (_g = report.next_day_plan) !== null && _g !== void 0 ? _g : undefined,
        attachments: (_h = report.attachments) !== null && _h !== void 0 ? _h : [],
        reportNumber: report.report_id,
        status: (_j = report.status) !== null && _j !== void 0 ? _j : "submitted",
        source: "telegram_bot",
        externalReporterTelegramId: String(report.reporter_telegram_id),
        externalReporterName: (_k = report.reporter_name) !== null && _k !== void 0 ? _k : undefined,
    };
}
export function serializeWorkReportRecord(record) {
    var _a, _b;
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
        reviewedAt: (_b = (_a = record.reviewedAt) === null || _a === void 0 ? void 0 : _a.toISOString()) !== null && _b !== void 0 ? _b : null,
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
export function serializeJsonArray(value) {
    return JSON.stringify(Array.isArray(value) ? value : [], null, 0);
}
export function parseJsonArray(value) {
    if (!value) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (_a) {
        return [];
    }
}
