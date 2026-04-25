var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { randomUUID } from "crypto";
import { prisma } from '../prisma.js';
import { getOneCFinanceTruthSnapshot, } from "./one-c-client.js";
const ONE_C_EXPENSE_CATEGORY = {
    code: "one_c_actual_budget",
    name: "1C Actual Budget",
    color: "#0ea5e9",
    icon: "database",
};
export function getOneCExpenseSyncPreview() {
    return __awaiter(this, void 0, void 0, function* () {
        const snapshot = yield getOneCFinanceTruthSnapshot();
        const projects = yield prisma.project.findMany({
            select: { id: true, name: true },
        });
        const items = snapshot.projects.map((record) => mapRecordToExpenseItem(record, projects));
        return {
            sourceStatus: snapshot.status,
            configured: snapshot.configured,
            checkedAt: snapshot.checkedAt,
            missingSecrets: snapshot.missingSecrets,
            summary: {
                sourceProjectCount: snapshot.projects.length,
                matchedProjectCount: items.filter((item) => item.matchedProjectId).length,
                readyToSyncCount: items.filter((item) => item.action === "upsert").length,
                skippedCount: items.filter((item) => item.action === "skip").length,
            },
            items,
        };
    });
}
export function syncOneCExpenses() {
    return __awaiter(this, void 0, void 0, function* () {
        const preview = yield getOneCExpenseSyncPreview();
        const readyItems = preview.items.filter((item) => item.action === "upsert" && item.matchedProjectId);
        const category = yield prisma.expenseCategory.upsert({
            where: { code: ONE_C_EXPENSE_CATEGORY.code },
            update: {
                name: ONE_C_EXPENSE_CATEGORY.name,
                color: ONE_C_EXPENSE_CATEGORY.color,
                icon: ONE_C_EXPENSE_CATEGORY.icon,
            },
            create: {
                id: randomUUID(),
                code: ONE_C_EXPENSE_CATEGORY.code,
                name: ONE_C_EXPENSE_CATEGORY.name,
                color: ONE_C_EXPENSE_CATEGORY.color,
                icon: ONE_C_EXPENSE_CATEGORY.icon,
            },
        });
        let created = 0;
        let updated = 0;
        for (const item of readyItems) {
            const existing = yield prisma.expense.findFirst({
                where: { oneCRef: item.oneCRef },
                select: { id: true },
            });
            if (existing) {
                yield prisma.expense.update({
                    where: { id: existing.id },
                    data: {
                        projectId: item.matchedProjectId,
                        categoryId: category.id,
                        title: item.title,
                        description: item.description,
                        amount: item.amount,
                        currency: item.currency,
                        date: new Date(item.date),
                        status: item.status,
                        oneCRef: item.oneCRef,
                    },
                });
                updated += 1;
            }
            else {
                yield prisma.expense.create({
                    data: {
                        id: randomUUID(),
                        projectId: item.matchedProjectId,
                        categoryId: category.id,
                        title: item.title,
                        description: item.description,
                        amount: item.amount,
                        currency: item.currency,
                        date: new Date(item.date),
                        status: item.status,
                        oneCRef: item.oneCRef,
                    },
                });
                created += 1;
            }
        }
        return Object.assign(Object.assign({}, preview), { created,
            updated, skipped: preview.summary.skippedCount });
    });
}
export function mapRecordToExpenseItem(record, projects) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const matchedProject = (_a = (record.projectId
        ? projects.find((project) => project.id === record.projectId)
        : undefined)) !== null && _a !== void 0 ? _a : (record.projectName
        ? projects.find((project) => { var _a; return normalizeText(project.name) === normalizeText((_a = record.projectName) !== null && _a !== void 0 ? _a : ""); })
        : undefined);
    const amount = (_b = record.actualBudget) !== null && _b !== void 0 ? _b : 0;
    const date = (_c = record.reportDate) !== null && _c !== void 0 ? _c : new Date().toISOString();
    const titleBase = (_e = (_d = record.projectName) !== null && _d !== void 0 ? _d : record.projectId) !== null && _e !== void 0 ? _e : record.projectKey;
    if (!matchedProject) {
        return {
            oneCRef: `one-c:${record.projectKey}:actual-budget`,
            sourceProjectKey: record.projectKey,
            sourceProjectId: record.projectId,
            sourceProjectName: record.projectName,
            matchedProjectId: null,
            matchedProjectName: null,
            categoryCode: ONE_C_EXPENSE_CATEGORY.code,
            title: `1C actual budget · ${titleBase}`,
            description: buildDescription(record),
            amount,
            currency: (_f = record.currency) !== null && _f !== void 0 ? _f : "RUB",
            date,
            status: "approved",
            variance: record.variance,
            paymentGap: record.paymentGap,
            actGap: record.actGap,
            budgetDeltaStatus: record.budgetDeltaStatus,
            action: "skip",
            reason: "Project mapping not found",
        };
    }
    if (!(amount > 0)) {
        return {
            oneCRef: `one-c:${record.projectKey}:actual-budget`,
            sourceProjectKey: record.projectKey,
            sourceProjectId: record.projectId,
            sourceProjectName: record.projectName,
            matchedProjectId: matchedProject.id,
            matchedProjectName: matchedProject.name,
            categoryCode: ONE_C_EXPENSE_CATEGORY.code,
            title: `1C actual budget · ${titleBase}`,
            description: buildDescription(record),
            amount,
            currency: (_g = record.currency) !== null && _g !== void 0 ? _g : "RUB",
            date,
            status: "approved",
            variance: record.variance,
            paymentGap: record.paymentGap,
            actGap: record.actGap,
            budgetDeltaStatus: record.budgetDeltaStatus,
            action: "skip",
            reason: "Actual budget is empty",
        };
    }
    return {
        oneCRef: `one-c:${record.projectKey}:actual-budget`,
        sourceProjectKey: record.projectKey,
        sourceProjectId: record.projectId,
        sourceProjectName: record.projectName,
        matchedProjectId: matchedProject.id,
        matchedProjectName: matchedProject.name,
        categoryCode: ONE_C_EXPENSE_CATEGORY.code,
        title: `1C actual budget · ${titleBase}`,
        description: buildDescription(record),
        amount,
        currency: (_h = record.currency) !== null && _h !== void 0 ? _h : "RUB",
        date,
        status: "approved",
        variance: record.variance,
        paymentGap: record.paymentGap,
        actGap: record.actGap,
        budgetDeltaStatus: record.budgetDeltaStatus,
        action: "upsert",
    };
}
function buildDescription(record) {
    var _a;
    return [
        `1C source: ${(_a = record.projectId) !== null && _a !== void 0 ? _a : record.projectKey}`,
        record.reportDate ? `Report date: ${record.reportDate}` : null,
        record.plannedBudget !== null ? `Planned budget: ${record.plannedBudget}` : null,
        record.actualBudget !== null ? `Actual budget: ${record.actualBudget}` : null,
        record.paymentsActual !== null ? `Payments actual: ${record.paymentsActual}` : null,
        record.actsActual !== null ? `Acts actual: ${record.actsActual}` : null,
        record.variance !== null ? `Variance: ${record.variance}` : null,
    ]
        .filter(Boolean)
        .join(" | ");
}
function normalizeText(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}
