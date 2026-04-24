/**
 * Engine Runtime — Cron Job Handlers
 *
 * Ported from daemon/cron/handlers.ts.
 * Excludes agent-heartbeat (TASK-05).
 */

import { logger } from '../../observability/logger';
import type { CronHandlerFn, CronExecutionContext } from '../cron';

// ─── Prisma client ────────────────────────────────────────────────────────────

// Typed as `any` — engine package has no @prisma/client dependency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaLike = any;

let _prisma: PrismaLike | null = null;

function getPrisma(): PrismaLike {
  if (!_prisma) {
    throw new Error(
      '[cron-handlers] Prisma client not initialised — call setCronPrismaClient() first',
    );
  }
  return _prisma;
}

export function setCronPrismaClient(client: PrismaLike): void {
  _prisma = client;
}

export function getCronPrismaClient(): PrismaLike | null {
  return _prisma;
}

// ─── Handler: Morning Briefing ────────────────────────────────────────────────

export const morningBriefHandler: CronHandlerFn = async (
  ctx: CronExecutionContext,
): Promise<void> => {
  const prisma = getPrisma();
  const config = (ctx.job.payload ?? {}) as Record<string, unknown>;
  const chatIds = (config.chatIds as number[]) ?? [];

  if (chatIds.length === 0) {
    logger.warn('[cron-handlers] Morning brief: no chatIds configured');
    return;
  }

  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [activeProjects, overdueTasks, upcomingTasks] = await Promise.all([
    prisma.project.findMany({
      where: { status: { in: ['active', 'at-risk'] } },
      select: { name: true, status: true, progress: true },
      take: 10,
    }),
    prisma.task.count({
      where: {
        status: { in: ['todo', 'in_progress', 'in-progress'] },
        dueDate: { lt: now },
      },
    }),
    prisma.task.count({
      where: {
        status: { in: ['todo', 'in_progress', 'in-progress'] },
        dueDate: { gte: now, lte: weekFromNow },
      },
    }),
  ]);

  logger.info('[cron-handlers] Morning brief generated', {
    projects: activeProjects.length,
    overdue: overdueTasks,
    upcoming: upcomingTasks,
  });
};

// ─── Handler: Email Digest ────────────────────────────────────────────────────

export const emailDigestHandler: CronHandlerFn = async (): Promise<void> => {
  const prisma = getPrisma();

  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [completedTasks, newTasks, newRisks] = await Promise.all([
    prisma.task.count({
      where: { status: 'done', updatedAt: { gte: oneWeekAgo } },
    }),
    prisma.task.count({
      where: { createdAt: { gte: oneWeekAgo } },
    }),
    prisma.risk.count({
      where: { createdAt: { gte: oneWeekAgo } },
    }),
  ]);

  logger.info('[cron-handlers] Email digest generated', {
    completed: completedTasks,
    newTasks,
    newRisks,
  });
};

// ─── Handler: Memory Cleanup ──────────────────────────────────────────────────

export const memoryCleanupHandler: CronHandlerFn = async (): Promise<void> => {
  const prisma = getPrisma();

  const expired = await prisma.memory.deleteMany({
    where: { validUntil: { lt: new Date() } },
  });

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const lowConf = await prisma.memory.deleteMany({
    where: { confidence: { lt: 30 }, updatedAt: { lt: thirtyDaysAgo } },
  });

  logger.info('[cron-handlers] Memory cleanup', {
    expired: expired.count,
    lowConfidence: lowConf.count,
  });
};

// ─── Handler: Health Report ───────────────────────────────────────────────────

export const healthReportHandler: CronHandlerFn = async (): Promise<void> => {
  const prisma = getPrisma();

  const start = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbLatency = Date.now() - start;

  const [projectCount, taskCount, memoryCount] = await Promise.all([
    prisma.project.count(),
    prisma.task.count(),
    prisma.memory.count(),
  ]);

  logger.info('[cron-handlers] Health report', {
    dbLatencyMs: dbLatency,
    projects: projectCount,
    tasks: taskCount,
    memories: memoryCount,
  });
};

// ─── Handler: Monthly Budget Reset ───────────────────────────────────────────

export const budgetResetHandler: CronHandlerFn = async (): Promise<void> => {
  const prisma = getPrisma();
  const result = await prisma.agent.updateMany({
    where: { spentMonthlyCents: { gt: 0 } },
    data: { spentMonthlyCents: 0 },
  });
  logger.info(`[cron-handlers] Budget reset: cleared spending for ${result.count} agents`);
};

// ─── Handler: Agent Heartbeat ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HeartbeatRunnerFn = (deps: { prisma: unknown; logger: unknown }, config: { batchSize?: number; gatewayPort?: number }) => Promise<any>;

let _heartbeatRunner: HeartbeatRunnerFn | null = null;

/** Override the heartbeat scheduler function — intended for test injection. */
export function setHeartbeatRunner(fn: HeartbeatRunnerFn | null): void {
  _heartbeatRunner = fn;
}

/**
 * Processes queued agent wakeup requests and triggers scheduled agents.
 *
 * gatewayPort resolution order:
 *   1. ctx.job.payload.gatewayPort  (per-job override)
 *   2. process.env.PYRFOR_GATEWAY_PORT  (deployment-level env var)
 *   3. 3000  (fallback)
 *
 * The heartbeat-scheduler module is loaded via dynamic require() so that
 * engine package tests do not require lib/ to be installed/compiled.
 */
export const agentHeartbeatHandler: CronHandlerFn = async (
  ctx: CronExecutionContext,
): Promise<void> => {
  const payload = (ctx.job.payload ?? {}) as Record<string, unknown>;
  const gatewayPort =
    (payload.gatewayPort as number | undefined) ??
    (process.env.PYRFOR_GATEWAY_PORT ? Number(process.env.PYRFOR_GATEWAY_PORT) : 3000);
  const batchSize = (payload.batchSize as number | undefined) ?? 5;

  let runHeartbeatScheduler = _heartbeatRunner;

  if (!runHeartbeatScheduler) {
    try {
      // Dynamic require keeps lib/ optional at engine-package test time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../../../../../lib/orchestration/heartbeat-scheduler') as {
        runHeartbeatScheduler: HeartbeatRunnerFn;
      };
      runHeartbeatScheduler = mod.runHeartbeatScheduler;
    } catch {
      logger.warn(
        '[cron-handlers] agent-heartbeat: heartbeat-scheduler module not available — skipping',
      );
      return;
    }
  }

  await runHeartbeatScheduler(
    { prisma: getPrisma(), logger },
    { batchSize, gatewayPort },
  );
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export function getDefaultHandlers(): Record<string, CronHandlerFn> {
  return {
    'morning-brief': morningBriefHandler,
    'email-digest': emailDigestHandler,
    'memory-cleanup': memoryCleanupHandler,
    'health-report': healthReportHandler,
    'budget-reset': budgetResetHandler,
    'agent-heartbeat': agentHeartbeatHandler,
  };
}
