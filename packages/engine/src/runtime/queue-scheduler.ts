/**
 * Pyrfor Runtime — QueueScheduler
 *
 * Unified scheduler for cron, interval, and one-shot jobs with persistence.
 * Injectable clock + setTimer/clearTimer for deterministic testing.
 * Atomic file writes via tmp+rename. Node built-ins only.
 *
 * CRON SUPPORT:
 *   The built-in fallback supports ONLY "* * * * *" (every minute).
 *   For full cron support, inject `cronNextRun` from the cron-expression module:
 *     import { parseCron, nextRun } from './cron-expression.js';
 *     createQueueScheduler({ cronNextRun: (expr, after) => nextRun(parseCron(expr), after) })
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type JobSchedule =
  | { kind: 'cron'; expr: string }
  | { kind: 'interval'; everyMs: number; startAt?: number }
  | { kind: 'oneshot'; runAt: number };

export interface ScheduledJob {
  id: string;
  name: string;
  schedule: JobSchedule;
  handler: () => Promise<void> | void;
  nextRun: number;
  lastRun?: number;
  lastError?: string;
  enabled: boolean;
  runCount: number;
  failureCount: number;
  meta?: Record<string, unknown>;
}

export interface QueueSchedulerOptions {
  /** JSON file path for persistence. Omit for in-memory only. */
  persistPath?: string;
  /** Max simultaneous running handlers. Default: Infinity. */
  maxConcurrent?: number;
  /** Called when a handler throws. Scheduling continues. */
  onError?: (err: Error, job: ScheduledJob) => void;
  /**
   * Cron nextRun calculator. Defaults to a minimal fallback supporting
   * ONLY "* * * * *". Inject from cron-expression.ts for full support.
   */
  cronNextRun?: (expr: string, after: number) => number;
  /** Timestamp source. Default: Date.now. */
  clock?: () => number;
  /** Timer factory. Default: setTimeout. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  /** Timer canceller. Default: clearTimeout. */
  clearTimer?: (handle: unknown) => void;
}

export interface QueueScheduler {
  add(
    name: string,
    schedule: JobSchedule,
    handler: () => Promise<void> | void,
    meta?: Record<string, unknown>,
  ): string;
  remove(id: string): boolean;
  enable(id: string): boolean;
  disable(id: string): boolean;
  get(id: string): ScheduledJob | undefined;
  list(): ScheduledJob[];
  start(): void;
  stop(): Promise<void>;
  runNow(id: string): Promise<void>;
  getStats(): {
    total: number;
    enabled: number;
    running: number;
    totalRuns: number;
    totalFailures: number;
  };
  save(): void;
  load(handlerFactory: (job: ScheduledJob) => () => Promise<void> | void): void;
}

// ── Cron fallback ─────────────────────────────────────────────────────────────

/**
 * Minimal fallback — supports ONLY "* * * * *".
 * Returns the start of the next minute boundary after `after`.
 */
function defaultCronNextRun(expr: string, after: number): number {
  if (expr.trim() !== '* * * * *') {
    throw new Error(
      `Built-in cronNextRun supports only "* * * * *". Inject a full implementation for "${expr}".`,
    );
  }
  return Math.floor(after / 60_000) * 60_000 + 60_000;
}

// ── Next-run computation ──────────────────────────────────────────────────────

