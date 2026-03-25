/**
 * AI Tool Executor — executes function calls against the database
 *
 * Each tool maps to real Prisma CRUD operations.
 * Returns structured results with user-facing display messages.
 */

import { PrismaClient } from "@prisma/client";
import { syncOneCExpenses } from "@/lib/connectors/one-c-expense-sync";
import { getProjectEvmSnapshot } from "@/lib/evm/snapshot-service";
import { calculateCriticalPath } from "@/lib/scheduling/critical-path";
import { getProjectSchedulingContext } from "@/lib/scheduling/service";
import { levelResources } from "@/lib/scheduling/resource-leveling";
import type { AIToolCall, AIToolName, AIToolResult } from "./tools";

const prisma = new PrismaClient();

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function executeToolCall(call: AIToolCall): Promise<AIToolResult> {
  const name = call.function.name as AIToolName;
  let args: Record<string, unknown>;

  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return {
      toolCallId: call.id,
      name,
      success: false,
      result: { error: "Invalid JSON arguments" },
      displayMessage: "❌ Ошибка: некорректные аргументы",
    };
  }

  try {
    switch (name) {
      case "create_task":
        return await executeCreateTask(call.id, args);
      case "create_risk":
        return await executeCreateRisk(call.id, args);
      case "update_task":
        return await executeUpdateTask(call.id, args);
      case "get_project_summary":
        return await executeGetProjectSummary(call.id, args);
      case "list_tasks":
        return await executeListTasks(call.id, args);
      case "generate_brief":
        return await executeGenerateBrief(call.id, args);
      case "create_expense":
        return await executeCreateExpense(call.id, args);
      case "get_budget_summary":
        return await executeGetBudgetSummary(call.id, args);
      case "list_equipment":
        return await executeListEquipment(call.id, args);
      case "create_material_movement":
        return await executeCreateMaterialMovement(call.id, args);
      case "get_critical_path":
        return await executeGetCriticalPath(call.id, args);
      case "get_resource_load":
        return await executeGetResourceLoad(call.id, args);
      case "sync_1c":
        return await executeSyncOneC(call.id);
      default:
        return {
          toolCallId: call.id,
          name,
          success: false,
          result: { error: `Unknown tool: ${name}` },
          displayMessage: `❌ Неизвестный инструмент: ${name}`,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      toolCallId: call.id,
      name,
      success: false,
      result: { error: message },
      displayMessage: `❌ Ошибка: ${message}`,
    };
  }
}

export async function executeToolCalls(
  calls: AIToolCall[],
): Promise<AIToolResult[]> {
  return Promise.all(calls.map(executeToolCall));
}

// ─── Tool Implementations ───────────────────────────────────────────────────

