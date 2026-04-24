/**
 * Pyrfor Runtime — CronPersistenceStore
 *
 * JSON-backed registry for cron jobs: spec, last run, next run, last status.
 * Sits alongside CronService (see ./cron.ts) and does NOT modify it.
 *
 * The store can be loaded by an orchestrator at startup to seed CronService
 * and updated on each run for crash recovery.
 *
 * PERSISTENCE MODEL:
 *   flush() writes atomically (tmp + rename) using fs/promises.
 *   Writes are debounced — multiple mutations within autosaveDebounceMs
 *   coalesce into a single I/O operation.
 *   Concurrent flush() calls return the same in-flight promise.
 *
 * AUTO-DISABLE:
 *   After maxConsecutiveFailures (default 5) back-to-back failures, the job
 *   is disabled and a warn is emitted.  Set maxConsecutiveFailures=0 to
 *   disable this feature entirely.
 *
 * SKIPPED vs FAILURE:
 *   recordSkipped() increments totalRuns and sets lastStatus='skipped' but
 *   is neutral with respect to consecutiveFailures.
 */

import { randomBytes } from 'crypto';
import { readFileSync, mkdirSync } from 'fs';
import { writeFile, rename, unlink } from 'fs/promises';
import path from 'path';

// ── Public interfaces ──────────────────────────────────────────────────────

export interface CronPersistedJob {
  id: string;
  name: string;
  /** Cron expression (croner-compatible). */
  cron: string;
  /** Handler name — orchestrator maps this string to a function. */
  handler: string;
  enabled: boolean;
  args?: Record<string, unknown>;
  ownerChatId?: string;
  ownerUserId?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastDurationMs?: number;
  lastStatus?: 'success' | 'failure' | 'skipped';
  lastError?: string;
  consecutiveFailures: number;
  totalRuns: number;
  totalSuccesses: number;
  /** Computed externally; we just persist it. */
  nextRunAt?: string;
}

export interface CreateCronStoreOptions {
  /** JSON file path. In-memory only when omitted. */
  storePath?: string;
  /** Debounce window for auto-save. Default: 200 ms. */
  autosaveDebounceMs?: number;
  /** Monotonic clock. Default: Date.now. */
  clock?: () => number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logger?: (l: 'info' | 'warn' | 'error', m: string, meta?: any) => void;
  /** Auto-disable a job after this many consecutive failures. 0 = never auto-disable. Default: 5. */
  maxConsecutiveFailures?: number;
}

export interface CronPersistenceStore {
  upsert(input: {
    id?: string;
    name: string;
    cron: string;
    handler: string;
    enabled?: boolean;
    args?: Record<string, unknown>;
    ownerChatId?: string;
    ownerUserId?: string;
  }): CronPersistedJob;

  get(id: string): CronPersistedJob | undefined;

  list(opts?: {
    enabled?: boolean;
    ownerChatId?: string;
    ownerUserId?: string;
    handler?: string;
  }): CronPersistedJob[];

  remove(id: string): boolean;

  enable(id: string): boolean;
  disable(id: string): boolean;

  recordRun(
    id: string,
    result: {
      ok: boolean;
      durationMs: number;
      error?: string;
      nextRunAt?: string;
      /** Override wall-clock timestamp (ISO string). */
      ts?: string;
    },
  ): CronPersistedJob | undefined;

  recordSkipped(id: string, reason?: string): CronPersistedJob | undefined;

  setNextRun(id: string, nextRunAt: string): boolean;

  stats(): {
    totalJobs: number;
    enabledJobs: number;
    totalRuns: number;
    totalSuccesses: number;
    /** totalRuns − totalSuccesses (includes skipped). */
    totalFailures: number;
    autoDisabledJobs: number;
  };

  /** Flush in-memory state to disk. Concurrent calls coalesce into one write. */
  flush(): Promise<void>;

  /** Clear all jobs and flush. */
  reset(): void;
}

