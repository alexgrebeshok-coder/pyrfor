/**
 * CEOClaw Daemon — Health Monitor
 *
 * Tracks subsystem health, provides restart triggers,
 * exposes health status via HTTP endpoint.
 * Improved over OpenClaw: typed subsystems, Prisma health check, configurable thresholds.
 */

import { createLogger } from "./logger";

const log = createLogger("health");

export type SubsystemName =
  | "gateway"
  | "telegram"
  | "cron"
  | "database"
  | "ai"
  | "memory";

export interface SubsystemHealth {
  name: SubsystemName;
  status: "healthy" | "degraded" | "unhealthy" | "stopped";
  lastCheck: Date;
  lastError?: string;
  uptime: number;
  metadata?: Record<string, unknown>;
}

export interface HealthSnapshot {
  daemon: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  startedAt: string;
  subsystems: SubsystemHealth[];
  restarts: number;
  version: string;
}

type HealthCheck = () => Promise<SubsystemHealth>;

export class HealthMonitor {
  private checks = new Map<SubsystemName, HealthCheck>();
  private lastResults = new Map<SubsystemName, SubsystemHealth>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private startedAt = new Date();
  private restartCount = 0;
  private onUnhealthy?: (subsystem: SubsystemName) => void;

  private config: {
    intervalMs: number;
    restartOnFailure: boolean;
    maxRestarts: number;
    restartWindowMs: number;
  };

  constructor(config?: Partial<typeof HealthMonitor.prototype.config>) {
    this.config = {
      intervalMs: config?.intervalMs ?? 30000,
      restartOnFailure: config?.restartOnFailure ?? true,
      maxRestarts: config?.maxRestarts ?? 5,
      restartWindowMs: config?.restartWindowMs ?? 300000,
    };
  }

  registerCheck(name: SubsystemName, check: HealthCheck): void {
    this.checks.set(name, check);
    log.debug("Registered health check", { subsystem: name });
  }

  setUnhealthyHandler(handler: (subsystem: SubsystemName) => void): void {
    this.onUnhealthy = handler;
  }

  async runChecks(): Promise<HealthSnapshot> {
    const results: SubsystemHealth[] = [];

    for (const [name, check] of this.checks) {
      try {
        const result = await check();
        this.lastResults.set(name, result);
        results.push(result);

        if (result.status === "unhealthy" && this.onUnhealthy) {
          this.onUnhealthy(name);
        }
      } catch (error) {
        const errorResult: SubsystemHealth = {
          name,
          status: "unhealthy",
          lastCheck: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
          uptime: 0,
        };
        this.lastResults.set(name, errorResult);
        results.push(errorResult);

        if (this.onUnhealthy) {
          this.onUnhealthy(name);
        }
      }
    }

    const unhealthyCount = results.filter((r) => r.status === "unhealthy").length;
    const degradedCount = results.filter((r) => r.status === "degraded").length;

    return {
      daemon:
        unhealthyCount > 0
          ? "unhealthy"
          : degradedCount > 0
            ? "degraded"
            : "healthy",
      uptime: Date.now() - this.startedAt.getTime(),
      startedAt: this.startedAt.toISOString(),
      subsystems: results,
      restarts: this.restartCount,
      version: process.env.npm_package_version ?? "0.3.0",
    };
  }

  start(): void {
    if (this.interval) return;

    log.info("Health monitor started", {
      interval: `${this.config.intervalMs}ms`,
      checks: this.checks.size,
    });

    // Run immediately, then on interval
    this.runChecks().catch((err) =>
      log.error("Health check failed", { error: String(err) })
    );

    this.interval = setInterval(() => {
      this.runChecks().catch((err) =>
        log.error("Health check failed", { error: String(err) })
      );
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    log.info("Health monitor stopped");
  }

  getLastSnapshot(): HealthSnapshot | null {
    if (this.lastResults.size === 0) return null;

    const results = Array.from(this.lastResults.values());
    const unhealthyCount = results.filter((r) => r.status === "unhealthy").length;
    const degradedCount = results.filter((r) => r.status === "degraded").length;

    return {
      daemon:
        unhealthyCount > 0
          ? "unhealthy"
          : degradedCount > 0
            ? "degraded"
            : "healthy",
      uptime: Date.now() - this.startedAt.getTime(),
      startedAt: this.startedAt.toISOString(),
      subsystems: results,
      restarts: this.restartCount,
      version: process.env.npm_package_version ?? "0.3.0",
    };
  }

  incrementRestarts(): void {
    this.restartCount++;
  }
}