function computeNextRun(
  schedule: JobSchedule,
  now: number,
  lastRun: number | undefined,
  cronNextRun: (expr: string, after: number) => number,
): number {
  switch (schedule.kind) {
    case 'cron':
      return cronNextRun(schedule.expr, now);

    case 'interval':
      if (lastRun !== undefined) {
        return lastRun + schedule.everyMs;
      }
      // First run: honour startAt or run as soon as possible.
      return Math.max(now, schedule.startAt ?? 0);

    case 'oneshot':
      return schedule.runAt;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createQueueScheduler(opts: QueueSchedulerOptions = {}): QueueScheduler {
  const clock = opts.clock ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer =
    opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const maxConcurrent = opts.maxConcurrent ?? Infinity;
  const cronNextRunFn = opts.cronNextRun ?? defaultCronNextRun;
  const onError = opts.onError;
  const persistPath = opts.persistPath;

  const jobs = new Map<string, ScheduledJob>();
  /** IDs of jobs whose handlers are currently executing. */
  const runningIds = new Set<string>();
  /** Promises of all in-flight handler executions. */
  const inFlight = new Set<Promise<void>>();

  let timerHandle: unknown = null;
  let started = false;

  // ── Internal helpers ────────────────────────────────────────────────────────

  function scheduleNext(): void {
    if (!started) return;

    if (timerHandle !== null) {
      clearTimer(timerHandle);
      timerHandle = null;
    }

    const now = clock();
    let earliest = Infinity;

    for (const job of jobs.values()) {
      if (!job.enabled) continue;
      if (runningIds.has(job.id)) continue; // already executing
      if (job.nextRun < earliest) earliest = job.nextRun;
    }

    if (earliest === Infinity) return;

    const delay = Math.max(0, earliest - now);
    timerHandle = setTimer(tick, delay);
  }

  function tick(): void {
    if (!started) return;
    const now = clock();

    for (const job of jobs.values()) {
      if (!job.enabled) continue;
      if (runningIds.has(job.id)) continue;
      if (runningIds.size >= maxConcurrent) break;
      if (job.nextRun <= now) {
        // fire-and-forget; tracked via inFlight
        void runJob(job);
      }
    }

    scheduleNext();
  }

  function runJob(job: ScheduledJob): Promise<void> {
    runningIds.add(job.id);

    let p!: Promise<void>;
    p = (async () => {
      try {
        await job.handler();
        job.lastRun = clock();
        job.runCount++;
        if (job.schedule.kind === 'oneshot') {
          job.enabled = false;
        } else {
          job.nextRun = computeNextRun(job.schedule, clock(), job.lastRun, cronNextRunFn);
        }
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        job.failureCount++;
        job.lastError = err.message;
        job.lastRun = clock();
        job.runCount++;
        if (job.schedule.kind !== 'oneshot') {
          job.nextRun = computeNextRun(job.schedule, clock(), job.lastRun, cronNextRunFn);
        } else {
          job.enabled = false;
        }
        onError?.(err, job);
      } finally {
        runningIds.delete(job.id);
        inFlight.delete(p);
        if (started) tick();
      }
    })();

    inFlight.add(p);
    return p;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function add(
    name: string,
    schedule: JobSchedule,
    handler: () => Promise<void> | void,
    meta?: Record<string, unknown>,
  ): string {
    const id = randomBytes(8).toString('hex');
    const now = clock();
    const job: ScheduledJob = {
      id,
      name,
      schedule,
      handler,
      nextRun: computeNextRun(schedule, now, undefined, cronNextRunFn),
      enabled: true,
      runCount: 0,
      failureCount: 0,
      meta,
    };
    jobs.set(id, job);
    if (started) scheduleNext();
    return id;
  }

  function remove(id: string): boolean {
    if (!jobs.has(id)) return false;
    jobs.delete(id);
    if (started) scheduleNext();
    return true;
  }

  function enable(id: string): boolean {
    const job = jobs.get(id);
    if (!job) return false;
    job.enabled = true;
    if (started) scheduleNext();
    return true;
  }

  function disable(id: string): boolean {
    const job = jobs.get(id);
    if (!job) return false;
    job.enabled = false;
    return true;
  }

  function get(id: string): ScheduledJob | undefined {
    return jobs.get(id);
  }

  function list(): ScheduledJob[] {
    return [...jobs.values()];
  }

  function start(): void {
    started = true;
    scheduleNext();
  }

  async function stop(): Promise<void> {
    started = false;
    if (timerHandle !== null) {
      clearTimer(timerHandle);
      timerHandle = null;
    }
    await Promise.all([...inFlight]);
  }

  async function runNow(id: string): Promise<void> {
    const job = jobs.get(id);
    if (!job) throw new Error(`Job "${id}" not found`);
    await runJob(job);
  }

  function getStats() {
    let enabled = 0;
    let totalRuns = 0;
    let totalFailures = 0;
    for (const job of jobs.values()) {
      if (job.enabled) enabled++;
      totalRuns += job.runCount;
      totalFailures += job.failureCount;
    }
    return {
      total: jobs.size,
      enabled,
      running: runningIds.size,
      totalRuns,
      totalFailures,
    };
  }

  function save(): void {
    if (!persistPath) return;
    mkdirSync(dirname(persistPath), { recursive: true });
    type Persistable = Omit<ScheduledJob, 'handler'>;
    const persistable: Persistable[] = [...jobs.values()].map(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ({ handler: _h, ...rest }) => rest,
    );
    const data = JSON.stringify({ version: 1, jobs: persistable }, null, 2);
    const tmp = persistPath + '.tmp';
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, persistPath);
  }

  function load(handlerFactory: (job: ScheduledJob) => () => Promise<void> | void): void {
    if (!persistPath || !existsSync(persistPath)) return;
    const raw = readFileSync(persistPath, 'utf8');
    const data = JSON.parse(raw) as {
      version: number;
      jobs: Omit<ScheduledJob, 'handler'>[];
    };
    jobs.clear();
    for (const j of data.jobs) {
      const job = { ...j } as ScheduledJob;
      job.handler = handlerFactory(job);
      jobs.set(job.id, job);
    }
  }

  return { add, remove, enable, disable, get, list, start, stop, runNow, getStats, save, load };
}