// ── ULID-style id ──────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + randomBytes(10).toString('hex');
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createCronPersistenceStore(opts?: CreateCronStoreOptions): CronPersistenceStore {
  const storePath = opts?.storePath;
  const autosaveDebounceMs = opts?.autosaveDebounceMs ?? 200;
  const clock = opts?.clock ?? (() => Date.now());
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const log = opts?.logger ?? (() => {});
  const maxConsecutiveFailures = opts?.maxConsecutiveFailures ?? 5;

  const _jobs = new Map<string, CronPersistedJob>();
  let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let _flushInFlight: Promise<void> | null = null;

  // ── Init: load from disk ────────────────────────────────────────────────

  if (storePath) {
    try {
      const raw = readFileSync(storePath, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const job of parsed as CronPersistedJob[]) {
          _jobs.set(job.id, job);
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log('warn', 'cron-persistence: failed to parse store file; starting empty', { err });
      }
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────────

  function nowIso(): string {
    return new Date(clock()).toISOString();
  }

  function scheduleFlush(): void {
    if (!storePath) return;
    if (_debounceTimer !== null) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _debounceTimer = null;
      flush().catch((err: unknown) => log('error', 'cron-persistence: auto-flush failed', { err }));
    }, autosaveDebounceMs);
  }

  async function doWrite(): Promise<void> {
    if (!storePath) return;
    const dir = path.dirname(storePath);
    const tmp = path.join(
      dir,
      `.${path.basename(storePath)}.tmp.${randomBytes(4).toString('hex')}`,
    );
    try {
      mkdirSync(dir, { recursive: true });
      const content = JSON.stringify(Array.from(_jobs.values()), null, 2);
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, storePath);
    } catch (err) {
      try {
        await unlink(tmp);
      } catch {
        // best-effort tmp cleanup
      }
      throw err;
    }
  }

  function flush(): Promise<void> {
    if (!storePath) return Promise.resolve();
    if (_flushInFlight !== null) return _flushInFlight;
    _flushInFlight = doWrite().finally(() => {
      _flushInFlight = null;
    });
    return _flushInFlight;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  function upsert(input: {
    id?: string;
    name: string;
    cron: string;
    handler: string;
    enabled?: boolean;
    args?: Record<string, unknown>;
    ownerChatId?: string;
    ownerUserId?: string;
  }): CronPersistedJob {
    const timestamp = nowIso();
    const resolvedId = input.id ?? generateId();
    const existing = _jobs.get(resolvedId);

    let job: CronPersistedJob;

    if (existing) {
      // Merge: update spec fields, preserve run counters and lastRun state.
      job = {
        ...existing,
        name: input.name,
        cron: input.cron,
        handler: input.handler,
        updatedAt: timestamp,
        ...(input.enabled !== undefined && { enabled: input.enabled }),
        ...(input.args !== undefined && { args: input.args }),
        ...(input.ownerChatId !== undefined && { ownerChatId: input.ownerChatId }),
        ...(input.ownerUserId !== undefined && { ownerUserId: input.ownerUserId }),
      };
    } else {
      job = {
        id: resolvedId,
        name: input.name,
        cron: input.cron,
        handler: input.handler,
        enabled: input.enabled ?? true,
        createdAt: timestamp,
        updatedAt: timestamp,
        consecutiveFailures: 0,
        totalRuns: 0,
        totalSuccesses: 0,
        ...(input.args !== undefined && { args: input.args }),
        ...(input.ownerChatId !== undefined && { ownerChatId: input.ownerChatId }),
        ...(input.ownerUserId !== undefined && { ownerUserId: input.ownerUserId }),
      };
    }

    _jobs.set(resolvedId, job);
    scheduleFlush();
    return job;
  }

  function get(id: string): CronPersistedJob | undefined {
    return _jobs.get(id);
  }

  function list(opts?: {
    enabled?: boolean;
    ownerChatId?: string;
    ownerUserId?: string;
    handler?: string;
  }): CronPersistedJob[] {
    let items = Array.from(_jobs.values());
    if (opts?.enabled !== undefined) items = items.filter((j) => j.enabled === opts.enabled);
    if (opts?.ownerChatId !== undefined) items = items.filter((j) => j.ownerChatId === opts.ownerChatId);
    if (opts?.ownerUserId !== undefined) items = items.filter((j) => j.ownerUserId === opts.ownerUserId);
    if (opts?.handler !== undefined) items = items.filter((j) => j.handler === opts.handler);
    return items;
  }

  function remove(id: string): boolean {
    const existed = _jobs.delete(id);
    if (existed) scheduleFlush();
    return existed;
  }

  function enable(id: string): boolean {
    const job = _jobs.get(id);
    if (!job) return false;
    _jobs.set(id, { ...job, enabled: true, updatedAt: nowIso() });
    scheduleFlush();
    return true;
  }

  function disable(id: string): boolean {
    const job = _jobs.get(id);
    if (!job) return false;
    _jobs.set(id, { ...job, enabled: false, updatedAt: nowIso() });
    scheduleFlush();
    return true;
  }

  function recordRun(
    id: string,
    result: {
      ok: boolean;
      durationMs: number;
      error?: string;
      nextRunAt?: string;
      ts?: string;
    },
  ): CronPersistedJob | undefined {
    const job = _jobs.get(id);
    if (!job) return undefined;

    const ts = result.ts ?? nowIso();

    let updated: CronPersistedJob = {
      ...job,
      totalRuns: job.totalRuns + 1,
      lastRunAt: ts,
      lastDurationMs: result.durationMs,
      updatedAt: ts,
    };

    if (result.ok) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { lastError: _drop, ...rest } = updated;
      updated = {
        ...rest,
        lastStatus: 'success',
        totalSuccesses: job.totalSuccesses + 1,
        consecutiveFailures: 0,
      };
    } else {
      const newConsecutive = job.consecutiveFailures + 1;
      updated = {
        ...updated,
        lastStatus: 'failure',
        lastError: result.error ?? 'unknown',
        consecutiveFailures: newConsecutive,
      };
      // Auto-disable when threshold is reached (feature disabled when maxConsecutiveFailures=0).
      if (maxConsecutiveFailures > 0 && updated.enabled && newConsecutive >= maxConsecutiveFailures) {
        updated = { ...updated, enabled: false };
        log('warn', `cron-persistence: auto-disabled job "${id}" after ${newConsecutive} consecutive failures`, {
          id,
          consecutiveFailures: newConsecutive,
        });
      }
    }

    if (result.nextRunAt !== undefined) {
      updated = { ...updated, nextRunAt: result.nextRunAt };
    }

    _jobs.set(id, updated);
    scheduleFlush();
    return updated;
  }

  function recordSkipped(id: string, _reason?: string): CronPersistedJob | undefined {
    const job = _jobs.get(id);
    if (!job) return undefined;

    const ts = nowIso();
    const updated: CronPersistedJob = {
      ...job,
      totalRuns: job.totalRuns + 1,
      lastStatus: 'skipped',
      lastRunAt: ts,
      updatedAt: ts,
      // consecutiveFailures intentionally unchanged — skipped is neutral
    };

    _jobs.set(id, updated);
    scheduleFlush();
    return updated;
  }

  function setNextRun(id: string, nextRunAt: string): boolean {
    const job = _jobs.get(id);
    if (!job) return false;
    _jobs.set(id, { ...job, nextRunAt, updatedAt: nowIso() });
    scheduleFlush();
    return true;
  }

  function stats(): {
    totalJobs: number;
    enabledJobs: number;
    totalRuns: number;
    totalSuccesses: number;
    totalFailures: number;
    autoDisabledJobs: number;
  } {
    const jobs = Array.from(_jobs.values());
    const totalJobs = jobs.length;
    const enabledJobs = jobs.filter((j) => j.enabled).length;
    const totalRuns = jobs.reduce((s, j) => s + j.totalRuns, 0);
    const totalSuccesses = jobs.reduce((s, j) => s + j.totalSuccesses, 0);
    // totalFailures includes skipped (totalRuns − totalSuccesses)
    const totalFailures = totalRuns - totalSuccesses;
    // autoDisabledJobs: disabled jobs at or above the consecutive-failure threshold
    const autoDisabledJobs =
      maxConsecutiveFailures > 0
        ? jobs.filter((j) => !j.enabled && j.consecutiveFailures >= maxConsecutiveFailures).length
        : 0;
    return { totalJobs, enabledJobs, totalRuns, totalSuccesses, totalFailures, autoDisabledJobs };
  }

  function reset(): void {
    _jobs.clear();
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    // Write the empty state immediately, bypassing debounce.
    if (storePath) {
      flush().catch((err: unknown) =>
        log('error', 'cron-persistence: reset flush failed', { err }),
      );
    }
  }

  return { upsert, get, list, remove, enable, disable, recordRun, recordSkipped, setNextRun, stats, flush, reset };
}
