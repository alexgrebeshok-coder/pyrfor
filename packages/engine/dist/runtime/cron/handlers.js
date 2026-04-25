/**
 * Engine Runtime — Cron Job Handlers
 *
 * Ported from daemon/cron/handlers.ts.
 * Excludes agent-heartbeat (TASK-05).
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../../observability/logger.js';
let _prisma = null;
function getPrisma() {
    if (!_prisma) {
        throw new Error('[cron-handlers] Prisma client not initialised — call setCronPrismaClient() first');
    }
    return _prisma;
}
export function setCronPrismaClient(client) {
    _prisma = client;
}
export function getCronPrismaClient() {
    return _prisma;
}
// ─── Handler: Morning Briefing ────────────────────────────────────────────────
export const morningBriefHandler = (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    const prisma = getPrisma();
    const config = ((_a = ctx.job.payload) !== null && _a !== void 0 ? _a : {});
    const chatIds = (_b = config.chatIds) !== null && _b !== void 0 ? _b : [];
    if (chatIds.length === 0) {
        logger.warn('[cron-handlers] Morning brief: no chatIds configured');
        return;
    }
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [activeProjects, overdueTasks, upcomingTasks] = yield Promise.all([
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
});
// ─── Handler: Email Digest ────────────────────────────────────────────────────
export const emailDigestHandler = () => __awaiter(void 0, void 0, void 0, function* () {
    const prisma = getPrisma();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [completedTasks, newTasks, newRisks] = yield Promise.all([
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
});
// ─── Handler: Memory Cleanup ──────────────────────────────────────────────────
export const memoryCleanupHandler = () => __awaiter(void 0, void 0, void 0, function* () {
    const prisma = getPrisma();
    const expired = yield prisma.memory.deleteMany({
        where: { validUntil: { lt: new Date() } },
    });
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const lowConf = yield prisma.memory.deleteMany({
        where: { confidence: { lt: 30 }, updatedAt: { lt: thirtyDaysAgo } },
    });
    logger.info('[cron-handlers] Memory cleanup', {
        expired: expired.count,
        lowConfidence: lowConf.count,
    });
});
// ─── Handler: Health Report ───────────────────────────────────────────────────
export const healthReportHandler = () => __awaiter(void 0, void 0, void 0, function* () {
    const prisma = getPrisma();
    const start = Date.now();
    yield prisma.$queryRaw `SELECT 1`;
    const dbLatency = Date.now() - start;
    const [projectCount, taskCount, memoryCount] = yield Promise.all([
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
});
// ─── Handler: Monthly Budget Reset ───────────────────────────────────────────
export const budgetResetHandler = () => __awaiter(void 0, void 0, void 0, function* () {
    const prisma = getPrisma();
    const result = yield prisma.agent.updateMany({
        where: { spentMonthlyCents: { gt: 0 } },
        data: { spentMonthlyCents: 0 },
    });
    logger.info(`[cron-handlers] Budget reset: cleared spending for ${result.count} agents`);
});
let _heartbeatRunner = null;
/** Override the heartbeat scheduler function — intended for test injection. */
export function setHeartbeatRunner(fn) {
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
export const agentHeartbeatHandler = (ctx) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const payload = ((_a = ctx.job.payload) !== null && _a !== void 0 ? _a : {});
    const gatewayPort = (_b = payload.gatewayPort) !== null && _b !== void 0 ? _b : (process.env.PYRFOR_GATEWAY_PORT ? Number(process.env.PYRFOR_GATEWAY_PORT) : 3000);
    const batchSize = (_c = payload.batchSize) !== null && _c !== void 0 ? _c : 5;
    let runHeartbeatScheduler = _heartbeatRunner;
    if (!runHeartbeatScheduler) {
        try {
            // Dynamic require keeps lib/ optional at engine-package test time.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = require('../../../../../lib/orchestration/heartbeat-scheduler');
            runHeartbeatScheduler = mod.runHeartbeatScheduler;
        }
        catch (_d) {
            logger.warn('[cron-handlers] agent-heartbeat: heartbeat-scheduler module not available — skipping');
            return;
        }
    }
    yield runHeartbeatScheduler({ prisma: getPrisma(), logger }, { batchSize, gatewayPort });
});
// ─── Registry ─────────────────────────────────────────────────────────────────
export function getDefaultHandlers() {
    return {
        'morning-brief': morningBriefHandler,
        'email-digest': emailDigestHandler,
        'memory-cleanup': memoryCleanupHandler,
        'health-report': healthReportHandler,
        'budget-reset': budgetResetHandler,
        'agent-heartbeat': agentHeartbeatHandler,
    };
}