async function resolveProjectId(
  projectId?: string,
): Promise<string | null> {
  if (projectId) return projectId;

  const first = await prisma.project.findFirst({
    where: { status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  return first?.id ?? null;
}

function slugifyCategory(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "general";
}

async function resolveExpenseCategory(
  categoryCode?: string,
  categoryName?: string,
) {
  const code = slugifyCategory(categoryCode ?? categoryName ?? "general");
  const name = (categoryName ?? categoryCode ?? "General").trim();

  const existing = await prisma.expenseCategory.findFirst({
    where: {
      OR: [
        { code },
        ...(categoryName ? [{ name: { equals: categoryName, mode: "insensitive" as const } }] : []),
      ],
    },
    select: { id: true, code: true, name: true },
  });

  if (existing) {
    return existing;
  }

  return prisma.expenseCategory.create({
    data: {
      id: generateId(),
      code,
      name,
      color: null,
      icon: null,
    },
    select: { id: true, code: true, name: true },
  });
}

async function resolveMaterialId(
  materialId?: string,
  materialName?: string,
): Promise<{ id: string; name: string; currentStock: number } | null> {
  if (materialId) {
    return prisma.material.findUnique({
      where: { id: materialId },
      select: { id: true, name: true, currentStock: true },
    });
  }

  if (!materialName) return null;

  return prisma.material.findFirst({
    where: { name: { equals: materialName, mode: "insensitive" } },
    select: { id: true, name: true, currentStock: true },
    orderBy: { updatedAt: "desc" },
  });
}

async function executeCreateTask(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const title = String(args.title ?? "");
  if (!title) {
    return {
      toolCallId,
      name: "create_task",
      success: false,
      result: { error: "Title is required" },
      displayMessage: "❌ Название задачи обязательно",
    };
  }

  const projectId = await resolveProjectId(args.projectId as string | undefined);
  if (!projectId) {
    return {
      toolCallId,
      name: "create_task",
      success: false,
      result: { error: "No project found" },
      displayMessage: "❌ Нет доступных проектов для создания задачи",
    };
  }

  const id = generateId();
  const dueDate = args.dueDate
    ? new Date(String(args.dueDate))
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // default: +7 days

  const task = await prisma.task.create({
    data: {
      id,
      title,
      description: (args.description as string) ?? null,
      status: (args.status as string) ?? "todo",
      priority: (args.priority as string) ?? "medium",
      dueDate,
      projectId,
    },
    include: { project: { select: { name: true } } },
  });

  return {
    toolCallId,
    name: "create_task",
    success: true,
    result: {
      taskId: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      projectName: task.project.name,
      dueDate: task.dueDate.toISOString(),
    },
    displayMessage: `✅ Задача создана: **${task.title}** [${task.priority}] в проекте "${task.project.name}"`,
  };
}

async function executeCreateRisk(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const title = String(args.title ?? "");
  if (!title) {
    return {
      toolCallId,
      name: "create_risk",
      success: false,
      result: { error: "Title is required" },
      displayMessage: "❌ Название риска обязательно",
    };
  }

  const projectId = await resolveProjectId(args.projectId as string | undefined);
  if (!projectId) {
    return {
      toolCallId,
      name: "create_risk",
      success: false,
      result: { error: "No project found" },
      displayMessage: "❌ Нет доступных проектов",
    };
  }

  const severityMap: Record<string, number> = {
    low: 2,
    medium: 3,
    high: 4,
    critical: 5,
  };

  const severity = (args.severity as string) ?? "medium";

  const risk = await prisma.risk.create({
    data: {
      id: generateId(),
      title,
      description: (args.description as string) ?? null,
      probability: (args.probability as string) ?? "medium",
      impact: severity,
      severity: severityMap[severity] ?? 3,
      status: "open",
      projectId,
    },
    include: { project: { select: { name: true } } },
  });

  return {
    toolCallId,
    name: "create_risk",
    success: true,
    result: {
      riskId: risk.id,
      title: risk.title,
      severity: risk.impact,
      projectName: risk.project.name,
    },
    displayMessage: `⚠️ Риск зарегистрирован: **${risk.title}** [${risk.impact}] в проекте "${risk.project.name}"`,
  };
}

async function executeUpdateTask(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const taskId = String(args.taskId ?? "");
  if (!taskId) {
    return {
      toolCallId,
      name: "update_task",
      success: false,
      result: { error: "taskId is required" },
      displayMessage: "❌ ID задачи обязателен",
    };
  }

  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) {
    return {
      toolCallId,
      name: "update_task",
      success: false,
      result: { error: `Task ${taskId} not found` },
      displayMessage: `❌ Задача ${taskId} не найдена`,
    };
  }

  const data: Record<string, unknown> = {};
  if (args.title) data.title = String(args.title);
  if (args.status) data.status = String(args.status);
  if (args.priority) data.priority = String(args.priority);
  if (args.description) data.description = String(args.description);
  if (args.dueDate) data.dueDate = new Date(String(args.dueDate));
  if (args.status === "done") data.completedAt = new Date();

  const task = await prisma.task.update({
    where: { id: taskId },
    data,
  });

  const changes = Object.keys(data).join(", ");
  return {
    toolCallId,
    name: "update_task",
    success: true,
    result: {
      taskId: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      updated: changes,
    },
    displayMessage: `✅ Задача обновлена: **${task.title}** (${changes})`,
  };
}

async function executeGetProjectSummary(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const projectId = args.projectId as string | undefined;

  const where = projectId
    ? { id: projectId }
    : { status: { not: "archived" } };

  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true,
      name: true,
      status: true,
      progress: true,
      health: true,
      budgetPlan: true,
      budgetFact: true,
      _count: { select: { tasks: true, risks: true } },
    },
    take: 10,
    orderBy: { updatedAt: "desc" },
  });

  if (projects.length === 0) {
    return {
      toolCallId,
      name: "get_project_summary",
      success: true,
      result: { projects: [] },
      displayMessage: "📊 Нет активных проектов",
    };
  }

  const summaries = projects.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    progress: p.progress,
    health: p.health,
    tasks: p._count.tasks,
    risks: p._count.risks,
    budgetPlan: p.budgetPlan,
    budgetFact: p.budgetFact,
  }));

  const lines = summaries.map(
    (s) =>
      `• **${s.name}** — ${s.progress}% | ${s.health} | ${s.tasks} задач, ${s.risks} рисков`,
  );

  return {
    toolCallId,
    name: "get_project_summary",
    success: true,
    result: { projects: summaries },
    displayMessage: `📊 **Проекты (${summaries.length}):**\n${lines.join("\n")}`,
  };
}

