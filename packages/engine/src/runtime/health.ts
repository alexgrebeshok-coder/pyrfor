/**
 * HealthMonitor — Pyrfor runtime health tracking.
 *
 * Standalone module: no external deps beyond node:* and ../observability/logger.
 *
 * Edge-case policy:
 *   - 0 checks registered → aggregate status = 'healthy'
 *   - addCheck with duplicate name → overwrites previous + warns
 *   - check throws → caught, {healthy:false, message: err.message}
 *   - check returns invalid object → {healthy:false, message:'invalid result'}
 *   - check exceeds timeoutMs → {healthy:false, message:'timeout after <N>ms'}
 */

import { logger } from '../observability/logger';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthCheckResult {
  healthy: boolean;
  status?: HealthStatus;
  message?: string;
  metadata?: Record<string, unknown>;
  /** Latency of the check in ms (set automatically by runChecks). */
  latencyMs?: number;
}

export type HealthCheckFn = () => Promise<HealthCheckResult> | HealthCheckResult;

export interface HealthCheckEntry {
  name: string;
  critical: boolean;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  consecutiveFailures: number;
}

export interface HealthSnapshot {
  /** healthy if all pass, degraded if any non-critical failing, unhealthy if any critical failing */
  status: HealthStatus;
  timestamp: string;
  uptimeMs: number;
  restartCount: number;
  checks: Record<string, HealthCheckResult & HealthCheckEntry>;
}

export interface HealthMonitorOptions {
  /** Default 30000 ms */
  intervalMs?: number;
  /** Logger name override (default 'health') */
  loggerName?: string;
}

export interface AddCheckOptions {
  /** If true, failing this check makes overall status 'unhealthy'. Default false → 'degraded'. */
  critical?: boolean;
  /** Fail check if not resolved within this many ms. Default 10000. */
  timeoutMs?: number;
}

interface CheckRegistration {
  fn: HealthCheckFn;
  options: Required<AddCheckOptions>;
  entry: HealthCheckEntry;
  lastResult?: HealthCheckResult;
}

function deriveStatus(result: HealthCheckResult): HealthStatus {
  if (result.status) return result.status;
  return result.healthy ? 'healthy' : 'unhealthy';
}

function isValidResult(value: unknown): value is HealthCheckResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'healthy' in value &&
    typeof (value as Record<string, unknown>).healthy === 'boolean'
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export class HealthMonitor {
  private readonly intervalMs: number;
  private readonly loggerName: string;

  private checks = new Map<string, CheckRegistration>();
  private lastSnapshot: HealthSnapshot | null = null;
  private _restartCount = 0;
  private _running = false;
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _startedAt: number | null = null;

  constructor(options?: HealthMonitorOptions) {
    this.intervalMs = options?.intervalMs ?? 30_000;
    this.loggerName = options?.loggerName ?? 'health';
  }

  addCheck(name: string, fn: HealthCheckFn, options?: AddCheckOptions): void {
    if (this.checks.has(name)) {
      logger.warn(`[${this.loggerName}] Overwriting existing check`, { name });
    }
    this.checks.set(name, {
      fn,
      options: {
        critical: options?.critical ?? false,
        timeoutMs: options?.timeoutMs ?? 10_000,
      },
      entry: {
        name,
        critical: options?.critical ?? false,
        consecutiveFailures: 0,
      },
    });
  }

  removeCheck(name: string): boolean {
    return this.checks.delete(name);
  }

  hasCheck(name: string): boolean {
    return this.checks.has(name);
  }

  recordRestart(): void {
    this._restartCount++;
  }

  async runChecks(): Promise<HealthSnapshot> {
    const jobs = Array.from(this.checks.entries()).map(async ([name, reg]) => {
      const t0 = Date.now();
      let result: HealthCheckResult;

      try {
        const raw = await withTimeout(Promise.resolve(reg.fn()), reg.options.timeoutMs);
        if (!isValidResult(raw)) {
          result = { healthy: false, message: 'invalid result' };
        } else {
          result = raw;
        }
      } catch (err) {
        result = {
          healthy: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }

      result = { ...result, latencyMs: Date.now() - t0 };

      const prevHealthy = reg.lastResult?.healthy ?? true;
      reg.lastResult = result;

      if (result.healthy) {
        reg.entry.lastSuccessAt = new Date().toISOString();
        reg.entry.consecutiveFailures = 0;
      } else {
        reg.entry.lastFailureAt = new Date().toISOString();
        reg.entry.consecutiveFailures++;
      }

      // Log only on transitions
      if (prevHealthy && !result.healthy) {
        logger.info(`[${this.loggerName}] Check transitioned to unhealthy`, { name, message: result.message });
      } else if (!prevHealthy && result.healthy) {
        logger.info(`[${this.loggerName}] Check recovered`, { name });
      }

      return { name, result, critical: reg.entry.critical };
    });

    const settled = await Promise.allSettled(jobs);

    const checksRecord: HealthSnapshot['checks'] = {};
    let hasUnhealthyCritical = false;
    let hasUnhealthyNonCritical = false;

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        const { name, result, critical } = outcome.value;
        const reg = this.checks.get(name)!;
        checksRecord[name] = {
          ...result,
          name,
          critical,
          lastSuccessAt: reg.entry.lastSuccessAt,
          lastFailureAt: reg.entry.lastFailureAt,
          consecutiveFailures: reg.entry.consecutiveFailures,
        };
        if (!result.healthy) {
          if (critical) hasUnhealthyCritical = true;
          else hasUnhealthyNonCritical = true;
        }
      }
    }

    const aggregateStatus: HealthStatus = hasUnhealthyCritical
      ? 'unhealthy'
      : hasUnhealthyNonCritical
        ? 'degraded'
        : 'healthy';

    const snapshot: HealthSnapshot = {
      status: aggregateStatus,
      timestamp: new Date().toISOString(),
      uptimeMs: this._startedAt != null ? Date.now() - this._startedAt : 0,
      restartCount: this._restartCount,
      checks: checksRecord,
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._startedAt = Date.now();

    logger.info(`[${this.loggerName}] Health monitor started`, {
      intervalMs: this.intervalMs,
      checks: this.checks.size,
    });

    this._interval = setInterval(() => {
      this.runChecks().catch((err) =>
        logger.error(`[${this.loggerName}] runChecks failed`, { error: String(err) }),
      );
    }, this.intervalMs);

    // Don't block the event loop
    this._interval.unref();
  }

  stop(): void {
    if (!this._running) return;
    if (this._interval != null) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._running = false;
    logger.info(`[${this.loggerName}] Health monitor stopped`);
  }

  getLastSnapshot(): HealthSnapshot | null {
    return this.lastSnapshot;
  }

  isRunning(): boolean {
    return this._running;
  }
}
