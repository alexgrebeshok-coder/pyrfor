var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { syncOneCExpenses } from '../../connectors/one-c-expense-sync.js';
import { getProjectEvmSnapshot } from '../../evm/snapshot-service.js';
import { prisma } from '../../prisma.js';
import { generateToolEntityId, resolveActiveProjectId } from './shared.js';
function slugifyCategory(value) {
    return (value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60) || "general");
}
function resolveExpenseCategory(categoryCode, categoryName) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const code = slugifyCategory((_a = categoryCode !== null && categoryCode !== void 0 ? categoryCode : categoryName) !== null && _a !== void 0 ? _a : "general");
        const name = ((_b = categoryName !== null && categoryName !== void 0 ? categoryName : categoryCode) !== null && _b !== void 0 ? _b : "General").trim();
        const existing = yield prisma.expenseCategory.findFirst({
            where: {
                OR: [
                    { code },
                    ...(categoryName
                        ? [{ name: { equals: categoryName, mode: "insensitive" } }]
                        : []),
                ],
            },
            select: { id: true, code: true, name: true },
        });
        if (existing) {
            return existing;
        }
        return prisma.expenseCategory.create({
            data: {
                id: generateToolEntityId(),
                code,
                name,
                color: null,
                icon: null,
            },
            select: { id: true, code: true, name: true },
        });
    });
}
export const financeToolService = {
    createExpense(toolCallId, args) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const title = String((_a = args.title) !== null && _a !== void 0 ? _a : "").trim();
            const amount = Number(args.amount);
            if (!title) {
                return {
                    toolCallId,
                    name: "create_expense",
                    success: false,
                    result: { error: "Title is required" },
                    displayMessage: "❌ Название расхода обязательно",
                };
            }
            if (!(amount > 0)) {
                return {
                    toolCallId,
                    name: "create_expense",
                    success: false,
                    result: { error: "Amount must be positive" },
                    displayMessage: "❌ Сумма расхода должна быть больше нуля",
                };
            }
            const projectId = yield resolveActiveProjectId(args.projectId);
            if (!projectId) {
                return {
                    toolCallId,
                    name: "create_expense",
                    success: false,
                    result: { error: "No project found" },
                    displayMessage: "❌ Нет доступного проекта для записи расхода",
                };
            }
            const category = yield resolveExpenseCategory(args.categoryCode, args.categoryName);
            const expense = yield prisma.expense.create({
                data: {
                    id: generateToolEntityId(),
                    projectId,
                    categoryId: category.id,
                    title,
                    description: args.description ? String(args.description) : null,
                    amount,
                    currency: String((_b = args.currency) !== null && _b !== void 0 ? _b : "RUB"),
                    date: args.date ? new Date(String(args.date)) : new Date(),
                    status: String((_c = args.status) !== null && _c !== void 0 ? _c : "approved"),
                    supplierId: (_d = args.supplierId) !== null && _d !== void 0 ? _d : null,
                    taskId: (_e = args.taskId) !== null && _e !== void 0 ? _e : null,
                    equipmentId: (_f = args.equipmentId) !== null && _f !== void 0 ? _f : null,
                },
                include: {
                    project: { select: { name: true } },
                    category: { select: { name: true, code: true } },
                },
            });
            return {
                toolCallId,
                name: "create_expense",
                success: true,
                result: {
                    expenseId: expense.id,
                    projectId: expense.projectId,
                    projectName: expense.project.name,
                    categoryId: expense.categoryId,
                    categoryCode: expense.category.code,
                    amount: expense.amount,
                    status: expense.status,
                },
                displayMessage: `💸 Расход записан: **${expense.title}** на ${expense.amount.toLocaleString("ru-RU")} ${expense.currency} в проекте "${expense.project.name}"`,
            };
        });
    },
    getBudgetSummary(toolCallId, args) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const projectId = args.projectId ? String(args.projectId) : undefined;
            if (projectId) {
                const project = yield prisma.project.findUnique({
                    where: { id: projectId },
                    select: {
                        id: true,
                        name: true,
                        budgetPlan: true,
                        budgetFact: true,
                    },
                });
                if (!project) {
                    return {
                        toolCallId,
                        name: "get_budget_summary",
                        success: false,
                        result: { error: `Project ${projectId} not found` },
                        displayMessage: `❌ Проект ${projectId} не найден`,
                    };
                }
                const [expenses, evm] = yield Promise.all([
                    prisma.expense.findMany({
                        where: { projectId },
                        select: {
                            amount: true,
                            status: true,
                            category: { select: { name: true } },
                        },
                    }),
                    getProjectEvmSnapshot(projectId).catch(() => null),
                ]);
                const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
                const approved = expenses
                    .filter((expense) => expense.status === "approved" || expense.status === "paid")
                    .reduce((sum, expense) => sum + expense.amount, 0);
                const topCategories = Object.values(expenses.reduce((acc, expense) => {
                    var _a;
                    const current = (_a = acc[expense.category.name]) !== null && _a !== void 0 ? _a : { name: expense.category.name, amount: 0 };
                    current.amount += expense.amount;
                    acc[expense.category.name] = current;
                    return acc;
                }, {}))
                    .sort((left, right) => right.amount - left.amount)
                    .slice(0, 5);
                return {
                    toolCallId,
                    name: "get_budget_summary",
                    success: true,
                    result: {
                        projectId: project.id,
                        projectName: project.name,
                        budgetPlan: project.budgetPlan,
                        budgetFact: project.budgetFact,
                        expenseTotal: total,
                        approvedTotal: approved,
                        topCategories,
                        evm: (_a = evm === null || evm === void 0 ? void 0 : evm.metrics) !== null && _a !== void 0 ? _a : null,
                    },
                    displayMessage: `💰 **${project.name}** — план: ${((_b = project.budgetPlan) !== null && _b !== void 0 ? _b : 0).toLocaleString("ru-RU")}, факт: ${((_c = project.budgetFact) !== null && _c !== void 0 ? _c : total).toLocaleString("ru-RU")}, расходы: ${total.toLocaleString("ru-RU")}`,
                };
            }
            const projects = yield prisma.project.findMany({
                where: { status: { not: "archived" } },
                select: {
                    id: true,
                    name: true,
                    budgetPlan: true,
                    budgetFact: true,
                    expenses: { select: { amount: true } },
                },
                orderBy: { updatedAt: "desc" },
                take: 10,
            });
            const summary = projects.map((project) => {
                var _a, _b;
                return ({
                    id: project.id,
                    name: project.name,
                    budgetPlan: (_a = project.budgetPlan) !== null && _a !== void 0 ? _a : 0,
                    budgetFact: (_b = project.budgetFact) !== null && _b !== void 0 ? _b : 0,
                    expenseTotal: project.expenses.reduce((sum, expense) => sum + expense.amount, 0),
                });
            });
            return {
                toolCallId,
                name: "get_budget_summary",
                success: true,
                result: { projects: summary },
                displayMessage: `💰 Бюджетная сводка по ${summary.length} проектам готова`,
            };
        });
    },
    syncOneC(toolCallId) {
        return __awaiter(this, void 0, void 0, function* () {
            const result = yield syncOneCExpenses();
            return {
                toolCallId,
                name: "sync_1c",
                success: true,
                result: {
                    sourceStatus: result.sourceStatus,
                    checkedAt: result.checkedAt,
                    created: result.created,
                    updated: result.updated,
                    skipped: result.skipped,
                    readyToSyncCount: result.summary.readyToSyncCount,
                },
                displayMessage: `🔄 1C sync завершён: создано ${result.created}, обновлено ${result.updated}, пропущено ${result.skipped}`,
            };
        });
    },
};
