/**
 * Pyrfor Daemon — Cron Job Handlers
 *
 * Concrete implementations for scheduled jobs.
 * Each handler connects to Prisma for data and can trigger
 * Telegram messages, AI analysis, and report generation.
 */

import { PrismaClient } from "@prisma/client";
import { runHeartbeatScheduler } from "../../packages/engine/src/orchestration/heartbeat-scheduler";
import { createLogger } from "../logger";
import type { CronHandler } from "./service";

const log = createLogger("cron-jobs");

let _prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient();
  }
  return _prisma;
}

export function setCronPrismaClient(client: PrismaClient): void {
  _prisma = client;
}

// ─── Handler: Morning Briefing ─────────────────────────────────────────────

export const morningBriefHandler: CronHandler = async (_jobId, config) => {
  const prisma = getPrisma();
  const chatIds = (config.chatIds as number[]) ?? [];

  if (chatIds.length === 0) {
    log.warn("Morning brief: no chatIds configured");
    return;
  }

  // Gather briefing data
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [activeProjects, overdueTasks, upcomingTasks] = await Promise.all([
    prisma.project.findMany({
      where: { status: { in: ["active", "at-risk"] } },
      select: { name: true, status: true, progress: true },
      take: 10,
    }),
    prisma.task.count({
      where: {
        status: { in: ["todo", "in_progress", "in-progress"] },
        dueDate: { lt: now },
      },
    }),
    prisma.task.count({
      where: {
        status: { in: ["todo", "in_progress", "in-progress"] },
        dueDate: { gte: now, lte: weekFromNow },
      },
    }),
  ]);

  log.info("Morning brief generated", {
    projects: activeProjects.length,
    overdue: overdueTasks,
    upcoming: upcomingTasks,
  });

  // The actual sending is done by the Telegram bot via a callback
  // This handler stores the data; the gateway server routes it to Telegram
};

// ─── Handler: Email Digest ─────────────────────────────────────────────────

export const emailDigestHandler: CronHandler = async (_jobId, _config) => {
  const prisma = getPrisma();

  // Gather weekly digest data
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [completedTasks, newTasks, newRisks] = await Promise.all([
    prisma.task.count({
      where: {
        status: "done",
        updatedAt: { gte: oneWeekAgo },
      },
    }),
    prisma.task.count({
      where: {
        createdAt: { gte: oneWeekAgo },
      },
    }),
    prisma.risk.count({
      where: {
        createdAt: { gte: oneWeekAgo },
      },
    }),
  ]);

  log.info("Email digest generated", {
    completed: completedTasks,
    newTasks,
    newRisks,
  });
};

// ─── Handler: Memory Cleanup ───────────────────────────────────────────────

export const memoryCleanupHandler: CronHandler = async () => {
  const prisma = getPrisma();

  // Delete expired memories
  const result = await prisma.memory.deleteMany({
    where: {
      validUntil: { lt: new Date() },
    },
  });

  // Delete low-confidence memories older than 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const lowConfResult = await prisma.memory.deleteMany({
    where: {
      confidence: { lt: 30 },
      updatedAt: { lt: thirtyDaysAgo },
    },
  });

  log.info("Memory cleanup", {
    expired: result.count,
    lowConfidence: lowConfResult.count,
  });
};

// ─── Handler: Health Report ────────────────────────────────────────────────

export const healthReportHandler: CronHandler = async (_jobId, _config) => {
  const prisma = getPrisma();

  // Check database connectivity
  const start = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbLatency = Date.now() - start;

  const [projectCount, taskCount, memoryCount] = await Promise.all([
    prisma.project.count(),
    prisma.task.count(),
    prisma.memory.count(),
  ]);

  log.info("Health report", {
    dbLatencyMs: dbLatency,
    projects: projectCount,
    tasks: taskCount,
    memories: memoryCount,
  });
};

// ─── Handler: Agent Heartbeat Scheduler ────────────────────────────────────

/**
 * Processes queued agent wakeup requests and triggers scheduled agents.
 * Runs frequently (every 1–5 min). Two duties:
 * 1. Drain the AgentWakeupRequest queue (on-demand wakeups)
 * 2. Wake agents whose cron schedule matches current time
 */
export const agentHeartbeatHandler: CronHandler = async (_jobId, config) => {
  await runHeartbeatScheduler(
    {
      prisma: getPrisma(),
      logger: log,
    },
    {
      batchSize: (config.batchSize as number) ?? 5,
      gatewayPort: (config.gatewayPort as number) ?? 3000,
    }
  );
};

// ─── Handler: Monthly Budget Reset ─────────────────────────────────────────

export const budgetResetHandler: CronHandler = async (_jobId, _config) => {
  const prisma = getPrisma();
  const result = await prisma.agent.updateMany({
    where: { spentMonthlyCents: { gt: 0 } },
    data: { spentMonthlyCents: 0 },
  });
  log.info(`Budget reset: cleared spending for ${result.count} agents`);
};

// ─── Register All Handlers ─────────────────────────────────────────────────

export function getDefaultHandlers(): Record<string, CronHandler> {
  return {
    "morning-brief": morningBriefHandler,
    "email-digest": emailDigestHandler,
    "memory-cleanup": memoryCleanupHandler,
    "health-report": healthReportHandler,
    "agent-heartbeat": agentHeartbeatHandler,
    "budget-reset": budgetResetHandler,
  };
}
