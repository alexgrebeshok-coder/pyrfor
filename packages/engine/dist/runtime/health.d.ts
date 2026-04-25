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
export declare class HealthMonitor {
    private readonly intervalMs;
    private readonly loggerName;
    private checks;
    private lastSnapshot;
    private _restartCount;
    private _running;
    private _interval;
    private _startedAt;
    constructor(options?: HealthMonitorOptions);
    addCheck(name: string, fn: HealthCheckFn, options?: AddCheckOptions): void;
    removeCheck(name: string): boolean;
    hasCheck(name: string): boolean;
    recordRestart(): void;
    runChecks(): Promise<HealthSnapshot>;
    start(): void;
    stop(): void;
    getLastSnapshot(): HealthSnapshot | null;
    isRunning(): boolean;
}
//# sourceMappingURL=health.d.ts.map