async function executeListTasks(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const where: Record<string, unknown> = {};

  if (args.projectId) where.projectId = String(args.projectId);
  if (args.status) where.status = String(args.status);
  if (args.priority) where.priority = String(args.priority);
  if (args.overdue) {
    where.dueDate = { lt: new Date() };
    where.status = { not: "done" };
  }

  const limit = Math.min(Number(args.limit) || 10, 20);

  const tasks = await prisma.task.findMany({
    where,
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      project: { select: { name: true } },
    },
    orderBy: { dueDate: "asc" },
    take: limit,
  });

  const lines = tasks.map((t) => {
    const overdue = t.dueDate < new Date() && t.status !== "done" ? " ⏰" : "";
    const emoji =
      t.priority === "critical"
        ? "🔴"
        : t.priority === "high"
          ? "🟠"
          : t.priority === "medium"
            ? "🟡"
            : "⚪";
    return `${emoji} **${t.title}**${overdue} — ${t.status} [${t.project.name}]`;
  });

  return {
    toolCallId,
    name: "list_tasks",
    success: true,
    result: { tasks: tasks.map((t) => ({ ...t, projectName: t.project.name })), count: tasks.length },
    displayMessage:
      tasks.length > 0
        ? `📋 **Задачи (${tasks.length}):**\n${lines.join("\n")}`
        : "📋 Задачи не найдены по заданным фильтрам",
  };
}

