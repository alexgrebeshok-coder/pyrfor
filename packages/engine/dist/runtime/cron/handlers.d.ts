/**
 * Engine Runtime — Cron Job Handlers
 *
 * Ported from daemon/cron/handlers.ts.
 * Excludes agent-heartbeat (TASK-05).
 */
import type { CronHandlerFn } from '../cron';
type PrismaLike = any;
export declare function setCronPrismaClient(client: PrismaLike): void;
export declare function getCronPrismaClient(): PrismaLike | null;
export declare const morningBriefHandler: CronHandlerFn;
export declare const emailDigestHandler: CronHandlerFn;
export declare const memoryCleanupHandler: CronHandlerFn;
export declare const healthReportHandler: CronHandlerFn;
export declare const budgetResetHandler: CronHandlerFn;
type HeartbeatRunnerFn = (deps: {
    prisma: unknown;
    logger: unknown;
}, config: {
    batchSize?: number;
    gatewayPort?: number;
}) => Promise<any>;
/** Override the heartbeat scheduler function — intended for test injection. */
export declare function setHeartbeatRunner(fn: HeartbeatRunnerFn | null): void;
/**
 * Processes queued agent wakeup requests and triggers scheduled agents.
 *
 * gatewayPort resolution order:
 *   1. ctx.job.payload.gatewayPort  (per-job override)
 *   2. process.env.PYRFOR_GATEWAY_PORT  (deployment-level env var)
 *   3. 3000  (fallback)
 *
 * The heartbeat-scheduler module is loaded via dynamic require() so that
 * engine package tests can inject it without pulling in the whole daemon tree.
 */
export declare const agentHeartbeatHandler: CronHandlerFn;
export declare function getDefaultHandlers(): Record<string, CronHandlerFn>;
export {};
//# sourceMappingURL=handlers.d.ts.map