/**
 * Pyrfor Daemon — Telegram Handlers
 *
 * Business logic for Telegram bot commands.
 * Connects to Prisma for real data operations.
 * Separated from bot.ts for testability.
 */

import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { createLogger } from "../logger";
import type { TelegramBotOptions } from "./bot";

const log = createLogger("tg-handlers");

// ─── Prisma Client (shared with daemon) ────────────────────────────────────

let _prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

export function setPrismaClient(client: PrismaClient): void {
  _prisma = client;
}

// ─── Handler Implementations ───────────────────────────────────────────────

export async function handleGetStatus(_chatId: number): Promise<string> {
  const prisma = getPrisma();

  const projects = await prisma.project.findMany({
    select: {
      name: true,
      status: true,
      progress: true,
      health: true,
    },
    take: 10,
  });

  if (projects.length === 0) {
    return "📊 Нет проектов в системе. Создайте первый проект в дашборде.";
  }

  const lines = ["📊 *Статус проектов:*\n"];

  for (const project of projects) {
    const emoji =
      project.status === "active" ? "🟢" :
      project.status === "completed" ? "✅" :
      project.status === "at-risk" ? "🔴" :
      project.status === "on-hold" ? "⏸️" : "🟡";

    const healthBar = project.health !== null
      ? ` | Health: ${project.health}%`
      : "";

    const progressBar = project.progress !== null
      ? ` (${project.progress}%)`
      : "";

    lines.push(`${emoji} *${escapeMarkdown(project.name)}*${progressBar}${healthBar}`);
  }

  const totalActive = projects.filter((p) => p.status === "active").length;
  const totalAtRisk = projects.filter((p) => p.status === "at-risk").length;

  lines.push("");
  lines.push(`📈 Активных: ${totalActive} | ⚠️ В риске: ${totalAtRisk}`);

  return lines.join("\n");
}

