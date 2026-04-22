import { syncOneCExpenses } from '../../connectors/one-c-expense-sync';
import { getProjectEvmSnapshot } from '../../evm/snapshot-service';
import { prisma } from '../../prisma';
import type { AIToolResult } from '../tools';
import { generateToolEntityId, resolveActiveProjectId } from './shared';

function slugifyCategory(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "general"
  );
}

async function resolveExpenseCategory(categoryCode?: string, categoryName?: string) {
  const code = slugifyCategory(categoryCode ?? categoryName ?? "general");
  const name = (categoryName ?? categoryCode ?? "General").trim();

  const existing = await prisma.expenseCategory.findFirst({
    where: {
      OR: [
        { code },
        ...(categoryName
          ? [{ name: { equals: categoryName, mode: "insensitive" as const } }]
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
}

export const financeToolService = {
  async createExpense(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult> {
    const title = String(args.title ?? "").trim();
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

    const projectId = await resolveActiveProjectId(args.projectId as string | undefined);
    if (!projectId) {
      return {
        toolCallId,
        name: "create_expense",
        success: false,
        result: { error: "No project found" },
        displayMessage: "❌ Нет доступного проекта для записи расхода",
      };
    }

    const category = await resolveExpenseCategory(
      args.categoryCode as string | undefined,
      args.categoryName as string | undefined
    );

    const expense = await prisma.expense.create({
      data: {
        id: generateToolEntityId(),
        projectId,
        categoryId: category.id,
        title,
        description: args.description ? String(args.description) : null,
        amount,
        currency: String(args.currency ?? "RUB"),
        date: args.date ? new Date(String(args.date)) : new Date(),
        status: String(args.status ?? "approved"),
        supplierId: (args.supplierId as string | undefined) ?? null,
        taskId: (args.taskId as string | undefined) ?? null,
        equipmentId: (args.equipmentId as string | undefined) ?? null,
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
  },

  async getBudgetSummary(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult> {
    const projectId = args.projectId ? String(args.projectId) : undefined;

    if (projectId) {
      const project = await prisma.project.findUnique({
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

      const [expenses, evm] = await Promise.all([
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
      const topCategories = Object.values(
        expenses.reduce<Record<string, { name: string; amount: number }>>((acc, expense) => {
          const current = acc[expense.category.name] ?? { name: expense.category.name, amount: 0 };
          current.amount += expense.amount;
          acc[expense.category.name] = current;
          return acc;
        }, {})
      )
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
          evm: evm?.metrics ?? null,
        },
        displayMessage: `💰 **${project.name}** — план: ${(project.budgetPlan ?? 0).toLocaleString("ru-RU")}, факт: ${(project.budgetFact ?? total).toLocaleString("ru-RU")}, расходы: ${total.toLocaleString("ru-RU")}`,
      };
    }

    const projects = await prisma.project.findMany({
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

    const summary = projects.map((project) => ({
      id: project.id,
      name: project.name,
      budgetPlan: project.budgetPlan ?? 0,
      budgetFact: project.budgetFact ?? 0,
      expenseTotal: project.expenses.reduce((sum, expense) => sum + expense.amount, 0),
    }));

    return {
      toolCallId,
      name: "get_budget_summary",
      success: true,
      result: { projects: summary },
      displayMessage: `💰 Бюджетная сводка по ${summary.length} проектам готова`,
    };
  },

  async syncOneC(toolCallId: string): Promise<AIToolResult> {
    const result = await syncOneCExpenses();

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
  },
};
