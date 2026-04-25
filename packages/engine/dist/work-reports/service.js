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
import { parseJsonArray, serializeJsonArray } from "./mapper.js";
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
export function listWorkReports() {
    return __awaiter(this, arguments, void 0, function* (query = {}) {
        var _a;
        const rows = yield prisma.workReport.findMany({
            where: Object.assign(Object.assign(Object.assign(Object.assign({}, (query.projectId && { projectId: query.projectId })), (query.authorId && { authorId: query.authorId })), (query.status && { status: query.status })), (query.reportDate && {
                reportDate: {
                    gte: startOfDay(query.reportDate),
                    lt: endOfDay(query.reportDate),
                },
            })),
            select: workReportSelect,
            orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
            take: (_a = query.limit) !== null && _a !== void 0 ? _a : 50,
        });
        return hydrateWorkReportRows(rows);
    });
}
export function getWorkReportById(id) {
    return __awaiter(this, void 0, void 0, function* () {
        const record = yield prisma.workReport.findUnique({
            where: { id },
            select: workReportSelect,
        });
        return record ? hydrateWorkReportRow(record) : null;
    });
}
export function createWorkReport(input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        yield ensureProjectExists(input.projectId);
        yield ensureMemberExists(input.authorId, "Author");
        const reportNumber = ((_a = input.reportNumber) === null || _a === void 0 ? void 0 : _a.trim()) || (yield generateNextWorkReportNumber(input.reportDate));
        const created = yield prisma.workReport.create({
            data: {
                id: randomUUID(),
                reportNumber,
                projectId: input.projectId,
                authorId: input.authorId,
                section: input.section,
                reportDate: new Date(input.reportDate),
                workDescription: input.workDescription,
                volumesJson: serializeJsonArray(input.volumes),
                personnelCount: input.personnelCount,
                personnelDetails: input.personnelDetails,
                equipment: input.equipment,
                weather: input.weather,
                issues: input.issues,
                nextDayPlan: input.nextDayPlan,
                attachmentsJson: serializeJsonArray(input.attachments),
                status: (_b = input.status) !== null && _b !== void 0 ? _b : "submitted",
                source: (_c = input.source) !== null && _c !== void 0 ? _c : "manual",
                externalReporterTelegramId: input.externalReporterTelegramId,
                externalReporterName: input.externalReporterName,
                updatedAt: new Date(),
            },
        });
        const hydrated = yield getWorkReportById(created.id);
        if (!hydrated) {
            throw new Error("Failed to load created work report");
        }
        return hydrated;
    });
}
export function updateWorkReport(id, input) {
    return __awaiter(this, void 0, void 0, function* () {
        const existing = yield prisma.workReport.findUnique({
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
        yield prisma.workReport.update({
            where: { id },
            data: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (input.section !== undefined && { section: input.section })), (input.reportDate !== undefined && { reportDate: new Date(input.reportDate) })), (input.workDescription !== undefined && { workDescription: input.workDescription })), (input.volumes !== undefined && { volumesJson: serializeJsonArray(input.volumes) })), (input.personnelCount !== undefined && { personnelCount: input.personnelCount })), (input.personnelDetails !== undefined && { personnelDetails: normalizeNullable(input.personnelDetails) })), (input.equipment !== undefined && { equipment: normalizeNullable(input.equipment) })), (input.weather !== undefined && { weather: normalizeNullable(input.weather) })), (input.issues !== undefined && { issues: normalizeNullable(input.issues) })), (input.nextDayPlan !== undefined && { nextDayPlan: normalizeNullable(input.nextDayPlan) })), (input.attachments !== undefined && {
                attachmentsJson: serializeJsonArray(input.attachments),
            })), (existing.status !== "submitted"
                ? {
                    status: "submitted",
                    reviewerId: null,
                    reviewComment: null,
                    reviewedAt: null,
                }
                : {})),
        });
        const hydrated = yield getWorkReportById(id);
        if (!hydrated) {
            throw new Error("Failed to load updated work report");
        }
        return hydrated;
    });
}
export function approveWorkReport(id, input) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureMemberExists(input.reviewerId, "Reviewer");
        yield prisma.workReport.update({
            where: { id },
            data: {
                status: "approved",
                reviewerId: input.reviewerId,
                reviewComment: normalizeNullable(input.reviewComment),
                reviewedAt: new Date(),
            },
        });
        const hydrated = yield getWorkReportById(id);
        if (!hydrated) {
            throw new Error("Failed to load approved work report");
        }
        return hydrated;
    });
}
export function rejectWorkReport(id, input) {
    return __awaiter(this, void 0, void 0, function* () {
        yield ensureMemberExists(input.reviewerId, "Reviewer");
        yield prisma.workReport.update({
            where: { id },
            data: {
                status: "rejected",
                reviewerId: input.reviewerId,
                reviewComment: input.reviewComment.trim(),
                reviewedAt: new Date(),
            },
        });
        const hydrated = yield getWorkReportById(id);
        if (!hydrated) {
            throw new Error("Failed to load rejected work report");
        }
        return hydrated;
    });
}
export function deleteWorkReport(id) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prisma.workReport.delete({
            where: { id },
        });
    });
}
export function generateNextWorkReportNumber(reportDate) {
    return __awaiter(this, void 0, void 0, function* () {
        const date = new Date(reportDate);
        const prefix = `#${date.toISOString().slice(0, 10).replaceAll("-", "")}`;
        const count = yield prisma.workReport.count({
            where: {
                reportNumber: {
                    startsWith: prefix,
                },
            },
        });
        return `${prefix}${String(count + 1).padStart(4, "0")}`;
    });
}
export function normalizeWorkReportStatus(value) {
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
function hydrateWorkReportRows(rows) {
    return __awaiter(this, void 0, void 0, function* () {
        if (rows.length === 0) {
            return [];
        }
        const projectIds = [...new Set(rows.map((row) => row.projectId))];
        const authorIds = [...new Set(rows.map((row) => row.authorId))];
        const reviewerIds = [...new Set(rows.map((row) => row.reviewerId).filter((id) => Boolean(id)))];
        const [projects, authors, reviewers] = yield Promise.all([
            projectIds.length
                ? prisma.project.findMany({
                    where: { id: { in: projectIds } },
                    select: { id: true, name: true },
                })
                : Promise.resolve([]),
            authorIds.length
                ? prisma.teamMember.findMany({
                    where: { id: { in: authorIds } },
                    select: { id: true, name: true, initials: true, role: true },
                })
                : Promise.resolve([]),
            reviewerIds.length
                ? prisma.teamMember.findMany({
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
    });
}
function hydrateWorkReportRow(record, relations) {
    var _a, _b, _c, _d, _e, _f;
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
    const project = (_a = relations === null || relations === void 0 ? void 0 : relations.projects.get(record.projectId)) !== null && _a !== void 0 ? _a : fallbackProject;
    const author = (_b = relations === null || relations === void 0 ? void 0 : relations.authors.get(record.authorId)) !== null && _b !== void 0 ? _b : fallbackAuthor;
    const reviewer = record.reviewerId
        ? (_c = relations === null || relations === void 0 ? void 0 : relations.reviewers.get(record.reviewerId)) !== null && _c !== void 0 ? _c : {
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
        volumes: parseJsonArray(record.volumesJson),
        personnelCount: record.personnelCount,
        personnelDetails: record.personnelDetails,
        equipment: record.equipment,
        weather: record.weather,
        issues: record.issues,
        nextDayPlan: record.nextDayPlan,
        attachments: parseJsonArray(record.attachmentsJson),
        status: (_d = normalizeWorkReportStatus(record.status)) !== null && _d !== void 0 ? _d : "submitted",
        reviewComment: record.reviewComment,
        source: record.source,
        externalReporterTelegramId: record.externalReporterTelegramId,
        externalReporterName: record.externalReporterName,
        submittedAt: record.submittedAt.toISOString(),
        reviewedAt: (_f = (_e = record.reviewedAt) === null || _e === void 0 ? void 0 : _e.toISOString()) !== null && _f !== void 0 ? _f : null,
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
function ensureProjectExists(projectId) {
    return __awaiter(this, void 0, void 0, function* () {
        const project = yield prisma.project.findUnique({
            where: { id: projectId },
            select: { id: true },
        });
        if (!project) {
            throw new Error("Project not found for work report.");
        }
    });
}
function ensureMemberExists(memberId, role) {
    return __awaiter(this, void 0, void 0, function* () {
        const member = yield prisma.teamMember.findUnique({
            where: { id: memberId },
            select: { id: true },
        });
        if (!member) {
            throw new Error(`Team member not found for ${role.toLowerCase()} work report.`);
        }
    });
}
