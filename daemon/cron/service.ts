/**
 * Pyrfor Daemon — Cron Service
 *
 * Scheduled job execution using croner.
 * Improved over OpenClaw: Prisma-backed job storage,
 * typed handlers, execution history tracking.
 */

import { Cron, type CronOptions } from "croner";
import { createLogger } from "../logger";
import type { CronJobConfig } from "../config";

const log = createLogger("cron");

// ─── Types ─────────────────────────────────────────────────────────────────

export type CronHandler = (jobId: string, config: Record<string, unknown>) => Promise<void>;

interface RunningJob {
  id: string;
  name: string;
  schedule: string;
  cron: Cron;
  handler: CronHandler;
  config: Record<string, unknown>;
  lastRun?: Date;
  lastError?: string;
  runCount: number;
}

export interface JobStatus {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  nextRun: Date | null;
  lastRun: Date | null;
  lastError: string | null;
  runCount: number;
}

// ─── Cron Service ──────────────────────────────────────────────────────────

export class CronService {
  private jobs = new Map<string, RunningJob>();
  private handlers = new Map<string, CronHandler>();
  private running = false;

  /**
   * Register a handler for a job type.
   * Call this before start() to register all handlers.
   */
  registerHandler(handlerName: string, handler: CronHandler): void {
    this.handlers.set(handlerName, handler);
    log.debug("Registered cron handler", { handler: handlerName });
  }

  /**
   * Start the cron service with configured jobs.
   */
  start(jobs: CronJobConfig[]): void {
    if (this.running) return;
    this.running = true;

    for (const jobConfig of jobs) {
      if (!jobConfig.enabled) {
        log.debug("Skipping disabled job", { id: jobConfig.id });
        continue;
      }

      this.addJob(jobConfig);
    }

    log.info("Cron service started", { jobs: this.jobs.size });
  }

  /**
   * Stop all cron jobs.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const job of this.jobs.values()) {
      job.cron.stop();
    }

    this.jobs.clear();
    log.info("Cron service stopped");
  }

  /**
   * Add a new job at runtime.
   */
  addJob(jobConfig: CronJobConfig): void {
    const handler = this.handlers.get(jobConfig.handler);
    if (!handler) {
      log.warn("No handler for cron job", {
        id: jobConfig.id,
        handler: jobConfig.handler,
      });
      return;
    }

    // Stop existing job with same ID
    if (this.jobs.has(jobConfig.id)) {
      this.removeJob(jobConfig.id);
    }

    const runningJob: RunningJob = {
      id: jobConfig.id,
      name: jobConfig.name,
      schedule: jobConfig.schedule,
      handler,
      config: jobConfig.config,
      runCount: 0,
      cron: null as unknown as Cron,
    };

    const cron = new Cron(jobConfig.schedule, {
      name: jobConfig.id,
      timezone: "Europe/Moscow",
    }, async () => {
      await this.executeJob(runningJob);
    });

    runningJob.cron = cron;
    this.jobs.set(jobConfig.id, runningJob);

    log.info("Cron job added", {
      id: jobConfig.id,
      schedule: jobConfig.schedule,
      next: cron.nextRun()?.toISOString() ?? "none",
    });
  }

  /**
   * Remove a job by ID.
   */
  removeJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.cron.stop();
      this.jobs.delete(id);
      log.info("Cron job removed", { id });
    }
  }

  /**
   * Manually trigger a job by ID.
   */
  async triggerJob(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) {
      throw new Error(`Cron job ${id} not found`);
    }

    log.info("Manual cron trigger", { id });
    await this.executeJob(job);
  }

  /**
   * Get status of all jobs.
   */
  getStatus(): JobStatus[] {
    return Array.from(this.jobs.values()).map((job) => ({
      id: job.id,
      name: job.name,
      schedule: job.schedule,
      enabled: true,
      nextRun: job.cron.nextRun(),
      lastRun: job.lastRun ?? null,
      lastError: job.lastError ?? null,
      runCount: job.runCount,
    }));
  }

  /**
   * Check if service is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private async executeJob(job: RunningJob): Promise<void> {
    const startTime = Date.now();
    log.info("Executing cron job", { id: job.id, name: job.name });

    try {
      await job.handler(job.id, job.config);
      job.lastRun = new Date();
      job.lastError = undefined;
      job.runCount++;

      log.info("Cron job completed", {
        id: job.id,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.lastRun = new Date();
      job.lastError = message;
      job.runCount++;

      log.error("Cron job failed", {
        id: job.id,
        error: message,
        durationMs: Date.now() - startTime,
      });
    }
  }
}
