"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listWorkReports = listWorkReports;
exports.getWorkReportById = getWorkReportById;
exports.createWorkReport = createWorkReport;
exports.updateWorkReport = updateWorkReport;
exports.approveWorkReport = approveWorkReport;
exports.rejectWorkReport = rejectWorkReport;
exports.deleteWorkReport = deleteWorkReport;
exports.generateNextWorkReportNumber = generateNextWorkReportNumber;
exports.normalizeWorkReportStatus = normalizeWorkReportStatus;
const node_crypto_1 = require("node:crypto");
const prisma_1 = require("../prisma");
const mapper_1 = require("./mapper");
const workReportSelect = {
    id: true,
    reportNumber: true,
    projectId: true,
    authorId: true,
    reviewerId: true,
    section: true,
    reportDate: true,
    workDescription: true,
    volumesJson: true,
    personnelCount: true,
    personnelDetails: true,
    equipment: true,
    weather: true,
    issues: true,
    nextDayPlan: true,
    attachmentsJson: true,
    status: true,
    reviewComment: true,
    source: true,
    externalReporterTelegramId: true,
    externalReporterName: true,
    submittedAt: true,
    reviewedAt: true,
    createdAt: true,
    updatedAt: true,
};
async function listWorkReports(query = {}) {
    const rows = await prisma_1.prisma.workReport.findMany({
        where: {
            ...(query.projectId && { projectId: query.projectId }),
            ...(query.authorId && { authorId: query.authorId }),
            ...(query.status && { status: query.status }),
            ...(query.reportDate && {
                reportDate: {
                    gte: startOfDay(query.reportDate),
                    lt: endOfDay(query.reportDate),
                },
            }),
        },
        select: workReportSelect,
        orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
        take: query.limit ?? 50,
    });
    return hydrateWorkReportRows(rows);
}
async function getWorkReportById(id) {
    const record = await prisma_1.prisma.workReport.findUnique({
        where: { id },
        select: workReportSelect,
    });
    return record ? hydrateWorkReportRow(record) : null;
}
async function createWorkReport(input) {
    await ensureProjectExists(input.projectId);
    await ensureMemberExists(input.authorId, "Author");
    const reportNumber = input.reportNumber?.trim() || (await generateNextWorkReportNumber(input.reportDate));
    const created = await prisma_1.prisma.workReport.create({
        data: {
            id: (0, node_crypto_1.randomUUID)(),
            reportNumber,
            projectId: input.projectId,
            authorId: input.authorId,
            section: input.section,
            reportDate: new Date(input.reportDate),
            workDescription: input.workDescription,
            volumesJson: (0, mapper_1.serializeJsonArray)(input.volumes),
            personnelCount: input.personnelCount,
            personnelDetails: input.personnelDetails,
            equipment: input.equipment,
            weather: input.weather,
            issues: input.issues,
            nextDayPlan: input.nextDayPlan,
            attachmentsJson: (0, mapper_1.serializeJsonArray)(input.attachments),
            status: input.status ?? "submitted",
            source: input.source ?? "manual",
            externalReporterTelegramId: input.externalReporterTelegramId,
            externalReporterName: input.externalReporterName,
            updatedAt: new Date(),
        },
    });
    const hydrated = await getWorkReportById(created.id);
    if (!hydrated) {
        throw new Error("Failed to load created work report");
    }
    return hydrated;
}
async function updateWorkReport(id, input) {
    const existing = await prisma_1.prisma.workReport.findUnique({
        where: { id },
        select: {
            id: true,
            status: true,
            volumesJson: true,
            attachmentsJson: true,
        },
    });
    if (!existing) {
        throw new Error("Work report not found");
    }
    await prisma_1.prisma.workReport.update({
        where: { id },
        data: {
            ...(input.section !== undefined && { section: input.section }),
            ...(input.reportDate !== undefined && { reportDate: new Date(input.reportDate) }),
            ...(input.workDescription !== undefined && { workDescription: input.workDescription }),
            ...(input.volumes !== undefined && { volumesJson: (0, mapper_1.serializeJsonArray)(input.volumes) }),
            ...(input.personnelCount !== undefined && { personnelCount: input.personnelCount }),
            ...(input.personnelDetails !== undefined && { personnelDetails: normalizeNullable(input.personnelDetails) }),
            ...(input.equipment !== undefined && { equipment: normalizeNullable(input.equipment) }),
            ...(input.weather !== undefined && { weather: normalizeNullable(input.weather) }),
            ...(input.issues !== undefined && { issues: normalizeNullable(input.issues) }),
            ...(input.nextDayPlan !== undefined && { nextDayPlan: normalizeNullable(input.nextDayPlan) }),
            ...(input.attachments !== undefined && {
                attachmentsJson: (0, mapper_1.serializeJsonArray)(input.attachments),
            }),
            ...(existing.status !== "submitted"
                ? {
                    status: "submitted",
                    reviewerId: null,
                    reviewComment: null,
                    reviewedAt: null,
                }
                : {}),
        },
    });
    const hydrated = await getWorkReportById(id);
    if (!hydrated) {
        throw new Error("Failed to load updated work report");
    }
    return hydrated;
}
async function approveWorkReport(id, input) {
    await ensureMemberExists(input.reviewerId, "Reviewer");
    await prisma_1.prisma.workReport.update({
        where: { id },
        data: {
            status: "approved",
            reviewerId: input.reviewerId,
            reviewComment: normalizeNullable(input.reviewComment),
            reviewedAt: new Date(),
        },
    });
    const hydrated = await getWorkReportById(id);
    if (!hydrated) {
        throw new Error("Failed to load approved work report");
    }
    return hydrated;
}
async function rejectWorkReport(id, input) {
    await ensureMemberExists(input.reviewerId, "Reviewer");
    await prisma_1.prisma.workReport.update({
        where: { id },
        data: {
            status: "rejected",
            reviewerId: input.reviewerId,
            reviewComment: input.reviewComment.trim(),
            reviewedAt: new Date(),
        },
    });
    const hydrated = await getWorkReportById(id);
    if (!hydrated) {
        throw new Error("Failed to load rejected work report");
    }
    return hydrated;
}
async function deleteWorkReport(id) {
    await prisma_1.prisma.workReport.delete({
        where: { id },
    });
}
async function generateNextWorkReportNumber(reportDate) {
    const date = new Date(reportDate);
    const prefix = `#${date.toISOString().slice(0, 10).replaceAll("-", "")}`;
    const count = await prisma_1.prisma.workReport.count({
        where: {
            reportNumber: {
                startsWith: prefix,
            },
        },
    });
    return `${prefix}${String(count + 1).padStart(4, "0")}`;
}
function normalizeWorkReportStatus(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    switch (value.trim()) {
        case "submitted":
        case "approved":
        case "rejected":
            return value.trim();
        default:
            return undefined;
    }
}
function normalizeNullable(value) {
    if (value === undefined) {
        return null;
    }
    if (value === null) {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
async function hydrateWorkReportRows(rows) {
    if (rows.length === 0) {
        return [];
    }
    const projectIds = [...new Set(rows.map((row) => row.projectId))];
    const authorIds = [...new Set(rows.map((row) => row.authorId))];
    const reviewerIds = [...new Set(rows.map((row) => row.reviewerId).filter((id) => Boolean(id)))];
    const [projects, authors, reviewers] = await Promise.all([
        projectIds.length
            ? prisma_1.prisma.project.findMany({
                where: { id: { in: projectIds } },
                select: { id: true, name: true },
            })
            : Promise.resolve([]),
        authorIds.length
            ? prisma_1.prisma.teamMember.findMany({
                where: { id: { in: authorIds } },
                select: { id: true, name: true, initials: true, role: true },
            })
            : Promise.resolve([]),
        reviewerIds.length
            ? prisma_1.prisma.teamMember.findMany({
                where: { id: { in: reviewerIds } },
                select: { id: true, name: true, initials: true, role: true },
            })
            : Promise.resolve([]),
    ]);
    const relationMaps = {
        projects: new Map(projects.map((project) => [project.id, project])),
        authors: new Map(authors.map((author) => [author.id, author])),
        reviewers: new Map(reviewers.map((reviewer) => [reviewer.id, reviewer])),
    };
    return rows.map((row) => hydrateWorkReportRow(row, relationMaps));
}
function hydrateWorkReportRow(record, relations) {
    const fallbackProject = {
        id: record.projectId,
        name: "Проект не найден",
    };
    const fallbackAuthor = {
        id: record.authorId,
        name: "Участник не найден",
        initials: null,
        role: null,
    };
    const project = relations?.projects.get(record.projectId) ?? fallbackProject;
    const author = relations?.authors.get(record.authorId) ?? fallbackAuthor;
    const reviewer = record.reviewerId
        ? relations?.reviewers.get(record.reviewerId) ?? {
            id: record.reviewerId,
            name: "Проверяющий не найден",
            initials: null,
            role: null,
        }
        : null;
    return {
        id: record.id,
        reportNumber: record.reportNumber,
        projectId: record.projectId,
        project,
        authorId: record.authorId,
        author,
        reviewerId: record.reviewerId,
        reviewer,
        section: record.section,
        reportDate: record.reportDate.toISOString(),
        workDescription: record.workDescription,
        volumes: (0, mapper_1.parseJsonArray)(record.volumesJson),
        personnelCount: record.personnelCount,
        personnelDetails: record.personnelDetails,
        equipment: record.equipment,
        weather: record.weather,
        issues: record.issues,
        nextDayPlan: record.nextDayPlan,
        attachments: (0, mapper_1.parseJsonArray)(record.attachmentsJson),
        status: normalizeWorkReportStatus(record.status) ?? "submitted",
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
function startOfDay(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
}
function endOfDay(value) {
    const date = startOfDay(value);
    date.setDate(date.getDate() + 1);
    return date;
}
async function ensureProjectExists(projectId) {
    const project = await prisma_1.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
    });
    if (!project) {
        throw new Error("Project not found for work report.");
    }
}
async function ensureMemberExists(memberId, role) {
    const member = await prisma_1.prisma.teamMember.findUnique({
        where: { id: memberId },
        select: { id: true },
    });
    if (!member) {
        throw new Error(`Team member not found for ${role.toLowerCase()} work report.`);
    }
}