async function executeGenerateBrief(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const projectFilter = args.projectId
    ? { projectId: String(args.projectId) }
    : {};

  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [projects, overdueTasks, upcomingTasks, openRisks] = await Promise.all([
    prisma.project.findMany({
      where: { status: { not: "archived" }, ...projectFilter },
      select: { name: true, status: true, progress: true, health: true },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        status: { not: "done" },
        dueDate: { lt: now },
        ...projectFilter,
      },
      select: { title: true, dueDate: true, project: { select: { name: true } } },
      take: 5,
    }),
    prisma.task.findMany({
      where: {
        status: { in: ["todo", "in_progress"] },
        dueDate: { gte: now, lte: weekFromNow },
        ...projectFilter,
      },
      select: { title: true, dueDate: true, priority: true },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    prisma.risk.findMany({
      where: { status: "open", ...projectFilter },
      select: { title: true, impact: true },
      orderBy: { severity: "desc" },
      take: 3,
    }),
  ]);

  const lines: string[] = [
    `☀️ **Брифинг — ${now.toLocaleDateString("ru-RU")}**\n`,
  ];

  lines.push(
    `📊 **Проекты:** ${projects.length} активных`,
  );
  for (const p of projects) {
    const icon = p.health === "at-risk" ? "🔴" : p.health === "warning" ? "🟡" : "🟢";
    lines.push(`  ${icon} ${p.name} — ${p.progress}%`);
  }

  if (overdueTasks.length > 0) {
    lines.push(`\n⚠️ **Просрочено (${overdueTasks.length}):**`);
    for (const t of overdueTasks) {
      lines.push(`  • ${t.title} [${t.project.name}]`);
    }
  }

  if (upcomingTasks.length > 0) {
    lines.push(`\n📅 **На этой неделе (${upcomingTasks.length}):**`);
    for (const t of upcomingTasks) {
      lines.push(`  • ${t.title} — ${t.dueDate.toLocaleDateString("ru-RU")}`);
    }
  }

  if (openRisks.length > 0) {
    lines.push(`\n🚨 **Открытые риски (${openRisks.length}):**`);
    for (const r of openRisks) {
      lines.push(`  • ${r.title} [${r.impact}]`);
    }
  }

  if (overdueTasks.length === 0 && openRisks.length === 0) {
    lines.push("\n✅ Всё идёт по плану!");
  }

  const brief = lines.join("\n");

  return {
    toolCallId,
    name: "generate_brief",
    success: true,
    result: {
      projects: projects.length,
      overdue: overdueTasks.length,
      upcoming: upcomingTasks.length,
      risks: openRisks.length,
      text: brief,
    },
    displayMessage: brief,
  };
}

async function executeCreateExpense(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
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

  const projectId = await resolveProjectId(args.projectId as string | undefined);
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
    args.categoryName as string | undefined,
  );

  const expense = await prisma.expense.create({
    data: {
      id: generateId(),
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
}

async function executeGetBudgetSummary(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
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
      }, {}),
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
}

async function executeListEquipment(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const limit = Math.min(Number(args.limit) || 10, 20);
  const availableOnly = Boolean(args.availableOnly);
  const status = availableOnly ? "available" : (args.status as string | undefined);

  const equipment = await prisma.equipment.findMany({
    where: {
      ...(args.projectId ? { projectId: String(args.projectId) } : {}),
      ...(status ? { status } : {}),
    },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      project: { select: { name: true } },
      hourlyRate: true,
      dailyRate: true,
      location: true,
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: limit,
  });

  const lines = equipment.map((item) => {
    const project = item.project?.name ? ` → ${item.project.name}` : "";
    return `• **${item.name}** (${item.type}) — ${item.status}${project}`;
  });

  return {
    toolCallId,
    name: "list_equipment",
    success: true,
    result: { equipment, count: equipment.length },
    displayMessage:
      equipment.length > 0
        ? `🏗️ **Техника (${equipment.length}):**\n${lines.join("\n")}`
        : "🏗️ Подходящая техника не найдена",
  };
}

async function executeCreateMaterialMovement(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const quantity = Number(args.quantity);
  const type = String(args.type ?? "");

  if (!["receipt", "consumption", "return", "writeoff"].includes(type)) {
    return {
      toolCallId,
      name: "create_material_movement",
      success: false,
      result: { error: "Invalid movement type" },
      displayMessage: "❌ Некорректный тип движения материала",
    };
  }

  if (!(quantity > 0)) {
    return {
      toolCallId,
      name: "create_material_movement",
      success: false,
      result: { error: "Quantity must be positive" },
      displayMessage: "❌ Количество должно быть больше нуля",
    };
  }

  const material = await resolveMaterialId(
    args.materialId as string | undefined,
    args.materialName as string | undefined,
  );
  if (!material) {
    return {
      toolCallId,
      name: "create_material_movement",
      success: false,
      result: { error: "Material not found" },
      displayMessage: "❌ Материал не найден",
    };
  }

  const projectId = await resolveProjectId(args.projectId as string | undefined);
  if (!projectId) {
    return {
      toolCallId,
      name: "create_material_movement",
      success: false,
      result: { error: "No project found" },
      displayMessage: "❌ Нет доступного проекта для движения материала",
    };
  }

  const stockDelta = type === "receipt" || type === "return" ? quantity : -quantity;

  const movement = await prisma.$transaction(async (tx) => {
    const created = await tx.materialMovement.create({
      data: {
        id: generateId(),
        materialId: material.id,
        projectId,
        type,
        quantity,
        unitPrice: args.unitPrice ? Number(args.unitPrice) : null,
        documentRef: args.documentRef ? String(args.documentRef) : null,
        date: args.date ? new Date(String(args.date)) : new Date(),
      },
    });

    const updatedMaterial = await tx.material.update({
      where: { id: material.id },
      data: {
        currentStock: Math.max(0, material.currentStock + stockDelta),
      },
      select: { id: true, name: true, currentStock: true, unit: true },
    });

    return { created, updatedMaterial };
  });

  return {
    toolCallId,
    name: "create_material_movement",
    success: true,
    result: {
      movementId: movement.created.id,
      materialId: movement.updatedMaterial.id,
      materialName: movement.updatedMaterial.name,
      currentStock: movement.updatedMaterial.currentStock,
      unit: movement.updatedMaterial.unit,
      type,
      quantity,
    },
    displayMessage: `📦 Движение материала записано: **${movement.updatedMaterial.name}** — ${type} ${quantity} ${movement.updatedMaterial.unit ?? ""}. Остаток: ${movement.updatedMaterial.currentStock}`,
  };
}

async function executeGetCriticalPath(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const projectId = await resolveProjectId(args.projectId as string | undefined);
  if (!projectId) {
    return {
      toolCallId,
      name: "get_critical_path",
      success: false,
      result: { error: "No project found" },
      displayMessage: "❌ Нет доступного проекта для расчёта критического пути",
    };
  }

  const context = await getProjectSchedulingContext(projectId);
  if (!context) {
    return {
      toolCallId,
      name: "get_critical_path",
      success: false,
      result: { error: `Project ${projectId} not found` },
      displayMessage: `❌ Проект ${projectId} не найден`,
    };
  }

  const criticalPath = calculateCriticalPath({
    tasks: context.tasks,
    dependencies: context.dependencies,
    projectStart: context.project.start,
  });

  const criticalTasks = criticalPath.tasks.filter((task) => task.isCritical);
  return {
    toolCallId,
    name: "get_critical_path",
    success: true,
    result: {
      projectId,
      projectFinish: criticalPath.projectFinish.toISOString(),
      criticalPath: criticalPath.criticalPath,
      criticalTasks,
    },
    displayMessage: `🧭 Критический путь рассчитан: ${criticalTasks.length} критических задач, финиш ${criticalPath.projectFinish.toLocaleDateString("ru-RU")}`,
  };
}

async function executeGetResourceLoad(
  toolCallId: string,
  args: Record<string, unknown>,
): Promise<AIToolResult> {
  const projectId = await resolveProjectId(args.projectId as string | undefined);
  if (!projectId) {
    return {
      toolCallId,
      name: "get_resource_load",
      success: false,
      result: { error: "No project found" },
      displayMessage: "❌ Нет доступного проекта для расчёта загрузки ресурсов",
    };
  }

  const context = await getProjectSchedulingContext(projectId);
  if (!context) {
    return {
      toolCallId,
      name: "get_resource_load",
      success: false,
      result: { error: `Project ${projectId} not found` },
      displayMessage: `❌ Проект ${projectId} не найден`,
    };
  }

  const resourceLoad = levelResources({
    tasks: context.tasks,
    dependencies: context.dependencies,
    assignments: context.assignments,
    capacities: context.capacities,
    projectStart: context.project.start,
    projectEnd: context.project.end,
  });

  return {
    toolCallId,
    name: "get_resource_load",
    success: true,
    result: {
      projectId,
      conflicts: resourceLoad.conflicts,
      adjustments: resourceLoad.adjustments,
      criticalPath: resourceLoad.criticalPath,
    },
    displayMessage:
      resourceLoad.conflicts.length > 0
        ? `👷 Найдено ${resourceLoad.conflicts.length} конфликтов загрузки и ${resourceLoad.adjustments.length} рекомендаций по выравниванию`
        : "👷 Перегрузок ресурсов не найдено",
  };
}

async function executeSyncOneC(toolCallId: string): Promise<AIToolResult> {
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
}
