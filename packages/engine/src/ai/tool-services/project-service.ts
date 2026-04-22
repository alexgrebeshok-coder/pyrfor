import { prisma } from "@/lib/prisma";
import type { AIToolResult } from "@/lib/ai/tools";
import { generateToolEntityId, resolveActiveProjectId } from "@/lib/ai/tool-services/shared";

export const projectToolService = {
  async createTask(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult> {
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

    const projectId = await resolveActiveProjectId(args.projectId as string | undefined);
    if (!projectId) {
      return {
        toolCallId,
        name: "create_task",
        success: false,
        result: { error: "No project found" },
        displayMessage: "❌ Нет доступных проектов для создания задачи",
      };
    }

    const id = generateToolEntityId();
    const dueDate = args.dueDate
      ? new Date(String(args.dueDate))
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

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
  },

  async createRisk(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult> {
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

    const projectId = await resolveActiveProjectId(args.projectId as string | undefined);
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
        id: generateToolEntityId(),
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
  },

  async updateTask(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult> {
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
  },

  async getProjectSummary(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult> {
    const projectId = args.projectId as string | undefined;

    const where = projectId ? { id: projectId } : { status: { not: "archived" } };

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

    const summaries = projects.map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
      progress: project.progress,
      health: project.health,
      tasks: project._count.tasks,
      risks: project._count.risks,
      budgetPlan: project.budgetPlan,
      budgetFact: project.budgetFact,
    }));

    const lines = summaries.map(
      (summary) =>
        `• **${summary.name}** — ${summary.progress}% | ${summary.health} | ${summary.tasks} задач, ${summary.risks} рисков`
    );

    return {
      toolCallId,
      name: "get_project_summary",
      success: true,
      result: { projects: summaries },
      displayMessage: `📊 **Проекты (${summaries.length}):**\n${lines.join("\n")}`,
    };
  },

  async listTasks(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult> {
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

    const lines = tasks.map((task) => {
      const overdue = task.dueDate < new Date() && task.status !== "done" ? " ⏰" : "";
      const emoji =
        task.priority === "critical"
          ? "🔴"
          : task.priority === "high"
            ? "🟠"
            : task.priority === "medium"
              ? "🟡"
              : "⚪";
      return `${emoji} **${task.title}**${overdue} — ${task.status} [${task.project.name}]`;
    });

    return {
      toolCallId,
      name: "list_tasks",
      success: true,
      result: {
        tasks: tasks.map((task) => ({ ...task, projectName: task.project.name })),
        count: tasks.length,
      },
      displayMessage:
        tasks.length > 0
          ? `📋 **Задачи (${tasks.length}):**\n${lines.join("\n")}`
          : "📋 Задачи не найдены по заданным фильтрам",
    };
  },

  async generateBrief(toolCallId: string, args: Record<string, unknown>): Promise<AIToolResult> {
    const projectFilter = args.projectId ? { projectId: String(args.projectId) } : {};

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

    const lines: string[] = [`☀️ **Брифинг — ${now.toLocaleDateString("ru-RU")}**\n`];

    lines.push(`📊 **Проекты:** ${projects.length} активных`);
    for (const project of projects) {
      const icon =
        project.health === "at-risk" ? "🔴" : project.health === "warning" ? "🟡" : "🟢";
      lines.push(`  ${icon} ${project.name} — ${project.progress}%`);
    }

    if (overdueTasks.length > 0) {
      lines.push(`\n⚠️ **Просрочено (${overdueTasks.length}):**`);
      for (const task of overdueTasks) {
        lines.push(`  • ${task.title} [${task.project.name}]`);
      }
    }

    if (upcomingTasks.length > 0) {
      lines.push(`\n📅 **На этой неделе (${upcomingTasks.length}):**`);
      for (const task of upcomingTasks) {
        lines.push(`  • ${task.title} — ${task.dueDate.toLocaleDateString("ru-RU")}`);
      }
    }

    if (openRisks.length > 0) {
      lines.push(`\n🚨 **Открытые риски (${openRisks.length}):**`);
      for (const risk of openRisks) {
        lines.push(`  • ${risk.title} [${risk.impact}]`);
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
  },
};