export async function handleGetProjects(_chatId: number): Promise<string> {
  const prisma = getPrisma();

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      progress: true,
      health: true,
      description: true,
      priority: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  if (projects.length === 0) {
    return "📂 Проектов пока нет.";
  }

  const lines = ["📂 *Проекты:*\n"];

  for (const project of projects) {
    const priorityEmoji =
      project.priority === "critical" ? "🔴" :
      project.priority === "high" ? "🟠" :
      project.priority === "medium" ? "🟡" : "🟢";

    lines.push(`${priorityEmoji} *${escapeMarkdown(project.name)}*`);

    if (project.description) {
      const desc = project.description.length > 80
        ? project.description.slice(0, 80) + "..."
        : project.description;
      lines.push(`  _${escapeMarkdown(desc)}_`);
    }

    lines.push(`  Прогресс: ${project.progress ?? 0}% | Статус: ${project.status}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function handleGetTasks(_chatId: number): Promise<string> {
  const prisma = getPrisma();

  const tasks = await prisma.task.findMany({
    where: {
      status: { in: ["todo", "in_progress", "in-progress", "blocked"] },
    },
    select: {
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      assignee: true,
      project: { select: { name: true } },
    },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }],
    take: 15,
  });

  if (tasks.length === 0) {
    return "✅ Все задачи выполнены! Нет открытых задач.";
  }

  const lines = ["📋 *Текущие задачи:*\n"];

  for (const task of tasks) {
    const statusEmoji =
      task.status === "blocked" ? "🚫" :
      task.status === "in_progress" || task.status === "in-progress" ? "🔄" : "📌";

    const priorityEmoji =
      task.priority === "critical" ? "🔴" :
      task.priority === "high" ? "🟠" :
      task.priority === "medium" ? "🟡" : "🟢";

    const dueStr = task.dueDate
      ? ` | 📅 ${formatDate(task.dueDate)}`
      : "";

    const projectStr = task.project?.name
      ? ` [${escapeMarkdown(task.project.name)}]`
      : "";

    lines.push(`${statusEmoji}${priorityEmoji} *${escapeMarkdown(task.title)}*${projectStr}${dueStr}`);
  }

  const blockedCount = tasks.filter((t) => t.status === "blocked").length;
  if (blockedCount > 0) {
    lines.push(`\n⚠️ Заблокировано: ${blockedCount}`);
  }

  return lines.join("\n");
}

export async function handleAddTask(
  _chatId: number,
  projectQuery: string,
  taskTitle: string
): Promise<string> {
  const prisma = getPrisma();

  // Find project by partial name match
  const project = await prisma.project.findFirst({
    where: {
      name: { contains: projectQuery },
    },
    select: { id: true, name: true },
  });

  if (!project) {
    // Try to list available projects for the user
    const projects = await prisma.project.findMany({
      select: { name: true },
      take: 5,
    });

    const suggestions = projects.map((p) => `• ${p.name}`).join("\n");
    return `❌ Проект "${projectQuery}" не найден.\n\nДоступные проекты:\n${suggestions}`;
  }

  await prisma.task.create({
    data: {
      id: randomUUID(),
      title: taskTitle,
      projectId: project.id,
      status: "todo",
      priority: "medium",
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    },
  });

  return `✅ Задача создана!\n\n*${escapeMarkdown(taskTitle)}*\nПроект: ${escapeMarkdown(project.name)}\nСрок: ${formatDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))}`;
}

export async function handleMorningBrief(_chatId: number): Promise<string> {
  const prisma = getPrisma();

  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Gather data for briefing
  const [projects, overdueTasks, upcomingTasks, blockedTasks] = await Promise.all([
    prisma.project.findMany({
      where: { status: { in: ["active", "at-risk"] } },
      select: { name: true, status: true, progress: true, health: true },
    }),
    prisma.task.findMany({
      where: {
        status: { in: ["todo", "in_progress", "in-progress"] },
        dueDate: { lt: now },
      },
      select: { title: true, dueDate: true, project: { select: { name: true } } },
      take: 5,
    }),
    prisma.task.findMany({
      where: {
        status: { in: ["todo", "in_progress", "in-progress"] },
        dueDate: { gte: now, lte: weekFromNow },
      },
      select: { title: true, dueDate: true, priority: true },
      orderBy: { dueDate: "asc" },
      take: 5,
    }),
    prisma.task.findMany({
      where: { status: "blocked" },
      select: { title: true, description: true },
      take: 3,
    }),
  ]);

  const lines = [`☀️ *Утренний брифинг — ${formatDate(now)}*\n`];

  // Projects overview
  const atRisk = projects.filter((p) => p.status === "at-risk");
  lines.push(`📊 *Проекты:* ${projects.length} активных${atRisk.length > 0 ? `, ${atRisk.length} в риске` : ""}`);

  if (atRisk.length > 0) {
    for (const p of atRisk) {
      lines.push(`  🔴 ${escapeMarkdown(p.name)} — ${p.progress ?? 0}%`);
    }
  }

  // Overdue
  if (overdueTasks.length > 0) {
    lines.push(`\n⚠️ *Просрочено (${overdueTasks.length}):*`);
    for (const t of overdueTasks) {
      lines.push(`  • ${escapeMarkdown(t.title)}${t.project ? ` [${escapeMarkdown(t.project.name)}]` : ""}`);
    }
  }

  // Upcoming
  if (upcomingTasks.length > 0) {
    lines.push(`\n📅 *На этой неделе:*`);
    for (const t of upcomingTasks) {
      const emoji =
        t.priority === "critical" ? "🔴" :
        t.priority === "high" ? "🟠" : "📌";
      lines.push(`  ${emoji} ${escapeMarkdown(t.title)} — ${t.dueDate ? formatDate(t.dueDate) : "без срока"}`);
    }
  }

  // Blocked
  if (blockedTasks.length > 0) {
    lines.push(`\n🚫 *Заблокировано (${blockedTasks.length}):*`);
    for (const t of blockedTasks) {
      lines.push(`  • ${escapeMarkdown(t.title)}: ${escapeMarkdown(t.description ?? "причина не указана")}`);
    }
  }

  if (overdueTasks.length === 0 && blockedTasks.length === 0) {
    lines.push("\n✅ Всё идёт по плану!");
  }

  return lines.join("\n");
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

// ─── Create Handler Set ────────────────────────────────────────────────────

export function createHandlers(): Pick<
  TelegramBotOptions,
  | "onGetStatus"
  | "onGetProjects"
  | "onGetTasks"
  | "onAddTask"
  | "onMorningBrief"
> {
  return {
    onGetStatus: handleGetStatus,
    onGetProjects: handleGetProjects,
    onGetTasks: handleGetTasks,
    onAddTask: handleAddTask,
    onMorningBrief: handleMorningBrief,
  };
}
