/**
 * AI Tool Executor — executes function calls against the database
 *
 * Each tool maps to real Prisma CRUD operations.
 * Returns structured results with user-facing display messages.
 */

import { PrismaClient } from "@prisma/client";
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
