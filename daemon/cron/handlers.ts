/**
 * CEOClaw Daemon — Cron Job Handlers
 *
 * Concrete implementations for scheduled jobs.
 * Each handler connects to Prisma for data and can trigger
 * Telegram messages, AI analysis, and report generation.
 */

import { PrismaClient } from "@prisma/client";
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
  const prisma = getPrisma();
  const batchSize = (config.batchSize as number) ?? 5;

  // 1. Process queued wakeup requests
  const queued = await prisma.agentWakeupRequest.findMany({
    where: { status: "queued" },
    include: { agent: { select: { workspaceId: true, status: true } } },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  let processed = 0;
  for (const req of queued) {
    if (req.agent.status === "paused" || req.agent.status === "terminated") {
      await prisma.agentWakeupRequest.update({
        where: { id: req.id },
        data: { status: "skipped", processedAt: new Date() },
      });
      continue;
    }

    // Mark processing
    await prisma.agentWakeupRequest.update({
      where: { id: req.id },
      data: { status: "processing" },
    });

    let triggerData: Record<string, unknown> = {};
    try {
      triggerData = JSON.parse(req.triggerData || "{}");
    } catch { /* empty */ }

    try {
      // Create a HeartbeatRun directly (we're in daemon context, no import of Next.js modules)
      const run = await prisma.heartbeatRun.create({
        data: {
          workspaceId: req.agent.workspaceId,
          agentId: req.agentId,
          wakeupRequestId: req.id,
          status: "queued",
          invocationSource: req.reason,
          contextSnapshot: req.triggerData,
        },
      });

      // Mark agent as running
      await prisma.agent.update({
        where: { id: req.agentId },
        data: { status: "running" },
      });

      // Trigger execution via gateway HTTP call to the Next.js app
      const gatewayPort = (config.gatewayPort as number) ?? 3000;
      const response = await fetch(
        `http://localhost:${gatewayPort}/api/orchestration/heartbeat/execute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: run.id,
            agentId: req.agentId,
            workspaceId: req.agent.workspaceId,
            wakeupRequestId: req.id,
            task: (triggerData.task as string) ?? undefined,
          }),
          signal: AbortSignal.timeout(120_000),
        }
      ).catch((e: Error) => {
        log.warn(`Agent heartbeat HTTP failed for ${req.agentId}: ${e.message}`);
        return null;
      });

      if (response && response.ok) {
        processed++;
      } else {
        // Mark run failed if HTTP call failed
        await prisma.heartbeatRun.update({
          where: { id: run.id },
          data: {
            status: "failed",
            finishedAt: new Date(),
            resultJson: JSON.stringify({ error: "Daemon HTTP trigger failed" }),
          },
        });
        await prisma.agent.update({
          where: { id: req.agentId },
          data: { status: "error" },
        });
        await prisma.agentWakeupRequest.update({
          where: { id: req.id },
          data: { status: "failed", processedAt: new Date() },
        });
      }
    } catch (err) {
      log.error(`Agent heartbeat failed for ${req.agentId}`, { error: String(err) });
      await prisma.agentWakeupRequest.update({
        where: { id: req.id },
        data: { status: "failed", processedAt: new Date() },
      }).catch(() => {});
    }
  }

  // 2. Check cron-scheduled agents
  const scheduledAgents = await prisma.agent.findMany({
    where: {
      status: { in: ["idle"] },
      runtimeConfig: { not: "{}" },
    },
    select: { id: true, workspaceId: true, runtimeConfig: true, slug: true },
  });

  for (const agent of scheduledAgents) {
    try {
      const cfg = JSON.parse(agent.runtimeConfig || "{}");
      if (!cfg.schedule) continue;

      // Check if schedule matches current minute (simple cron check)
      if (!cronMatchesNow(cfg.schedule)) continue;

      // Avoid duplicate wakeups: check if there's a recent queued/processing request
      const recent = await prisma.agentWakeupRequest.findFirst({
        where: {
          agentId: agent.id,
          status: { in: ["queued", "processing"] },
          createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
        },
      });
      if (recent) continue;

      // Create wakeup request for next cycle
      await prisma.agentWakeupRequest.create({
        data: {
          agentId: agent.id,
          reason: "cron",
          triggerData: JSON.stringify({ schedule: cfg.schedule }),
          status: "queued",
        },
      });

      log.info(`Scheduled wakeup for ${agent.slug} (${cfg.schedule})`);
    } catch (err) {
      log.warn(`Failed to check schedule for agent ${agent.id}`, { error: String(err) });
    }
  }

  if (processed > 0 || queued.length > 0) {
    log.info(`Agent heartbeat: processed ${processed}/${queued.length} wakeups, checked ${scheduledAgents.length} schedules`);
  }
};

/**
 * Simple cron matcher — checks if a cron expression matches the current minute.
 * Supports: "MIN HOUR DOM MON DOW" (standard 5-field).
 * Handles: numbers, wildcards (*), lists (1,3,5), ranges (1-5), steps (/5).
 */
function cronMatchesNow(expression: string): boolean {
  const now = new Date();
  const parts = expression.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const fields = [
    now.getMinutes(),     // 0
    now.getHours(),       // 1
    now.getDate(),        // 2
    now.getMonth() + 1,   // 3
    now.getDay(),         // 4 (0=Sun)
  ];

  const ranges: [number, number][] = [
    [0, 59], [0, 23], [1, 31], [1, 12], [0, 7],
  ];

  for (let i = 0; i < 5; i++) {
    if (!fieldMatches(parts[i], fields[i], ranges[i])) return false;
  }
  return true;
}

function fieldMatches(
  pattern: string,
  value: number,
  [min, max]: [number, number]
): boolean {
  if (pattern === "*") return true;

  // Handle lists: "1,3,5"
  for (const part of pattern.split(",")) {
    // Handle step: "*/5" or "1-10/2"
    const [rangeStr, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr, 10) : 1;

    if (rangeStr === "*") {
      if ((value - min) % step === 0) return true;
      continue;
    }

    // Handle range: "1-5"
    if (rangeStr.includes("-")) {
      const [lo, hi] = rangeStr.split("-").map(Number);
      if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
      continue;
    }

    // Plain number
    if (parseInt(rangeStr, 10) === value) return true;
  }

  return false;
}

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
